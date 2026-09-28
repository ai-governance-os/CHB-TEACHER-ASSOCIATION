import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { backend } from "./backend.js";
import {
  checkPassword,
  configured,
  createSession,
  readSession,
  safeUser,
  users,
} from "./security.js";
import { validDate } from "../src/ledger.js";
import { books, isBookId, type BookId } from "../src/books.js";
import type { Ledger, Transaction } from "../src/types.js";
type Request = IncomingMessage & { body?: unknown };
// Already-open clients from the single-ledger release do not understand historical checkpoints.
function responseLedger(data: Ledger, explicitBook: boolean): Ledger {
  const point = data.balanceCheckpoints?.find((p) => p.date === "2025-01-01");
  if (explicitBook || data.id !== "teachers" || !point) return data;
  return {
    ...data,
    openingDate: point.date,
    openingCents: point.amountCents,
    transactions: data.transactions.filter((t) => t.date >= point.date),
    events: data.events.filter((e) => e.transaction.date >= point.date),
    balanceCheckpoints: [],
  };
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function bodyOf(req: Request) {
  if (req.body !== undefined) {
    const raw =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > 16384) throw new HttpError(413, "内容过长");
    return JSON.parse(raw);
  }
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 16384) throw new HttpError(413, "内容过长");
  }
  try {
    return JSON.parse(data || "{}");
  } catch {
    throw new HttpError(400, "请求格式无效");
  }
}
export function validateTransaction(
  t: Transaction,
  bookId: BookId = "teachers",
) {
  const { incomeCategories, expenseCategories } = books[bookId];
  if (!t || typeof t !== "object") throw new HttpError(400, "账目内容无效");
  if (
    !["income", "expense", "transfer"].includes(t.type) ||
    !["active", "void"].includes(t.status) ||
    !validDate(t.date)
  )
    throw new HttpError(400, "日期或账目类型无效");
  if (
    !Number.isSafeInteger(t.amountCents) ||
    t.amountCents <= 0 ||
    t.amountCents > 9999999999
  )
    throw new HttpError(400, "金额无效");
  if (typeof t.id !== "string" || !/^[a-zA-Z0-9-]{6,80}$/.test(t.id))
    throw new HttpError(400, "账目编号无效");
  for (const [key, max] of [
    ["description", 160],
    ["party", 80],
    ["note", 1500],
  ] as const) {
    if (typeof t[key] !== "string" || t[key].length > max)
      throw new HttpError(400, "账目文字过长或无效");
  }
  if (!t.description.trim()) throw new HttpError(400, "项目不能为空");
  if (
    !(
      t.type === "transfer"
        ? ["账户内部转账"]
        : t.type === "income"
          ? [...incomeCategories]
          : ([...expenseCategories] as string[])
    ).includes(t.category)
  )
    throw new HttpError(400, "分类无效");
}
export default async function handler(req: Request, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Vary", "Cookie");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const reply = (status: number, data: unknown) => {
    res.statusCode = status;
    res.end(JSON.stringify(data));
  };
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const path =
      url.searchParams.get("action") || url.pathname.replace(/^\/api\/?/, "");
    const cookie =
      String(req.headers.cookie || "")
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("chb_session="))
        ?.slice(12) || "";
    const user = readSession(cookie);
    if (req.method === "GET" && path === "session")
      return reply(200, { user, configured: configured() });
    if (req.method !== "GET" && req.method !== "POST")
      throw new HttpError(405, "不支持的操作");
    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (origin) {
        let host = "";
        try {
          host = new URL(origin).host;
        } catch {
          throw new HttpError(403, "请求来源无效");
        }
        if (host !== req.headers.host) throw new HttpError(403, "请求来源无效");
      }
      if (
        !String(req.headers["content-type"] || "").startsWith(
          "application/json",
        )
      )
        throw new HttpError(415, "请求格式无效");
    }
    if (path === "logout" && req.method === "POST") {
      res.setHeader(
        "Set-Cookie",
        "chb_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" +
          (process.env.VERCEL ? "; Secure" : ""),
      );
      return reply(200, { ok: true });
    }
    if (!configured())
      throw new HttpError(503, "管理员尚未连接 Google Sheets 正式账本");
    if (path === "login" && req.method === "POST") {
      const b = await bodyOf(req);
      if (
        typeof b.username !== "string" ||
        typeof b.password !== "string" ||
        b.username.length > 80 ||
        b.password.length > 256
      )
        throw new HttpError(400, "账户或密码无效");
      const client = String(
        req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown",
      );
      const key = createHash("sha256")
        .update(client + "|" + b.username.trim().toLowerCase())
        .digest("hex");
      const ledgerId = b.ledgerId ?? "teachers";
      if (!isBookId(ledgerId)) throw new HttpError(400, "账本无效");
      // Reserve the login attempt and obtain its first snapshot in ONE Google round trip.
      // No session or financial data is returned until both rate limit and password pass.
      const throttle = await backend<{ allowed: boolean; ledger?: Ledger }>(
        "throttle",
        {
          key,
          ledgerId,
          includeLedger: b.includeLedger === true,
        },
      );
      if (!throttle.allowed)
        throw new HttpError(429, "尝试次数过多，请 15 分钟后再试");
      const u = users().find(
        (u) => u.username.toLowerCase() === b.username.trim().toLowerCase(),
      );
      if (!u || !checkPassword(b.password, u.passwordHash))
        throw new HttpError(401, "账户或密码不正确");
      res.setHeader(
        "Set-Cookie",
        "chb_session=" +
          createSession(u.username) +
          "; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200" +
          (process.env.VERCEL ? "; Secure" : ""),
      );
      return reply(200, {
        user: safeUser(u),
        configured: true,
        ledger: throttle.ledger,
      });
    }
    if (!user) throw new HttpError(401, "请先登录，或登录已过期");
    if (path === "ledger" && req.method === "GET") {
      const ledgerId = url.searchParams.get("ledgerId") || "teachers";
      if (!isBookId(ledgerId)) throw new HttpError(400, "账本无效");
      const data = await backend<Ledger>("read", { ledgerId });
      return reply(200, responseLedger(data, url.searchParams.has("ledgerId")));
    }
    if (path === "transactions" && req.method === "POST") {
      if (user.role === "viewer")
        throw new HttpError(403, "此账户仅可查询与打印");
      const b = await bodyOf(req);
      const ledgerId = b.ledgerId ?? "teachers";
      if (!isBookId(ledgerId)) throw new HttpError(400, "账本无效");
      if (
        typeof b.eventId !== "string" ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(b.eventId) ||
        !["create", "edit", "void"].includes(b.action) ||
        !Number.isSafeInteger(b.expectedVersion) ||
        b.expectedVersion < 0
      )
        throw new HttpError(400, "操作参数无效");
      validateTransaction(b.transaction, ledgerId);
      const data = await backend<Ledger>("write", {
        ledgerId,
        eventId: b.eventId,
        operation: b.action,
        transaction: b.transaction,
        expectedVersion: b.expectedVersion,
        actor: user.displayName,
        username: user.username,
      });
      return reply(200, responseLedger(data, b.ledgerId !== undefined));
    }
    throw new HttpError(404, "找不到此操作");
  } catch (error) {
    if (error instanceof HttpError)
      return reply(error.status, { error: error.message });
    const message = error instanceof Error ? error.message : "服务暂时无法连接";
    const known = [
      "账目已被修改",
      "找不到账目",
      "日期早于",
      "已经作废",
      "编号重复",
      "Google Sheets",
      "账本操作失败",
    ];
    reply(known.some((s) => message.includes(s)) ? 409 : 502, {
      error: known.some((s) => message.includes(s))
        ? message
        : "暂时无法完成，请重试。未确认成功的内容会保留。",
    });
  }
}
