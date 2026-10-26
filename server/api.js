import { Router } from "express";
import express from "express";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { db, nowIso, isEmpty, makeGroup, seedDemo, pairTimes, getSetting, UPLOADS_DIR } from "./db.js";
import {
  hashPassword, verifyPassword, createSession, destroySession,
  userFromRequest, requireAuth, requireAdmin, sessionCookie, clearCookie, parseCookies, isSecureRequest,
} from "./auth.js";
import {
  publicKey, saveSubscription, removeSubscription, sendTest, sendToGroup, userHasSubscription,
} from "./push.js";
import {
  todayIso, weekdayOf, parityOf, parityFor, academicWeek, parseIso, weekDays, toIso, addDays,
  minutesOf, nowMinutes, formatDateRu,
} from "./time.js";

/** Чётность недели по учебному календарю группы */
const parityOn = (date) => parityFor(date, getSetting("semester_start", null));

export const api = Router();

/* ─────────────────────── SSE-хаб «кто идёт» ─────────────────────── */

const subscribers = new Map(); // groupId -> Set<res>

export function broadcast(groupId, event, data) {
  const set = subscribers.get(groupId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(payload);
}

export function sseHandler(req, res) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).end();

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  if (!subscribers.has(user.groupId)) subscribers.set(user.groupId, new Set());
  subscribers.get(user.groupId).add(res);

  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    subscribers.get(user.groupId)?.delete(res);
  });
}

/* ─────────────────────────── утилиты ─────────────────────────── */

const STATUSES = ["going", "late", "absent", "sick"];

/** Журнал действий: кто что изменил. Ошибка журнала не должна ломать запрос. */
function logAction(user, action, target = "", detail = "") {
  try {
    db.prepare(
      `INSERT INTO audit (group_id, actor_id, actor_name, action, target, detail, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(
      user.groupId,
      user.id ?? null,
      user.name ?? "",
      action,
      String(target).slice(0, 200),
      String(detail).slice(0, 300),
      nowIso()
    );
  } catch {
    /* журнал не критичен */
  }
}

const userPublic = (u) => ({ id: u.id, name: u.name, role: u.role, color: u.color, subgroup: u.subgroup ?? null });

/** «Маклецов С. В.» → «Маклецов» */
function shortTeacher(teacher) {
  const s = String(teacher ?? "").replace(/\s+/g, " ").trim();
  const m = s.match(/([А-ЯЁ][а-яё]{2,})/);
  return m ? m[1] : s;
}

/** Подгруппа → фамилия преподавателя, который её ведёт */
function subgroupLabels(groupId) {
  const rows = db
    .prepare(
      `SELECT subgroup, teacher, COUNT(*) AS n FROM slots
       WHERE group_id = ? AND subgroup IS NOT NULL
       GROUP BY subgroup, teacher ORDER BY subgroup, n DESC`
    )
    .all(groupId);

  const map = new Map();
  for (const r of rows) if (!map.has(r.subgroup)) map.set(r.subgroup, shortTeacher(r.teacher));
  return map;
}

function groupUsers(groupId) {
  return db
    .prepare("SELECT id, name, role, color, subgroup FROM users WHERE group_id = ? ORDER BY role DESC, name")
    .all(groupId);
}

function slotsForDate(groupId, iso, subgroup = null) {
  const date = parseIso(iso);
  const wd = weekdayOf(date);
  const parity = parityOn(date);
  return db
    .prepare(
      `SELECT s.*, sub.name AS subject, sub.color, sub.teacher AS subject_teacher
       FROM slots s JOIN subjects sub ON sub.id = s.subject_id
       WHERE s.group_id = ? AND s.weekday = ? AND (s.parity = 'all' OR s.parity = ?)
         AND (s.starts_on IS NULL OR s.starts_on <= ?)
         AND (s.ends_on IS NULL OR s.ends_on >= ?)
         AND (s.subgroup IS NULL OR ? IS NULL OR s.subgroup = ?)
       ORDER BY s.start_time, s.pair, s.subgroup`
    )
    .all(groupId, wd, parity, iso, iso, subgroup, subgroup);
}

function attendanceCounts(slotId, iso) {
  const rows = db
    .prepare("SELECT status, COUNT(*) AS n FROM attendance WHERE slot_id = ? AND date = ? GROUP BY status")
    .all(slotId, iso);
  const counts = { going: 0, late: 0, absent: 0, sick: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

function lessonStatus(iso, start, end) {
  const today = todayIso();
  if (iso < today) return "past";
  if (iso > today) return "upcoming";
  const now = nowMinutes();
  if (now > minutesOf(end)) return "past";
  if (now >= minutesOf(start)) return "now";
  return "upcoming";
}

function lessonView(groupId, slot, iso, userId, studentsTotal, labels = new Map(), homework = []) {
  const counts = attendanceCounts(slot.id, iso);
  const mine = db
    .prepare("SELECT status FROM attendance WHERE slot_id = ? AND date = ? AND user_id = ?")
    .get(slot.id, iso, userId);
  const marked = counts.going + counts.late + counts.absent + counts.sick;
  return {
    slotId: slot.id,
    date: iso,
    pair: slot.pair,
    start: slot.start_time,
    end: slot.end_time,
    room: slot.room,
    teacher: slot.teacher || slot.subject_teacher,
    parity: slot.parity,
    subgroup: slot.subgroup ?? null,
    subgroupLabel: slot.subgroup ? labels.get(slot.subgroup) ?? slot.subgroup : null,
    subject: { id: slot.subject_id, name: slot.subject, color: slot.color },
    status: lessonStatus(iso, slot.start_time, slot.end_time),
    counts,
    marked,
    studentsTotal,
    myStatus: mine?.status ?? null,
    homework,
  };
}

/* ──────────────────────────── auth ──────────────────────────── */

/** Примитивный лимит попыток: защита от перебора паролей */
const attempts = new Map();

function allowAttempt(key, limit = 8, windowMs = 60_000) {
  const now = Date.now();

  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
  }

  const rec = attempts.get(key);
  if (!rec || rec.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  rec.count += 1;
  return rec.count <= limit;
}

function tooMany(res) {
  return res.status(429).json({ error: "Слишком много попыток. Подожди минуту." });
}

const clientKey = (req) => req.ip ?? req.socket?.remoteAddress ?? "unknown";

api.post("/auth/setup", (req, res) => {
  if (!isEmpty()) return res.status(403).json({ error: "Группа уже создана" });
  const { groupName, code, name, password } = req.body ?? {};
  if (!groupName?.trim() || !code?.trim() || !name?.trim() || !password) {
    return res.status(400).json({ error: "Заполните все поля" });
  }
  const { groupId } = makeGroup({
    name: groupName.trim(),
    code: code.trim().toUpperCase(),
    starostaName: name.trim(),
    passwordHash: hashPassword(password),
  });
  const user = db.prepare("SELECT * FROM users WHERE group_id = ? AND role = 'starosta'").get(groupId);
  const { token, expires } = createSession(user.id);
  res.setHeader("set-cookie", sessionCookie(token, expires, isSecureRequest(req)));
  res.json({ user: userPublic(user) });
});

api.post("/auth/register", (req, res) => {
  const { code, name, password } = req.body ?? {};
  if (!code || !name?.trim() || !password) return res.status(400).json({ error: "Заполните все поля" });
  if (!allowAttempt(`reg|${clientKey(req)}`, 30, 60_000)) return tooMany(res);
  if (String(password).length < 8) return res.status(400).json({ error: "Пароль минимум 8 символов" });

  const group = db.prepare("SELECT * FROM groups WHERE code = ?").get(String(code).trim().toUpperCase());
  if (!group) return res.status(404).json({ error: "Группа с таким кодом не найдена" });

  const banned = db
    .prepare("SELECT 1 FROM bans WHERE group_id = ? AND name_key = ?")
    .get(group.id, name.trim().toLowerCase());
  if (banned) {
    return res.status(403).json({ error: "Тебя исключили из этой группы. Обратись к старосте." });
  }

  const exists = db
    .prepare("SELECT id FROM users WHERE group_id = ? AND lower(name) = lower(?)")
    .get(group.id, name.trim());
  if (exists) return res.status(409).json({ error: "Такое имя уже занято в группе" });

  const colors = ["#38d39f", "#f5a524", "#ff7b8a", "#b57bff", "#4dd0e1", "#6c8cff"];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const r = db
    .prepare("INSERT INTO users (group_id, name, role, password_hash, color, created_at) VALUES (?,?,?,?,?,?)")
    .run(group.id, name.trim(), "student", hashPassword(password), color, nowIso());

  const { token, expires } = createSession(Number(r.lastInsertRowid));
  res.setHeader("set-cookie", sessionCookie(token, expires, isSecureRequest(req)));
  broadcast(group.id, "roster", { reason: "new-student" });
  res.status(201).json({ user: { id: Number(r.lastInsertRowid), name: name.trim(), role: "student", color } });
});

api.post("/auth/login", (req, res) => {
  const { code, name, password } = req.body ?? {};
  if (!code || !name || !password) return res.status(400).json({ error: "Заполните все поля" });

  const key = `${clientKey(req)}|${String(code).toUpperCase()}|${String(name).toLowerCase()}`;
  if (!allowAttempt(key)) return tooMany(res);

  const group = db.prepare("SELECT * FROM groups WHERE code = ?").get(String(code).trim().toUpperCase());
  if (!group) return res.status(404).json({ error: "Группа не найдена" });

  const user = db
    .prepare("SELECT * FROM users WHERE group_id = ? AND lower(name) = lower(?)")
    .get(group.id, String(name).trim());

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Неверное имя или пароль" });
  }

  const { token, expires } = createSession(user.id);
  res.setHeader("set-cookie", sessionCookie(token, expires, isSecureRequest(req)));
  res.json({ user: userPublic(user) });
});

api.post("/auth/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  destroySession(cookies.sid);
  res.setHeader("set-cookie", clearCookie());
  res.json({ ok: true });
});

api.get("/me", (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: "Не авторизован" });

  const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(user.groupId);
  const students = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE group_id = ?")
    .get(user.groupId).n;
  const my = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status='going' THEN 1 ELSE 0 END) AS going,
         SUM(CASE WHEN status='late' THEN 1 ELSE 0 END) AS late,
         SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END) AS absent,
         SUM(CASE WHEN status='sick' THEN 1 ELSE 0 END) AS sick
       FROM attendance WHERE user_id = ?`
    )
    .get(user.id);

  res.json({
    user: userPublic(user),
    group: {
      id: group.id, name: group.name, code: group.code, students,
      program: group.program ?? null, profile: group.profile ?? null,
    },
    parity: parityOn(new Date()),
    week: academicWeek(new Date(), getSetting("semester_start", null)),
    counts: {
      going: my.going ?? 0, late: my.late ?? 0,
      absent: my.absent ?? 0, sick: my.sick ?? 0,
    },
  });
});

api.patch("/me", requireAuth, (req, res) => {
  const name = String(req.body?.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) {
    return res.status(400).json({ error: "Имя должно быть от 2 до 60 символов" });
  }

  const clash = db
    .prepare("SELECT id FROM users WHERE group_id = ? AND lower(name) = lower(?) AND id <> ?")
    .get(req.user.groupId, name, req.user.id);
  if (clash) return res.status(409).json({ error: "Такое имя уже занято в группе" });

  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.user.id);
  if (name !== req.user.name) logAction(req.user, "profile.name", name, `было: ${req.user.name}`);
  res.json({ ok: true, name });
});

api.delete("/members/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный id" });
  if (id === req.user.id) return res.status(400).json({ error: "Нельзя удалить себя" });

  const target = db
    .prepare("SELECT id, name, role FROM users WHERE id = ? AND group_id = ?")
    .get(id, req.user.groupId);
  if (!target) return res.status(404).json({ error: "Такого участника нет" });
  if (target.role === "starosta") return res.status(403).json({ error: "Нельзя удалить старосту" });

  db.prepare(
    `INSERT INTO bans (group_id, name, name_key, banned_by, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(group_id, name_key)
     DO UPDATE SET name = excluded.name, banned_by = excluded.banned_by, created_at = excluded.created_at`
  ).run(req.user.groupId, target.name, target.name.trim().toLowerCase(), req.user.id, nowIso());

  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  logAction(req.user, "member.remove", target.name);
  broadcast(req.user.groupId, "roster", { reason: "removed", userId: id });
  res.json({ ok: true, removed: target.name, banned: true });
});

/* ───────────────────────── чёрный список ───────────────────────── */

api.get("/bans", requireAdmin, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT b.id, b.name, b.created_at, u.name AS banned_by_name
         FROM bans b LEFT JOIN users u ON u.id = b.banned_by
         WHERE b.group_id = ? ORDER BY b.created_at DESC`
      )
      .all(req.user.groupId)
  );
});

api.delete("/bans/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM bans WHERE id = ? AND group_id = ?").run(
    Number(req.params.id),
    req.user.groupId
  );
  res.json({ ok: true });
});

api.get("/subgroups", requireAuth, (req, res) => {
  const labels = subgroupLabels(req.user.groupId);
  const rows = db
    .prepare(
      `SELECT s.subgroup, s.teacher, s.room, sub.name AS subject
       FROM slots s JOIN subjects sub ON sub.id = s.subject_id
       WHERE s.group_id = ? AND s.subgroup IS NOT NULL
       ORDER BY s.subgroup, s.id`
    )
    .all(req.user.groupId);

  const seen = new Map();
  for (const r of rows) {
    if (seen.has(r.subgroup)) continue;
    seen.set(r.subgroup, {
      code: r.subgroup,
      label: labels.get(r.subgroup) ?? r.subgroup,
      teacher: r.teacher,
      subject: r.subject,
      room: r.room,
    });
  }
  res.json([...seen.values()]);
});

api.post("/me/subgroup", requireAuth, (req, res) => {
  const map = { "а": "А", "a": "А", "б": "Б", "b": "Б" };
  const raw = String(req.body?.subgroup ?? "").trim().toLowerCase();
  const subgroup = raw ? map[raw] : null;
  if (raw && !subgroup) return res.status(400).json({ error: "Подгруппа: А или Б" });

  db.prepare("UPDATE users SET subgroup = ? WHERE id = ?").run(subgroup, req.user.id);
  res.json({ ok: true, subgroup });
});

/** Создание новой группы: любой может завести свою и стать её старостой */
api.post("/groups", (req, res) => {
  if (!allowAttempt(`newgroup|${clientKey(req)}`, 5, 60_000)) return tooMany(res);

  const { groupName, code, name, password, program, profile } = req.body ?? {};
  const cleanCode = String(code ?? "").trim().toUpperCase();

  if (!groupName?.trim()) return res.status(400).json({ error: "Нужно название группы" });
  if (String(groupName).trim().length > 60) return res.status(400).json({ error: "Слишком длинное название" });
  if (!/^[A-ZА-ЯЁ0-9-]{3,20}$/.test(cleanCode)) {
    return res.status(400).json({ error: "Код: 3–20 символов, буквы/цифры/дефис" });
  }
  if (!name?.trim() || String(name).trim().length < 2) return res.status(400).json({ error: "Укажи своё имя" });
  if (String(password ?? "").length < 8) return res.status(400).json({ error: "Пароль минимум 8 символов" });

  const taken = db.prepare("SELECT id FROM groups WHERE code = ?").get(cleanCode);
  if (taken) return res.status(409).json({ error: "Такой код уже занят" });

  const { groupId } = makeGroup({
    name: String(groupName).trim(),
    code: cleanCode,
    starostaName: String(name).trim(),
    passwordHash: hashPassword(password),
  });

  if (program?.trim()) {
    db.prepare("UPDATE groups SET program = ?, profile = ? WHERE id = ?").run(
      String(program).trim(),
      profile?.trim() ? String(profile).trim() : null,
      groupId
    );
  }

  const user = db.prepare("SELECT * FROM users WHERE group_id = ? AND role = 'starosta'").get(groupId);
  const { token, expires } = createSession(user.id);
  res.setHeader("set-cookie", sessionCookie(token, expires, isSecureRequest(req)));
  res.status(201).json({ ok: true, group: { id: groupId, name: groupName.trim(), code: cleanCode }, user: userPublic(user) });
});

/** Смена кода группы: закрывает доступ посторонним, кто знает номер группы */
api.patch("/group", requireAdmin, (req, res) => {
  const code = String(req.body?.code ?? "").trim().toUpperCase();

  if (!/^[A-ZА-ЯЁ0-9-]{3,20}$/.test(code)) {
    return res.status(400).json({ error: "Код: 3–20 символов, буквы, цифры или дефис" });
  }

  const taken = db
    .prepare("SELECT id FROM groups WHERE code = ? AND id <> ?")
    .get(code, req.user.groupId);
  if (taken) return res.status(409).json({ error: "Такой код уже занят другой группой" });

  db.prepare("UPDATE groups SET code = ? WHERE id = ?").run(code, req.user.groupId);
  logAction(req.user, "group.code", code);
  res.json({ ok: true, code });
});

/* ───────────────────────── расписание ───────────────────────── */

function schedulePayload(user, dates) {
  const studentsTotal = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE group_id = ?")
    .get(user.groupId).n;
  const labels = subgroupLabels(user.groupId);

  return dates.map((iso) => {
    const date = parseIso(iso);
    const slots = slotsForDate(user.groupId, iso, user.subgroup);

    const hwRows = db
      .prepare(
        `SELECT id, title, description, due_date, subject_id, slot_id, author_id
         FROM homework WHERE group_id = ? AND assigned_on = ? AND status = 'approved' ORDER BY id`
      )
      .all(user.groupId, iso);

    return {
      date: iso,
      weekday: weekdayOf(date),
      label: formatDateRu(iso),
      parity: parityOn(date),
      lessons: slots.map((s) => {
        // ДЗ, привязанное к конкретной паре, показываем только на ней;
        // привязанное к предмету — на всех парах этого предмета за день
        const hw = hwRows.filter((h) => (h.slot_id ? h.slot_id === s.id : h.subject_id === s.subject_id));
        return lessonView(user.groupId, s, iso, user.id, studentsTotal, labels, hw);
      }),
    };
  });
}

api.get("/schedule", requireAuth, (req, res) => {
  const from = typeof req.query.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week)
    ? req.query.week
    : todayIso();
  res.json({ week: schedulePayload(req.user, weekDays(from)) });
});

api.get("/today", requireAuth, (req, res) => {
  const iso = todayIso();
  const [day] = schedulePayload(req.user, [iso]);
  const current = day.lessons.find((l) => l.status === "now");
  const next = day.lessons.find((l) => l.status === "upcoming");
  res.json({ today: day, currentSlotId: current?.slotId ?? null, nextSlotId: next?.slotId ?? null });
});

api.get("/members", requireAuth, (req, res) => {
  res.json(groupUsers(req.user.groupId));
});

api.get("/subjects", requireAuth, (req, res) => {
  res.json(
    db.prepare("SELECT id, name, teacher, color FROM subjects WHERE group_id = ? ORDER BY name").all(req.user.groupId)
  );
});

/* ──────────────────────── посещаемость ──────────────────────── */

api.post("/attendance", requireAuth, (req, res) => {
  const { slotId, date, status } = req.body ?? {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Неверный статус" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) return res.status(400).json({ error: "Неверная дата" });

  const slot = db.prepare("SELECT * FROM slots WHERE id = ? AND group_id = ?").get(Number(slotId), req.user.groupId);
  if (!slot) return res.status(404).json({ error: "Пара не найдена" });

  if (date < todayIso() && req.user.role !== "starosta") {
    return res.status(403).json({ error: "Прошедшие пары отмечает староста" });
  }

  db.prepare(
    `INSERT INTO attendance (slot_id, date, user_id, status, marked_at) VALUES (?,?,?,?,?)
     ON CONFLICT (slot_id, date, user_id) DO UPDATE SET status = excluded.status, marked_at = excluded.marked_at`
  ).run(slot.id, date, req.user.id, status, nowIso());

  const counts = attendanceCounts(slot.id, date);
  broadcast(req.user.groupId, "attendance", {
    slotId: slot.id, date, userId: req.user.id, status, counts,
  });

  res.json({ ok: true, slotId: slot.id, date, status, counts });
});

/** Отметить все пары дня одной кнопкой */
api.post("/attendance/day", requireAuth, (req, res) => {
  const { date, status } = req.body ?? {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Неверный статус" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) return res.status(400).json({ error: "Неверная дата" });

  if (date < todayIso() && req.user.role !== "starosta") {
    return res.status(403).json({ error: "Прошедшие пары отмечает староста" });
  }

  const slots = slotsForDate(req.user.groupId, date, req.user.subgroup);
  if (!slots.length) return res.status(400).json({ error: "В этот день нет пар" });

  const upsert = db.prepare(
    `INSERT INTO attendance (slot_id, date, user_id, status, marked_at) VALUES (?,?,?,?,?)
     ON CONFLICT (slot_id, date, user_id) DO UPDATE SET status = excluded.status, marked_at = excluded.marked_at`
  );

  const markedAt = nowIso();
  for (const slot of slots) upsert.run(slot.id, date, req.user.id, status, markedAt);

  logAction(req.user, "attendance.day", date, `${status} · ${slots.length} пар`);
  broadcast(req.user.groupId, "attendance", {
    bulk: true, date, userId: req.user.id, status, slotIds: slots.map((s) => s.id),
  });

  res.json({ ok: true, count: slots.length, date, status });
});

api.get("/attendance/:slotId", requireAuth, (req, res) => {
  const slotId = Number(req.params.slotId);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? "")) ? req.query.date : todayIso();

  const slot = db
    .prepare(
      `SELECT s.*, sub.name AS subject, sub.color FROM slots s
       JOIN subjects sub ON sub.id = s.subject_id
       WHERE s.id = ? AND s.group_id = ?`
    )
    .get(slotId, req.user.groupId);
  if (!slot) return res.status(404).json({ error: "Пара не найдена" });

  const people = db
    .prepare(
      `SELECT u.id, u.name, u.color, a.status, a.marked_at
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id AND a.slot_id = ? AND a.date = ?
       WHERE u.group_id = ?
       ORDER BY CASE a.status WHEN 'going' THEN 1 WHEN 'late' THEN 2 WHEN 'sick' THEN 3 WHEN 'absent' THEN 4 ELSE 5 END, u.name`
    )
    .all(slotId, date, req.user.groupId);

  res.json({
    lesson: {
      slotId: slot.id, date, pair: slot.pair, start: slot.start_time, end: slot.end_time,
      room: slot.room, subject: slot.subject, color: slot.color, subjectId: slot.subject_id,
    },
    people,
    counts: attendanceCounts(slotId, date),
    homework: db
      .prepare(
        `SELECT h.id, h.title, h.description, h.due_date, h.author_id, au.name AS author_name
         FROM homework h LEFT JOIN users au ON au.id = h.author_id
         WHERE h.group_id = ? AND h.assigned_on = ? AND h.status = 'approved'
           AND (h.slot_id = ? OR (h.slot_id IS NULL AND h.subject_id = ?))
         ORDER BY h.id`
      )
      .all(req.user.groupId, date, slot.id, slot.subject_id),
  });
});

/* ───────────────────────── статистика ───────────────────────── */

function rangeOrDefault(from, to) {
  const toIsoStr = /^\d{4}-\d{2}-\d{2}$/.test(String(to ?? "")) ? to : todayIso();
  const fromIsoStr = /^\d{4}-\d{2}-\d{2}$/.test(String(from ?? ""))
    ? from
    : toIso(addDays(parseIso(toIsoStr), -120));
  return { from: fromIsoStr, to: toIsoStr };
}

api.get("/stats/group", requireAuth, (req, res) => {
  const { from, to } = rangeOrDefault(req.query.from, req.query.to);

  const students = db
    .prepare(
      `SELECT u.id, u.name, u.color,
         COALESCE(SUM(CASE WHEN a.status='going' THEN 1 ELSE 0 END),0) AS going,
         COALESCE(SUM(CASE WHEN a.status='late' THEN 1 ELSE 0 END),0) AS late,
         COALESCE(SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END),0) AS absent,
         COALESCE(SUM(CASE WHEN a.status='sick' THEN 1 ELSE 0 END),0) AS sick
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id AND a.date BETWEEN ? AND ?
       WHERE u.group_id = ?
       GROUP BY u.id ORDER BY u.name`
    )
    .all(from, to, req.user.groupId)
    .map((s) => {
      const total = s.going + s.late + s.absent + s.sick;
      return { ...s, total, rate: total ? Math.round(((s.going + s.late) / total) * 100) : null };
    });

  const bySubject = db
    .prepare(
      `SELECT sub.id, sub.name, sub.color,
         COALESCE(SUM(CASE WHEN a.status IN ('going','late') THEN 1 ELSE 0 END),0) AS visited,
         COALESCE(SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END),0) AS absent,
         COUNT(a.id) AS total
       FROM subjects sub
       LEFT JOIN slots s ON s.subject_id = sub.id
       LEFT JOIN attendance a ON a.slot_id = s.id AND a.date BETWEEN ? AND ?
       WHERE sub.group_id = ?
       GROUP BY sub.id ORDER BY sub.name`
    )
    .all(from, to, req.user.groupId)
    .map((s) => ({ ...s, rate: s.total ? Math.round((s.visited / s.total) * 100) : null }));

  const atRisk = students.filter((s) => s.rate !== null && s.rate < 60);
  res.json({ from, to, students, bySubject, atRisk });
});

api.get("/stats/me", requireAuth, (req, res) => {
  const { from, to } = rangeOrDefault(req.query.from, req.query.to);

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status='going' THEN 1 ELSE 0 END),0) AS going,
         COALESCE(SUM(CASE WHEN status='late' THEN 1 ELSE 0 END),0) AS late,
         COALESCE(SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END),0) AS absent,
         COALESCE(SUM(CASE WHEN status='sick' THEN 1 ELSE 0 END),0) AS sick
       FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ?`
    )
    .get(req.user.id, from, to);

  const total = totals.going + totals.late + totals.absent + totals.sick;
  const rate = total ? Math.round(((totals.going + totals.late) / total) * 100) : null;

  const bySubject = db
    .prepare(
      `SELECT sub.id, sub.name, sub.color,
         COALESCE(SUM(CASE WHEN a.status IN ('going','late') THEN 1 ELSE 0 END),0) AS visited,
         COALESCE(SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END),0) AS absent,
         COUNT(a.id) AS total
       FROM subjects sub
       LEFT JOIN slots s ON s.subject_id = sub.id
       LEFT JOIN attendance a ON a.slot_id = s.id AND a.user_id = ? AND a.date BETWEEN ? AND ?
       WHERE sub.group_id = ?
       GROUP BY sub.id ORDER BY sub.name`
    )
    .all(req.user.id, from, to, req.user.groupId)
    .map((s) => ({ ...s, rate: s.total ? Math.round((s.visited / s.total) * 100) : null }));

  // Серия: подряд идущие учебные дни без пропусков (по отметкам, где был absent)
  const recent = db
    .prepare(
      `SELECT date, SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END) AS absent
       FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ?
       GROUP BY date ORDER BY date DESC`
    )
    .all(req.user.id, from, to);

  let streak = 0;
  for (const day of recent) {
    if (day.absent > 0) break;
    streak++;
  }

  res.json({ from, to, totals: { ...totals, total, rate }, bySubject, streak });
});

/* ───────────────────── объявления и дедлайны ───────────────────── */

api.get("/announcements", requireAuth, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT a.*, u.name AS author_name, u.color AS author_color
         FROM announcements a JOIN users u ON u.id = a.author_id
         WHERE a.group_id = ? ORDER BY a.pinned DESC, a.created_at DESC LIMIT 50`
      )
      .all(req.user.groupId)
  );
});

api.post("/announcements", requireAdmin, (req, res) => {
  const { title, body, pinned } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: "Нужен заголовок" });
  const r = db
    .prepare("INSERT INTO announcements (group_id, author_id, title, body, pinned, created_at) VALUES (?,?,?,?,?,?)")
    .run(req.user.groupId, req.user.id, title.trim(), String(body ?? "").trim(), pinned ? 1 : 0, nowIso());
  const row = db.prepare("SELECT * FROM announcements WHERE id = ?").get(Number(r.lastInsertRowid));
  logAction(req.user, "announcement.add", row.title);
  broadcast(req.user.groupId, "announcement", row);

  // push всей группе — не блокируем ответ
  sendToGroup(req.user.groupId, {
    title: `${row.pinned ? "📌 " : ""}${row.title}`,
    body: row.body || "Новое объявление от старосты",
    url: "/news",
    tag: `announcement-${row.id}`,
  }).catch(() => {});

  res.status(201).json(row);
});

api.delete("/announcements/:id", requireAdmin, (req, res) => {
  const row = db
    .prepare("SELECT title FROM announcements WHERE id = ? AND group_id = ?")
    .get(Number(req.params.id), req.user.groupId);
  db.prepare("DELETE FROM announcements WHERE id = ? AND group_id = ?").run(Number(req.params.id), req.user.groupId);
  if (row) logAction(req.user, "announcement.delete", row.title);
  res.json({ ok: true });
});

api.get("/deadlines", requireAuth, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT d.*, sub.name AS subject, sub.color
         FROM deadlines d LEFT JOIN subjects sub ON sub.id = d.subject_id
         WHERE d.group_id = ? ORDER BY d.due_date LIMIT 50`
      )
      .all(req.user.groupId)
  );
});

api.post("/deadlines", requireAdmin, (req, res) => {
  const { title, dueDate, subjectId } = req.body ?? {};
  if (!title?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate ?? ""))) {
    return res.status(400).json({ error: "Нужны название и дата" });
  }
  const r = db
    .prepare("INSERT INTO deadlines (group_id, subject_id, title, due_date, created_at) VALUES (?,?,?,?,?)")
    .run(req.user.groupId, subjectId ? Number(subjectId) : null, title.trim(), dueDate, nowIso());
  const created = db.prepare("SELECT * FROM deadlines WHERE id = ?").get(Number(r.lastInsertRowid));
  logAction(req.user, "deadline.add", title.trim(), dueDate);
  res.status(201).json(created);
});

api.delete("/deadlines/:id", requireAdmin, (req, res) => {
  const row = db
    .prepare("SELECT title FROM deadlines WHERE id = ? AND group_id = ?")
    .get(Number(req.params.id), req.user.groupId);
  db.prepare("DELETE FROM deadlines WHERE id = ? AND group_id = ?").run(Number(req.params.id), req.user.groupId);
  if (row) logAction(req.user, "deadline.delete", row.title);
  res.json({ ok: true });
});

/* ───────────────────────── домашние задания ───────────────────────── */

api.get("/homework", requireAuth, (req, res) => {
  const isAdmin = req.user.role === "starosta";
  const rows = db
    .prepare(
      `SELECT h.id, h.title, h.description, h.due_date, h.assigned_on, h.created_at, h.status,
              h.author_id, au.name AS author_name,
              s.name AS subject, s.color,
              (SELECT COUNT(*) FROM homework_done d WHERE d.homework_id = h.id) AS done_count,
              (SELECT COUNT(*) FROM users u WHERE u.group_id = h.group_id) AS total,
              EXISTS(SELECT 1 FROM homework_done d WHERE d.homework_id = h.id AND d.user_id = ?) AS mine
       FROM homework h
       LEFT JOIN subjects s ON s.id = h.subject_id
       LEFT JOIN users au ON au.id = h.author_id
       WHERE h.group_id = ? AND (? = 1 OR h.status = 'approved' OR h.author_id = ?)
       ORDER BY (h.due_date IS NULL), h.due_date, h.created_at DESC`
    )
    .all(req.user.id, req.user.groupId, isAdmin ? 1 : 0, req.user.id);

  res.json(rows.map((r) => ({ ...r, mine: Boolean(r.mine) })));
});

api.post("/homework", requireAuth, (req, res) => {
  const { title, description, subjectId, dueDate, assignedOn, slotId } = req.body ?? {};
  if (!title?.trim()) return res.status(400).json({ error: "Нужно название задания" });

  const assigned = /^\d{4}-\d{2}-\d{2}$/.test(String(assignedOn ?? "")) ? assignedOn : todayIso();
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate))) {
    return res.status(400).json({ error: "Неверная дата" });
  }

  const subject = subjectId
    ? db.prepare("SELECT id FROM subjects WHERE id = ? AND group_id = ?").get(Number(subjectId), req.user.groupId)
    : null;

  const slot = slotId
    ? db.prepare("SELECT id FROM slots WHERE id = ? AND group_id = ?").get(Number(slotId), req.user.groupId)
    : null;

  const status = req.user.role === "starosta" ? "approved" : "pending";

  const r = db
    .prepare(
      `INSERT INTO homework (group_id, subject_id, slot_id, author_id, title, description, due_date, assigned_on, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      req.user.groupId,
      subject ? subject.id : null,
      slot ? slot.id : null,
      req.user.id,
      title.trim().slice(0, 160),
      String(description ?? "").trim().slice(0, 2000),
      dueDate || null,
      assigned,
      status,
      nowIso()
    );

  const row = db.prepare("SELECT * FROM homework WHERE id = ?").get(Number(r.lastInsertRowid));
  logAction(req.user, "homework.add", title.trim().slice(0, 80), status === "pending" ? "на проверке" : "опубликовано");
  broadcast(req.user.groupId, "homework", row);
  res.status(201).json(row);
});

api.delete("/homework/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const hw = db
    .prepare("SELECT id, author_id FROM homework WHERE id = ? AND group_id = ?")
    .get(id, req.user.groupId);
  if (!hw) return res.status(404).json({ error: "Задание не найдено" });

  if (req.user.role !== "starosta" && hw.author_id !== req.user.id) {
    return res.status(403).json({ error: "Удалить может автор или староста" });
  }

  db.prepare("DELETE FROM homework WHERE id = ?").run(id);
  broadcast(req.user.groupId, "homework", { id, deleted: true });
  res.json({ ok: true });
});

api.post("/homework/:id/toggle", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const hw = db
    .prepare("SELECT id FROM homework WHERE id = ? AND group_id = ?")
    .get(id, req.user.groupId);
  if (!hw) return res.status(404).json({ error: "Задание не найдено" });

  const done = db
    .prepare("SELECT 1 FROM homework_done WHERE homework_id = ? AND user_id = ?")
    .get(id, req.user.id);

  if (done) {
    db.prepare("DELETE FROM homework_done WHERE homework_id = ? AND user_id = ?").run(id, req.user.id);
  } else {
    db.prepare("INSERT INTO homework_done (homework_id, user_id, done_at) VALUES (?,?,?)").run(
      id,
      req.user.id,
      nowIso()
    );
  }

  const count = db.prepare("SELECT COUNT(*) AS n FROM homework_done WHERE homework_id = ?").get(id).n;
  broadcast(req.user.groupId, "homework", { id, doneCount: count });
  res.json({ ok: true, mine: !done, doneCount: count });
});

/* ───────────────────────── полезные файлы ───────────────────────── */

const ALLOWED_EXT = new Set([
  ".pdf", ".djvu", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
  ".txt", ".md", ".rtf", ".csv", ".zip", ".rar", ".7z",
  ".png", ".jpg", ".jpeg", ".webp",
]);

const fileRow = (id, groupId) =>
  db
    .prepare(
      `SELECT f.*, u.name AS uploader_name, s.name AS subject, s.color
       FROM files f
       LEFT JOIN users u ON u.id = f.uploader_id
       LEFT JOIN subjects s ON s.id = f.subject_id
       WHERE f.id = ? AND f.group_id = ?`
    )
    .get(id, groupId);

api.get("/files", requireAuth, (req, res) => {
  const isAdmin = req.user.role === "starosta";
  const rows = db
    .prepare(
      `SELECT f.id, f.name, f.mime, f.size, f.created_at, f.status, f.subject_id, f.uploader_id,
              u.name AS uploader_name, s.name AS subject, s.color
       FROM files f
       LEFT JOIN users u ON u.id = f.uploader_id
       LEFT JOIN subjects s ON s.id = f.subject_id
       WHERE f.group_id = ? AND (? = 1 OR f.status = 'approved' OR f.uploader_id = ?)
       ORDER BY f.created_at DESC`
    )
    .all(req.user.groupId, isAdmin ? 1 : 0, req.user.id);
  res.json(rows);
});

api.post("/files", requireAuth, express.raw({ type: () => true, limit: "40mb" }), (req, res) => {
  const rawName = String(req.query.name ?? "").trim();
  if (!rawName) return res.status(400).json({ error: "Не передано имя файла" });

  const ext = extname(rawName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return res.status(400).json({ error: `Тип ${ext || "без расширения"} не поддерживается` });
  }

  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return res.status(400).json({ error: "Пустой файл" });
  }

  let subjectId = null;
  if (req.query.subjectId) {
    const subject = db
      .prepare("SELECT id FROM subjects WHERE id = ? AND group_id = ?")
      .get(Number(req.query.subjectId), req.user.groupId);
    if (!subject) return res.status(400).json({ error: "Предмет не найден" });
    subjectId = subject.id;
  }

  const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  const storedName = `${randomBytes(16).toString("hex")}${ext}`;
  writeFileSync(join(UPLOADS_DIR, storedName), body);

  const status = req.user.role === "starosta" ? "approved" : "pending";

  const r = db
    .prepare(
      `INSERT INTO files (group_id, subject_id, uploader_id, name, stored_name, mime, size, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(
      req.user.groupId,
      subjectId,
      req.user.id,
      safeName,
      storedName,
      String(req.headers["content-type"] ?? "application/octet-stream").slice(0, 120),
      body.length,
      status,
      nowIso()
    );

  const row = fileRow(Number(r.lastInsertRowid), req.user.groupId);
  logAction(req.user, "file.add", safeName, status === "pending" ? "на проверке" : "опубликован");
  broadcast(req.user.groupId, "files", row);
  res.status(201).json(row);
});

api.get("/files/:id/download", requireAuth, (req, res) => {
  const f = db
    .prepare("SELECT * FROM files WHERE id = ? AND group_id = ?")
    .get(Number(req.params.id), req.user.groupId);
  if (!f) return res.status(404).json({ error: "Файл не найден" });

  const full = join(UPLOADS_DIR, f.stored_name);
  if (!existsSync(full)) return res.status(410).json({ error: "Файл потерян на диске" });

  res.setHeader("content-type", f.mime || "application/octet-stream");
  res.setHeader(
    "content-disposition",
    `attachment; filename="file${extname(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`
  );
  res.sendFile(full);
});

api.delete("/files/:id", requireAuth, (req, res) => {
  const f = db
    .prepare("SELECT * FROM files WHERE id = ? AND group_id = ?")
    .get(Number(req.params.id), req.user.groupId);
  if (!f) return res.status(404).json({ error: "Файл не найден" });

  if (req.user.role !== "starosta" && f.uploader_id !== req.user.id) {
    return res.status(403).json({ error: "Удалить может автор или староста" });
  }

  try {
    unlinkSync(join(UPLOADS_DIR, f.stored_name));
  } catch {
    /* уже нет на диске */
  }
  db.prepare("DELETE FROM files WHERE id = ?").run(f.id);
  res.json({ ok: true });
});

/* ───────────────────────── модерация ───────────────────────── */

api.get("/moderation", requireAdmin, (req, res) => {
  const homework = db
    .prepare(
      `SELECT h.id, h.title, h.description, h.due_date, h.assigned_on, h.created_at,
              h.author_id, u.name AS author_name, s.name AS subject, s.color
       FROM homework h
       LEFT JOIN users u ON u.id = h.author_id
       LEFT JOIN subjects s ON s.id = h.subject_id
       WHERE h.group_id = ? AND h.status = 'pending'
       ORDER BY h.id DESC`
    )
    .all(req.user.groupId);

  const files = db
    .prepare(
      `SELECT f.id, f.name, f.size, f.created_at, f.uploader_id, f.subject_id,
              u.name AS uploader_name, s.name AS subject, s.color
       FROM files f
       LEFT JOIN users u ON u.id = f.uploader_id
       LEFT JOIN subjects s ON s.id = f.subject_id
       WHERE f.group_id = ? AND f.status = 'pending'
       ORDER BY f.id DESC`
    )
    .all(req.user.groupId);

  res.json({ homework, files });
});

api.post("/moderation/:type/:id", requireAdmin, (req, res) => {
  const type = req.params.type;
  const id = Number(req.params.id);
  const decision = req.body?.decision;

  if (!["approve", "reject"].includes(decision)) {
    return res.status(400).json({ error: "decision: approve или reject" });
  }

  if (type === "homework") {
    const row = db
      .prepare("SELECT id, title FROM homework WHERE id = ? AND group_id = ?")
      .get(id, req.user.groupId);
    if (!row) return res.status(404).json({ error: "Задание не найдено" });

    if (decision === "approve") {
      db.prepare("UPDATE homework SET status = 'approved' WHERE id = ?").run(id);
    } else {
      db.prepare("DELETE FROM homework WHERE id = ?").run(id);
    }

    logAction(req.user, `homework.${decision}`, row.title);
    broadcast(req.user.groupId, "homework", { id, moderation: decision });
    return res.json({ ok: true });
  }

  if (type === "files") {
    const row = db
      .prepare("SELECT * FROM files WHERE id = ? AND group_id = ?")
      .get(id, req.user.groupId);
    if (!row) return res.status(404).json({ error: "Файл не найден" });

    if (decision === "approve") {
      db.prepare("UPDATE files SET status = 'approved' WHERE id = ?").run(id);
    } else {
      try {
        unlinkSync(join(UPLOADS_DIR, row.stored_name));
      } catch {
        /* уже удалён */
      }
      db.prepare("DELETE FROM files WHERE id = ?").run(id);
    }

    logAction(req.user, `file.${decision}`, row.name);
    broadcast(req.user.groupId, "files", { id, moderation: decision });
    return res.json({ ok: true });
  }

  res.status(400).json({ error: "Неизвестный тип" });
});

api.get("/audit", requireAdmin, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT id, actor_name, action, target, detail, created_at
         FROM audit WHERE group_id = ? ORDER BY id DESC LIMIT 60`
      )
      .all(req.user.groupId)
  );
});

/* ───────────────────────── админ: расписание ───────────────────────── */

api.post("/slots", requireAdmin, (req, res) => {
  const { subjectId, weekday, pair, room, parity } = req.body ?? {};
  const subj = db.prepare("SELECT * FROM subjects WHERE id = ? AND group_id = ?").get(Number(subjectId), req.user.groupId);
  if (!subj) return res.status(400).json({ error: "Предмет не найден" });
  const p = Number(pair);
  const [start, end] = pairTimes(p);
  if (!start) return res.status(400).json({ error: "Неверный номер пары" });

  const r = db
    .prepare(
      `INSERT INTO slots (group_id, subject_id, weekday, pair, start_time, end_time, room, teacher, parity)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .run(req.user.groupId, subj.id, Number(weekday), p, start, end, String(room ?? ""), subj.teacher, parity ?? "all");
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

api.delete("/slots/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM slots WHERE id = ? AND group_id = ?").run(Number(req.params.id), req.user.groupId);
  res.json({ ok: true });
});

api.post("/subjects", requireAdmin, (req, res) => {
  const { name, teacher, color } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: "Нужно название" });
  const r = db
    .prepare("INSERT INTO subjects (group_id, name, teacher, color) VALUES (?,?,?,?)")
    .run(req.user.groupId, name.trim(), String(teacher ?? ""), color ?? "#6c8cff");
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

/* ─────────────────────────── экспорт ─────────────────────────── */

api.get("/export/attendance.csv", requireAdmin, (req, res) => {
  const { from, to } = rangeOrDefault(req.query.from, req.query.to);
  const rows = db
    .prepare(
      `SELECT a.date, s.pair, sub.name AS subject, u.name AS student, a.status
       FROM attendance a
       JOIN slots s ON s.id = a.slot_id
       JOIN subjects sub ON sub.id = s.subject_id
       JOIN users u ON u.id = a.user_id
       WHERE s.group_id = ? AND a.date BETWEEN ? AND ?
       ORDER BY a.date, s.pair, u.name`
    )
    .all(req.user.groupId, from, to);

  const labels = { going: "Был", late: "Опоздал", absent: "Не был", sick: "Уважительная" };
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ["Дата", "Пара", "Предмет", "Студент", "Статус"].map(esc).join(";"),
    ...rows.map((r) => [r.date, r.pair, r.subject, r.student, labels[r.status] ?? r.status].map(esc).join(";")),
  ];
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="attendance_${from}_${to}.csv"`);
  res.send("\uFEFF" + lines.join("\r\n"));
});

/* ───────────────────────── push-уведомления ───────────────────────── */

api.get("/push/key", (req, res) => {
  res.json({ publicKey: publicKey() });
});

api.get("/push/status", requireAuth, (req, res) => {
  res.json({ subscribed: userHasSubscription(req.user.id) });
});

api.post("/push/subscribe", requireAuth, (req, res) => {
  try {
    saveSubscription(req.user.id, req.body?.subscription);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

api.post("/push/unsubscribe", requireAuth, (req, res) => {
  if (req.body?.endpoint) removeSubscription(req.body.endpoint);
  res.json({ ok: true });
});

api.post("/push/test", requireAuth, async (req, res) => {
  const sent = await sendTest(req.user.id);
  res.json({ ok: true, sent });
});

/* ─────────────────────────── демо ─────────────────────────── */

api.post("/demo/seed", (req, res) => {
  if (!isEmpty()) return res.status(403).json({ error: "База уже не пустая" });
  seedDemo(hashPassword("demo1234"));
  res.json({ ok: true, code: "PMI21", password: "demo1234" });
});
