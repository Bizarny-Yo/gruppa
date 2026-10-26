export const toIso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const parseIso = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (iso, n) => {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
};

export const todayIso = () => toIso(new Date());

export const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export const dayNumber = (iso) => parseIso(iso).getDate();
export const monthShort = (iso) => MONTHS_SHORT[parseIso(iso).getMonth()];

/** Сколько осталось до конца дня-дедлайна */
export function remainingMs(dueDate, now = Date.now()) {
  return new Date(`${dueDate}T23:59:59`).getTime() - now;
}

/** Человеческий обратный отсчёт */
export function formatRemaining(ms) {
  if (ms <= 0) return "просрочено";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин ${s} с`;
  return `${s} с`;
}
