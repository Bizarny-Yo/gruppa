/** Работа с датами: ISO-недели, чётность, учебные дни. Всё в локальном времени сервера. */

export function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayIso() {
  return toIso(new Date());
}

/** 1 = понедельник … 7 = воскресенье */
export function weekdayOf(date) {
  return ((date.getDay() + 6) % 7) + 1;
}

/** Номер ISO-недели (1..53) */
export function isoWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayNum + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const diff = d - firstThursday;
  return 1 + Math.round(diff / (7 * 86400000));
}

/** Чётность недели: 'odd' для нечётной (числитель), 'even' для чётной (знаменатель) */
export function parityOf(date) {
  return isoWeek(date) % 2 === 0 ? "even" : "odd";
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Понедельник недели, в которую попадает дата */
export function mondayOf(date) {
  return addDays(date, -(((date.getDay() + 6) % 7)));
}

export function weekDays(fromIso) {
  const monday = mondayOf(parseIso(fromIso));
  return Array.from({ length: 7 }, (_, i) => toIso(addDays(monday, i)));
}

export const WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export const PAIR_TIMES = [
  ["08:30", "10:00"],
  ["10:10", "11:40"],
  ["12:10", "13:40"],
  ["14:00", "15:30"],
  ["16:00", "17:30"],
  ["17:40", "19:10"],
];

export function minutesOf(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Текущее время в минутах от полуночи */
export function nowMinutes(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

export function formatDateRu(iso) {
  const d = parseIso(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}
