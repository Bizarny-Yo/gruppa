import webpush from "web-push";
import { db, nowIso, getSetting } from "./db.js";
import { todayIso, weekdayOf, parityFor, minutesOf, nowMinutes } from "./time.js";

/* ─────────────── VAPID-ключи: env или база (генерим один раз) ─────────────── */

let keys = null;

function loadKeys() {
  if (keys) return keys;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return keys;
  }

  const row = db.prepare("SELECT value FROM settings WHERE key = 'vapid'").get();
  if (row) {
    keys = JSON.parse(row.value);
    return keys;
  }

  keys = webpush.generateVAPIDKeys();
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('vapid', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(keys));
  console.log("→ сгенерированы VAPID-ключи (сохранены в базе)");
  return keys;
}

export function publicKey() {
  return loadKeys().publicKey;
}

let configured = false;

function configure() {
  if (configured) return;
  const { publicKey: pub, privateKey: priv } = loadKeys();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:gruppa@example.com", pub, priv);
  configured = true;
}

/* ───────────────────────── подписки ───────────────────────── */

export function saveSubscription(userId, subscription) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error("Некорректная подписка");
  }
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, nowIso());
}

export function removeSubscription(endpoint) {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function userHasSubscription(userId) {
  return !!db.prepare("SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1").get(userId);
}

function subscriptionsOf(userId) {
  return db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?").all(userId);
}

/* ───────────────────────── отправка ───────────────────────── */

async function sendToUser(userId, payload) {
  configure();
  const subs = subscriptionsOf(userId);
  let sent = 0;

  for (const s of subs) {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      sent++;
    } catch (err) {
      // 404/410 — подписка умерла, чистим
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(s.endpoint);
      } else {
        console.warn("[push] ошибка отправки:", err.statusCode ?? err.message);
      }
    }
  }
  return sent;
}

export async function sendToGroup(groupId, payload) {
  const users = db
    .prepare(
      `SELECT DISTINCT s.user_id FROM push_subscriptions s
       JOIN users u ON u.id = s.user_id WHERE u.group_id = ?`
    )
    .all(groupId);

  let sent = 0;
  for (const { user_id } of users) sent += await sendToUser(user_id, payload);
  return sent;
}

export async function sendTest(userId) {
  return sendToUser(userId, {
    title: "Уведомления работают 🎉",
    body: "Это тестовое сообщение. Напомним за 15 минут до пары.",
    url: "/",
    tag: "test",
  });
}

/* ─────────────────── напоминания о парах ─────────────────── */

const REMIND_BEFORE_MIN = 15;
const WINDOW_MIN = 5; // окно проверки, чтобы не спамить

function sendReminders() {
  const now = new Date();
  const iso = todayIso(now);
  const wd = weekdayOf(now);
  const parity = parityFor(now, getSetting("semester_start", null));
  const currentMin = nowMinutes(now);

  const slots = db
    .prepare(
      `SELECT s.id, s.group_id, s.pair, s.start_time, s.end_time, s.room, sub.name AS subject
       FROM slots s JOIN subjects sub ON sub.id = s.subject_id
       WHERE s.weekday = ? AND (s.parity = 'all' OR s.parity = ?)
         AND (s.starts_on IS NULL OR s.starts_on <= ?)
         AND (s.ends_on IS NULL OR s.ends_on >= ?)`
    )
    .all(wd, parity, iso, iso);

  for (const slot of slots) {
    const inMinutes = minutesOf(slot.start_time) - currentMin;
    if (inMinutes < REMIND_BEFORE_MIN - WINDOW_MIN || inMinutes > REMIND_BEFORE_MIN) continue;

    const users = db
      .prepare(
        `SELECT DISTINCT ps.user_id
         FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
         WHERE u.group_id = ?`
      )
      .all(slot.group_id);

    for (const { user_id } of users) {
      const marked = db
        .prepare("SELECT 1 FROM attendance WHERE slot_id = ? AND date = ? AND user_id = ?")
        .get(slot.id, iso, user_id);
      if (marked) continue;

      const logged = db
        .prepare("SELECT 1 FROM push_log WHERE user_id = ? AND slot_id = ? AND date = ? AND kind = 'reminder'")
        .get(user_id, slot.id, iso);
      if (logged) continue;

      db.prepare(
        "INSERT OR IGNORE INTO push_log (user_id, slot_id, date, kind, sent_at) VALUES (?,?,?,?,?)"
      ).run(user_id, slot.id, iso, "reminder", nowIso());

      sendToUser(user_id, {
        title: `Через ${inMinutes} мин — ${slot.subject}`,
        body: `${slot.pair} пара, ${slot.start_time}${slot.room ? `, ауд. ${slot.room}` : ""}. Отметься, чтобы группа знала.`,
        url: `/lesson/${slot.id}`,
        tag: `slot-${slot.id}`,
      }).catch(() => {});
    }
  }
}

export function startReminders(intervalMs = 60_000) {
  if (process.env.DISABLE_REMINDERS === "1") {
    console.log("→ напоминания отключены (DISABLE_REMINDERS=1)");
    return () => {};
  }
  // первый прогон через 10 секунд после старта, дальше раз в минуту
  const timer = setInterval(sendReminders, intervalMs);
  setTimeout(sendReminders, 10_000);
  console.log(`→ напоминания включены (за ${REMIND_BEFORE_MIN} мин до пары)`);
  return () => clearInterval(timer);
}
