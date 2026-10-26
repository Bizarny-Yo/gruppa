/**
 * Визуальная проверка: открывает приложение в Chromium, обходит все экраны
 * и сохраняет скриншоты в shots/. Заодно ловит ошибки консоли и исключения.
 *
 * Запуск: node scripts/screenshots.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:47824";
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const errors = [];

const browser = await chromium.launch();
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
  isMobile: true,
  hasTouch: true,
  permissions: ["notifications"],
});

const page = await mobile.newPage();
page.on("console", (m) => {
  const text = m.text();
  // 401 от /api/me до входа — ожидаемое поведение, не ошибка
  if (m.type() === "error" && !text.includes("401")) errors.push(`console: ${text}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const shot = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("  📸", name);
};

const tab = (name) => page.locator(".tab", { hasText: name });
const demo = (p) => p.locator("button", { hasText: "Открыть" }).first();

console.log("→ экран входа");
await page.goto(BASE, { waitUntil: "networkidle" });

// У бесплатных туннелей (serveo) бывает страница-предупреждение
const cont = page.locator("text=Continue to Site").first();
if (await cont.count()) {
  console.log("  ↳ прохожу предупреждение туннеля");
  await cont.click();
  await page.waitForLoadState("networkidle");
}

await shot("01-login");

console.log("→ вход в демо");
await demo(page).click();
await page.waitForSelector(".lesson, .hero", { timeout: 20000 });
await shot("02-today");
await page.evaluate(() => window.scrollTo(0, 340));
await shot("03-today-schedule");

console.log("→ неделя");
await tab("Неделя").click();
await page.waitForSelector(".day-chip");
await shot("04-week");
await page.locator(".lesson").first().click();
await page.waitForSelector(".person, .empty");
await shot("05-lesson");

console.log("→ статистика");
await tab("Статистика").click();
await page.waitForSelector(".ring");
await page.waitForTimeout(800);
await shot("06-stats");
await page.evaluate(() => window.scrollTo(0, 560));
await shot("07-stats-group");

console.log("→ новости");
await tab("Новости").click();
await page.waitForSelector(".announce");
await shot("08-news");

console.log("→ группа");
await tab("Группа").click();
await page.waitForSelector(".code-pill");
await shot("09-group");
await page.locator(".switch").scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -120));
await shot("10-notifications");

console.log("→ отметка через UI");
await tab("Сегодня").click();
await page.waitForSelector(".lesson, .hero");
const goingBtn = page.locator(".option", { hasText: "Иду" }).first();
if (await goingBtn.count()) {
  await goingBtn.click();
  await page.waitForTimeout(800);
  await shot("12-marked");
}

console.log("→ десктоп");
const desktop = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
});
const dpage = await desktop.newPage();
dpage.on("pageerror", (e) => errors.push(`desktop pageerror: ${e.message}`));
await dpage.goto(BASE, { waitUntil: "networkidle" });
const dcont = dpage.locator("text=Continue to Site").first();
if (await dcont.count()) {
  await dcont.click();
  await dpage.waitForLoadState("networkidle");
}
await demo(dpage).click();
await dpage.waitForSelector(".lesson, .hero", { timeout: 20000 });
await dpage.waitForTimeout(700);
await dpage.screenshot({ path: `${OUT}/11-desktop.png` });
console.log("  📸 11-desktop");

await browser.close();

if (errors.length) {
  console.log("\n⚠️ Ошибки в браузере:");
  for (const e of errors) console.log("  -", e);
  process.exit(1);
} else {
  console.log("\n✅ Ошибок в консоли нет");
}
