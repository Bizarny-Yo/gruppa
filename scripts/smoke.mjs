/**
 * Smoke-тест API: поднимает сессию как настоящий клиент и проверяет основные сценарии.
 * Запуск: node scripts/smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? "http://127.0.0.1:47824";

let cookie = "";
let passed = 0;
let failed = 0;

async function call(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (auth && cookie) headers.cookie = cookie;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const pair = c.split(";")[0];
    if (pair.startsWith("sid=")) cookie = pair;
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* не JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

function check(name, condition, extra = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function section(title) {
  console.log(`\n▸ ${title}`);
}

const today = new Date();
const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

section("Служебное");
{
  const health = await call("/api/health", { auth: false });
  check("GET /api/health → 200", health.status === 200 && health.json?.ok === true);

  const html = await call("/", { auth: false });
  check("GET / отдаёт HTML", html.status === 200 && html.text.includes("<div id=\"root\">"));

  const unauth = await call("/api/me", { auth: false });
  check("GET /api/me без сессии → 401", unauth.status === 401);
}

section("Вход старосты");
let studentsTotal = 0;
{
  const login = await call("/api/auth/login", {
    method: "POST",
    auth: false,
    body: { code: "PMI21", name: "Артём Соколов", password: "demo1234" },
  });
  check("логин demo-старосты", login.status === 200 && login.json?.user?.role === "starosta", JSON.stringify(login.json));
  check("выдана сессионная cookie", cookie.startsWith("sid="));

  const me = await call("/api/me");
  check("GET /api/me → группа ПМИ-21", me.json?.group?.name === "ПМИ-21");
  studentsTotal = me.json?.group?.students ?? 0;
  check("в группе минимум 12 человек", studentsTotal >= 12, String(studentsTotal));
}

section("Расписание");
let todayLessons = [];
{
  const res = await call("/api/today");
  todayLessons = res.json?.today?.lessons ?? [];
  check("GET /api/today → 200", res.status === 200);
  check("на сегодня есть пары", todayLessons.length > 0, `найдено ${todayLessons.length}`);
  check("у пары есть предмет и аудитория", !!todayLessons[0]?.subject?.name);

  const week = await call("/api/schedule");
  const total = (week.json?.week ?? []).reduce((n, d) => n + d.lessons.length, 0);
  check("GET /api/schedule → 7 дней", week.json?.week?.length === 7);
  check("в неделе больше 10 пар", total > 10, `найдено ${total}`);

  const subjects = await call("/api/subjects");
  check("GET /api/subjects → 6 предметов", subjects.json?.length === 6, String(subjects.json?.length));
}

section("Отметка посещаемости");
{
  const lesson = todayLessons[0];
  const before = lesson.counts.going + lesson.counts.late;

  const mark = await call("/api/attendance", {
    method: "POST",
    body: { slotId: lesson.slotId, date: todayIso, status: "going" },
  });
  check("POST /api/attendance → 200", mark.status === 200, JSON.stringify(mark.json));
  check("счётчик «идут» вырос", (mark.json?.counts?.going ?? 0) > 0);

  const list = await call(`/api/attendance/${lesson.slotId}?date=${todayIso}`);
  check("GET /api/attendance/:id → список", list.status === 200 && Array.isArray(list.json?.people));
  check("в списке все участники группы", list.json?.people?.length === studentsTotal, `${list.json?.people?.length} vs ${studentsTotal}`);

  const mine = list.json.people.find((p) => p.name === "Артём Соколов");
  check("моя отметка сохранена", mine?.status === "going", mine?.status);

  const change = await call("/api/attendance", {
    method: "POST",
    body: { slotId: lesson.slotId, date: todayIso, status: "late" },
  });
  check("повторная отметка перезаписывает", change.json?.status === "late");

  await call("/api/attendance", {
    method: "POST",
    body: { slotId: lesson.slotId, date: todayIso, status: "going" },
  });

  const bad = await call("/api/attendance", {
    method: "POST",
    body: { slotId: lesson.slotId, date: todayIso, status: "нечто" },
  });
  check("невалидный статус → 400", bad.status === 400);
}

section("Статистика");
{
  const mine = await call("/api/stats/me");
  check("GET /api/stats/me → 200", mine.status === 200);
  check("есть процент посещаемости", typeof mine.json?.totals?.rate === "number");

  const group = await call("/api/stats/group");
  check("GET /api/stats/group → вся группа", group.json?.students?.length === studentsTotal, `${group.json?.students?.length} vs ${studentsTotal}`);
  check("статистика по предметам есть", (group.json?.bySubject ?? []).length === 6);
}

section("Новости и дедлайны");
{
  const ann = await call("/api/announcements");
  check("GET /api/announcements → 2 записи", ann.json?.length === 2, String(ann.json?.length));

  const created = await call("/api/announcements", {
    method: "POST",
    body: { title: "Тестовое объявление", body: "Проверка из smoke-теста" },
  });
  check("POST /api/announcements → 201", created.status === 201);

  const removed = await call(`/api/announcements/${created.json.id}`, { method: "DELETE" });
  check("DELETE /api/announcements/:id → 200", removed.status === 200);

  const dl = await call("/api/deadlines");
  check("GET /api/deadlines → 3 записи", dl.json?.length === 3, String(dl.json?.length));
}

section("Экспорт");
{
  const csv = await call("/api/export/attendance.csv");
  check("CSV → 200", csv.status === 200);
  check(
    "CSV: правильный тип и заголовок",
    (csv.headers.get("content-type") ?? "").includes("text/csv") && csv.text.includes("Студент")
  );
  check("CSV содержит строки отметок", csv.text.split("\r\n").length > 3);
}

section("Роли и регистрация");
{
  const prevCookie = cookie;

  cookie = "";
  const code = "TEST" + Math.floor(Math.random() * 100000);
  const reg = await call("/api/auth/register", {
    method: "POST",
    auth: false,
    body: { code: "PMI21", name: `Новичок ${code}`, password: "pass1234" },
  });
  check("регистрация нового студента → 201", reg.status === 201, JSON.stringify(reg.json));

  const me = await call("/api/me");
  check("новый пользователь — студент", me.json?.user?.role === "student");

  const forbidden = await call("/api/stats/group");
  check("студенту доступна групповая статистика (read-only)", forbidden.status === 200);

  const denied = await call("/api/announcements", {
    method: "POST",
    body: { title: "Нельзя", body: "студент не может" },
  });
  check("студенту запрещено создавать объявления → 403", denied.status === 403, String(denied.status));

  const noExport = await call("/api/export/attendance.csv");
  check("студенту запрещён экспорт → 403", noExport.status === 403, String(noExport.status));

  const past = await call("/api/attendance", {
    method: "POST",
    body: { slotId: todayLessons[0].slotId, date: "2020-01-01", status: "going" },
  });
  check("студенту нельзя отметиться задним числом → 403", past.status === 403, String(past.status));

  cookie = prevCookie;
}

section("Безопасность");
{
  const wrong = await call("/api/auth/login", {
    method: "POST",
    auth: false,
    body: { code: "PMI21", name: "Артём Соколов", password: "неверный" },
  });
  check("неверный пароль → 401", wrong.status === 401);

  const noGroup = await call("/api/auth/login", {
    method: "POST",
    auth: false,
    body: { code: "NOPE", name: "x", password: "y" },
  });
  check("несуществующая группа → 404", noGroup.status === 404);

  const traversal = await call("/..%2f..%2fserver%2findex.js", { auth: false });
  check("path traversal не отдаёт исходники", traversal.status === 404 || !traversal.text.includes("express"));
}

console.log(`\n${"─".repeat(42)}`);
console.log(`Итого: ${passed} прошло, ${failed} упало`);
process.exit(failed === 0 ? 0 : 1);
