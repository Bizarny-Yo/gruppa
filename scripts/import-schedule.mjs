/**
 * Импорт настоящего расписания из JSON в группу.
 * Заменяет предметы и пары группы (отметки посещаемости удаляются каскадом).
 *
 * Запуск: node scripts/import-schedule.mjs [файл.json] [код группы]
 */

import { readFile } from "node:fs/promises";
import { db, setSetting, getSetting } from "../server/db.js";

const file = process.argv[2] ?? "scripts/data/schedule-2026-autumn.json";
const codeArg = process.argv[3];

const data = JSON.parse(await readFile(file, "utf8"));

let group = codeArg
  ? db.prepare("SELECT * FROM groups WHERE code = ?").get(codeArg)
  : db.prepare("SELECT * FROM groups WHERE code = ?").get(data.group.code) ??
    db.prepare("SELECT * FROM groups ORDER BY id LIMIT 1").get();

if (!group) {
  console.error("Группа не найдена. Сначала создай её в приложении.");
  process.exit(1);
}

if (data.semesterStart) setSetting("semester_start", data.semesterStart);

const tx = db.prepare("SELECT COUNT(*) AS n FROM slots WHERE group_id = ?").get(group.id).n;

db.exec("BEGIN");
try {
  db.prepare("DELETE FROM slots WHERE group_id = ?").run(group.id);
  db.prepare("DELETE FROM subjects WHERE group_id = ?").run(group.id);

  const subjectIds = new Map();
  const insSubject = db.prepare(
    "INSERT INTO subjects (group_id, name, teacher, color) VALUES (?,?,?,?)"
  );

  for (const s of data.subjects) {
    const firstTeacher = data.slots.find((x) => x.subject === s.name)?.teacher ?? "";
    const r = insSubject.run(group.id, s.name, firstTeacher, s.color ?? "#6c8cff");
    subjectIds.set(s.name, Number(r.lastInsertRowid));
  }

  const insSlot = db.prepare(
    `INSERT INTO slots
      (group_id, subject_id, weekday, pair, start_time, end_time, room, teacher, parity, starts_on, ends_on, subgroup)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  for (const s of data.slots) {
    const subjectId = subjectIds.get(s.subject);
    if (!subjectId) {
      console.warn("  ! неизвестный предмет:", s.subject);
      continue;
    }
    insSlot.run(
      group.id,
      subjectId,
      s.weekday,
      s.pair,
      s.start,
      s.end,
      s.room ?? "",
      s.teacher ?? "",
      s.parity ?? "all",
      s.from ?? null,
      s.to ?? null,
      s.subgroup ?? null
    );
  }

  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  console.error("Импорт отменён:", err.message);
  process.exit(1);
}

const total = db.prepare("SELECT COUNT(*) AS n FROM slots WHERE group_id = ?").get(group.id).n;
const subjects = db.prepare("SELECT COUNT(*) AS n FROM subjects WHERE group_id = ?").get(group.id).n;
const range = db
  .prepare("SELECT MIN(starts_on) AS a, MAX(ends_on) AS b FROM slots WHERE group_id = ?")
  .get(group.id);

console.log(`Группа: ${group.name} (${group.code})`);
console.log(`Семестр с: ${getSetting("semester_start")}`);
console.log(`Удалено старых пар: ${tx}`);
console.log(`Предметов: ${subjects}, пар: ${total}`);
console.log(`Даты: ${range.a ?? "—"} … ${range.b ?? "—"}`);

const perDay = db
  .prepare(
    `SELECT weekday, COUNT(*) AS n FROM slots WHERE group_id = ? GROUP BY weekday ORDER BY weekday`
  )
  .all(group.id);
console.log("По дням:", perDay.map((d) => `${["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][d.weekday]}=${d.n}`).join(", "));
