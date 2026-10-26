import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "gruppa.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6c8cff',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  teacher TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#6c8cff'
);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  pair INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  teacher TEXT NOT NULL DEFAULT '',
  parity TEXT NOT NULL DEFAULT 'all'
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  marked_at TEXT NOT NULL,
  UNIQUE (slot_id, date, user_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deadlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  slot_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  UNIQUE (user_id, slot_id, date, kind)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slots_group ON slots(group_id, weekday);CREATE INDEX IF NOT EXISTS idx_att_slot_date ON attendance(slot_id, date);
CREATE INDEX IF NOT EXISTS idx_att_user ON attendance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

export const nowIso = () => new Date().toISOString();

/* ─────────────── настройки и миграции ─────────────── */

export function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// Расписание из вуза: произвольные время, даты действия и подгруппы
ensureColumn("slots", "starts_on", "starts_on TEXT");
ensureColumn("slots", "ends_on", "ends_on TEXT");
ensureColumn("slots", "subgroup", "subgroup TEXT");
ensureColumn("users", "subgroup", "subgroup TEXT");

if (!getSetting("semester_start")) {
  // По умолчанию — понедельник недели, в которую попадает 1 сентября текущего года
  const year = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const sep1 = new Date(year, 8, 1);
  const monday = new Date(sep1);
  monday.setDate(sep1.getDate() - ((sep1.getDay() + 6) % 7));
  setSetting("semester_start", monday.toISOString().slice(0, 10));
}

export function isEmpty() {
  return db.prepare("SELECT COUNT(*) AS n FROM groups").get().n === 0;
}

const PAIRS = [
  ["08:30", "10:00"],
  ["10:10", "11:40"],
  ["12:10", "13:40"],
  ["14:00", "15:30"],
  ["16:00", "17:30"],
  ["17:40", "19:10"],
];

export function pairTimes(n) {
  return PAIRS[n - 1] ?? ["", ""];
}

export function makeGroup({ name, code, starostaName, passwordHash }) {
  const created = nowIso();
  const g = db.prepare("INSERT INTO groups (name, code, created_at) VALUES (?,?,?)").run(name, code, created);
  const groupId = Number(g.lastInsertRowid);
  const u = db
    .prepare("INSERT INTO users (group_id, name, role, password_hash, color, created_at) VALUES (?,?,?,?,?,?)")
    .run(groupId, starostaName, "starosta", passwordHash, "#6c8cff", created);
  return { groupId, starostaId: Number(u.lastInsertRowid) };
}

/** Демо-данные: одна группа, 6 предметов, расписание, немного отметок. */
export function seedDemo(passwordHash) {
  if (!isEmpty()) return;

  const { groupId } = makeGroup({
    name: "ПМИ-21",
    code: "PMI21",
    starostaName: "Артём Соколов",
    passwordHash,
  });

  const students = [
    "Алина Ковалёва", "Максим Орлов", "Дарья Никитина", "Иван Лебедев",
    "София Морозова", "Кирилл Волков", "Полина Зайцева", "Егор Смирнов",
    "Виктория Павлова", "Никита Фёдоров", "Мария Иванова",
  ];
  const colors = ["#38d39f", "#f5a524", "#ff7b8a", "#b57bff", "#4dd0e1", "#6c8cff"];
  const insUser = db.prepare(
    "INSERT INTO users (group_id, name, role, password_hash, color, created_at) VALUES (?,?,?,?,?,?)"
  );
  for (const [i, n] of students.entries()) {
    insUser.run(groupId, n, "student", passwordHash, colors[i % colors.length], nowIso());
  }

  const subjects = [
    ["Математический анализ", "доц. Кравцова А. И.", "#6c8cff"],
    ["Линейная алгебра", "проф. Мельник О. В.", "#38d39f"],
    ["Программирование", "ст. преп. Гусев Д. А.", "#f5a524"],
    ["Базы данных", "доц. Лаврова Е. С.", "#b57bff"],
    ["Физика", "доц. Тарасов И. Н.", "#ff7b8a"],
    ["История", "доц. Белова М. П.", "#4dd0e1"],
  ];
  const insSubject = db.prepare(
    "INSERT INTO subjects (group_id, name, teacher, color) VALUES (?,?,?,?)"
  );
  const subjectIds = subjects.map(([name, teacher, color]) =>
    Number(insSubject.run(groupId, name, teacher, color).lastInsertRowid)
  );

  // [weekday, pair, subjectIndex, room, parity]
  const plan = [
    [1, 1, 0, "402", "all"], [1, 2, 0, "402", "all"], [1, 3, 2, "115", "all"], [1, 4, 2, "115", "all"],
    [2, 1, 1, "301", "all"], [2, 2, 1, "301", "all"], [2, 3, 4, "210", "all"],
    [3, 1, 2, "115", "all"], [3, 2, 3, "116", "all"], [3, 3, 3, "116", "all"],
    [4, 1, 0, "402", "all"], [4, 2, 5, "207", "all"], [4, 3, 4, "210", "all"],
    [5, 1, 3, "116", "all"], [5, 2, 0, "402", "even"], [5, 3, 2, "115", "odd"],
    [6, 1, 5, "207", "all"],
  ];
  const insSlot = db.prepare(
    `INSERT INTO slots (group_id, subject_id, weekday, pair, start_time, end_time, room, teacher, parity)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  for (const [weekday, pair, si, room, parity] of plan) {
    const [start, end] = pairTimes(pair);
    insSlot.run(groupId, subjectIds[si], weekday, pair, start, end, room, subjects[si][1], parity);
  }

  // Отметки за сегодня, чтобы экран не был пустым
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const weekday = ((today.getDay() + 6) % 7) + 1;
  const todaySlots = db
    .prepare("SELECT id FROM slots WHERE group_id = ? AND weekday = ? AND parity IN ('all','odd','even') ORDER BY pair")
    .all(groupId, weekday);
  const users = db.prepare("SELECT id FROM users WHERE group_id = ? ORDER BY id").all(groupId);
  const insAtt = db.prepare(
    "INSERT OR IGNORE INTO attendance (slot_id, date, user_id, status, marked_at) VALUES (?,?,?,?,?)"
  );
  const statuses = ["going", "going", "going", "going", "late", "absent", "going", "sick", "going", "going", "going"];
  for (const slot of todaySlots.slice(0, 2)) {
    users.forEach((u, i) => {
      if (i < 9) insAtt.run(slot.id, iso, u.id, statuses[i % statuses.length], nowIso());
    });
  }

  const insAnn = db.prepare(
    "INSERT INTO announcements (group_id, author_id, title, body, pinned, created_at) VALUES (?,?,?,?,?,?)"
  );
  const starosta = db.prepare("SELECT id FROM users WHERE group_id = ? AND role = 'starosta'").get(groupId);
  insAnn.run(groupId, starosta.id, "Перенос пары по базам данных", "В среду 3-я пара пройдёт в 210 аудитории вместо 116.", 1, nowIso());
  insAnn.run(groupId, starosta.id, "Лаба №3", "Дедлайн по лабораторной — пятница, сдать до пары.", 0, nowIso());

  const insDl = db.prepare(
    "INSERT INTO deadlines (group_id, subject_id, title, due_date, created_at) VALUES (?,?,?,?,?)"
  );
  const inDays = (n) => {
    const d = new Date(Date.now() + n * 86400000);
    return d.toISOString().slice(0, 10);
  };
  insDl.run(groupId, subjectIds[2], "Лабораторная №3: связный список", inDays(4), nowIso());
  insDl.run(groupId, subjectIds[3], "Курсовая: ER-диаграмма", inDays(9), nowIso());
  insDl.run(groupId, subjectIds[0], "Контрольная по пределам", inDays(2), nowIso());

  return groupId;
}
