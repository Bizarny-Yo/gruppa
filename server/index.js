import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { api, sseHandler } from "./api.js";
import { isEmpty, seedDemo } from "./db.js";
import { hashPassword } from "./auth.js";
import { startReminders } from "./push.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const PORT = Number(process.env.PORT ?? 47824);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // за Caddy/serveo: нужен реальный IP для лимитов и Secure-cookie
app.use(express.json({ limit: "256kb" }));

// Server-Sent Events для live-обновлений (до express.json не нужен, но и не мешает)
app.get("/api/events", sseHandler);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), version: "1.0.0" });
});

app.use("/api", api);

app.use(
  express.static(PUBLIC, {
    index: false,
    maxAge: "1h",
    setHeaders(res, path) {
      if (path.endsWith("index.html")) res.setHeader("cache-control", "no-cache");
    },
  })
);

// SPA-фолбэк
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) return next();
  const index = join(PUBLIC, "index.html");
  if (!existsSync(index)) {
    return res
      .status(503)
      .type("text/plain")
      .send("Фронтенд не собран. Запустите: pnpm build");
  }
  res.setHeader("cache-control", "no-cache");
  res.sendFile(index);
});

app.use((err, req, res, next) => {
  console.error("[api]", err);
  if (res.headersSent) return next(err);
  res.status(err.status ?? 500).json({ error: err.message ?? "Внутренняя ошибка" });
});

if (isEmpty() && process.env.SEED_DEMO !== "0") {
  seedDemo(hashPassword("demo1234"));
  console.log("→ засеяны демо-данные (группа PMI21, пароль demo1234)");
}

app.listen(PORT, HOST, () => {
  console.log(`gruppa listening on http://127.0.0.1:${PORT} (host ${HOST})`);
  startReminders();
});
