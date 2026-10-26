import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { db, nowIso } from "./db.js";

const KEYLEN = 64;
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(String(password), salt, KEYLEN);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)").run(
    token,
    userId,
    nowIso(),
    expires
  );
  return { token, expires };
}

export function destroySession(token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookie(token, expires) {
  const maxAge = Math.floor((new Date(expires) - Date.now()) / 1000);
  return `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie() {
  return "sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
}

export function userFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.sid;
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT s.token, s.expires_at, u.id, u.name, u.role, u.color, u.group_id, u.subgroup, g.name AS group_name, g.code AS group_code
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN groups g ON g.id = u.group_id
       WHERE s.token = ?`
    )
    .get(token);

  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    destroySession(token);
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    color: row.color,
    subgroup: row.subgroup ?? null,
    groupId: row.group_id,
    groupName: row.group_name,
    groupCode: row.group_code,
    token: row.token,
  };
}

export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: "Нужно войти" });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: "Нужно войти" });
  if (user.role !== "starosta") return res.status(403).json({ error: "Только староста" });
  req.user = user;
  next();
}

/** Простой ключ для отпечатка в аватарках-заглушках */
export function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function shortHash(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}
