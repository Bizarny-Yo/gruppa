import { Router } from "express";
import { db, nowIso, isEmpty, makeGroup, seedDemo, pairTimes, getSetting } from "./db.js";
import {
  hashPassword, verifyPassword, createSession, destroySession,
  userFromRequest, requireAuth, requireAdmin, sessionCookie, clearCookie, parseCookies,
} from "./auth.js";
import {
  publicKey, saveSubscription, removeSubscription, sendTest, sendToGroup, userHasSubscription,
} from "./push.js";
import {
  todayIso, weekdayOf, parityOf, parityFor, parseIso, weekDays, toIso, addDays,
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

function lessonView(groupId, slot, iso, userId, studentsTotal, labels = new Map()) {
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
  };
}

/* ──────────────────────────── auth ──────────────────────────── */

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
  res.setHeader("set-cookie", sessionCookie(token, expires));
  res.json({ user: userPublic(user) });
});

api.post("/auth/register", (req, res) => {
  const { code, name, password } = req.body ?? {};
  if (!code || !name?.trim() || !password) return res.status(400).json({ error: "Заполните все поля" });
  if (String(password).length < 4) return res.status(400).json({ error: "Пароль минимум 4 символа" });

  const group = db.prepare("SELECT * FROM groups WHERE code = ?").get(String(code).trim().toUpperCase());
  if (!group) return res.status(404).json({ error: "Группа с таким кодом не найдена" });

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
  res.setHeader("set-cookie", sessionCookie(token, expires));
  broadcast(group.id, "roster", { reason: "new-student" });
  res.status(201).json({ user: { id: Number(r.lastInsertRowid), name: name.trim(), role: "student", color } });
});

api.post("/auth/login", (req, res) => {
  const { code, name, password } = req.body ?? {};
  if (!code || !name || !password) return res.status(400).json({ error: "Заполните все поля" });

  const group = db.prepare("SELECT * FROM groups WHERE code = ?").get(String(code).trim().toUpperCase());
  if (!group) return res.status(404).json({ error: "Группа не найдена" });

  const user = db
    .prepare("SELECT * FROM users WHERE group_id = ? AND lower(name) = lower(?)")
    .get(group.id, String(name).trim());

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Неверное имя или пароль" });
  }

  const { token, expires } = createSession(user.id);
  res.setHeader("set-cookie", sessionCookie(token, expires));
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
  res.json({ ok: true, name });
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

/* ───────────────────────── расписание ───────────────────────── */

function schedulePayload(user, dates) {
  const studentsTotal = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE group_id = ?")
    .get(user.groupId).n;
  const labels = subgroupLabels(user.groupId);

  return dates.map((iso) => {
    const date = parseIso(iso);
    const slots = slotsForDate(user.groupId, iso, user.subgroup);
    return {
      date: iso,
      weekday: weekdayOf(date),
      label: formatDateRu(iso),
      parity: parityOn(date),
      lessons: slots.map((s) => lessonView(user.groupId, s, iso, user.id, studentsTotal, labels)),
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
      room: slot.room, subject: slot.subject, color: slot.color,
    },
    people,
    counts: attendanceCounts(slotId, date),
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
  db.prepare("DELETE FROM announcements WHERE id = ? AND group_id = ?").run(Number(req.params.id), req.user.groupId);
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
  res.status(201).json(db.prepare("SELECT * FROM deadlines WHERE id = ?").get(Number(r.lastInsertRowid)));
});

api.delete("/deadlines/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM deadlines WHERE id = ? AND group_id = ?").run(Number(req.params.id), req.user.groupId);
  res.json({ ok: true });
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
