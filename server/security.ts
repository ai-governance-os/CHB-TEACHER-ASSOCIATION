import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { User } from "../src/types.js";
export type ConfigUser = User & { passwordHash: string };
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function checkPassword(password: string, hash: string) {
  const [salt, stored] = hash.split(":");
  if (!salt || !stored || !/^[a-f0-9]{128}$/.test(stored)) return false;
  const value = scryptSync(password, salt, 64),
    expected = Buffer.from(stored, "hex");
  return timingSafeEqual(value, expected);
}
export function users(): ConfigUser[] {
  try {
    const list = JSON.parse(process.env.LEDGER_USERS_JSON || "[]");
    return Array.isArray(list)
      ? list.filter(
          (u) =>
            typeof u.username === "string" &&
            typeof u.passwordHash === "string" &&
            ["admin", "treasurer", "viewer"].includes(u.role),
        )
      : [];
  } catch {
    return [];
  }
}
export function configured() {
  return Boolean(
    process.env.LEDGER_BACKEND_URL &&
      process.env.LEDGER_BACKEND_SECRET &&
      process.env.SESSION_SECRET &&
      users().length,
  );
}
export function createSession(username: string, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      username,
      expires: now + 12 * 60 * 60 * 1000,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", process.env.SESSION_SECRET!)
      .update(payload)
      .digest("base64url")
  );
}
export function readSession(token: string, now = Date.now()): User | null {
  try {
    if (!process.env.SESSION_SECRET) return null;
    const [body, signature, ...extra] = token.split(".");
    if (!body || !signature || extra.length) return null;
    const expected = createHmac("sha256", process.env.SESSION_SECRET)
      .update(body)
      .digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (
      !Number.isFinite(payload.expires) ||
      payload.expires <= now ||
      payload.expires > now + 13 * 60 * 60 * 1000
    )
      return null;
    const u = users().find((u) => u.username === payload.username);
    if (!u) return null;
    return { username: u.username, displayName: u.displayName, role: u.role };
  } catch {
    return null;
  }
}
export function safeUser(u: ConfigUser): User {
  return { username: u.username, displayName: u.displayName, role: u.role };
}
