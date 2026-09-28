import { createHmac, randomUUID } from "node:crypto";
import { withReadFallback } from "./read-fallback.js";
class BackendResultError extends Error {}

function backendErrorMessage(message?: string) {
  if (message === "Unauthorized")
    return "Google Sheets 授权失败，请联系管理员检查后端密钥与 Apps Script 部署";
  if (
    message &&
    [
      "账目已被修改",
      "找不到账目",
      "日期早于",
      "已经作废",
      "编号重复",
      "账本操作失败",
      "账本无效",
    ].some((known) => message.includes(known))
  )
    return message;
  return "Google Sheets 后端处理失败，请联系管理员检查 Apps Script 执行记录";
}

export async function backend<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (
    action === "read" ||
    (action === "throttle" && payload.credentialValid === true)
  ) {
    let requests = 0;
    return withReadFallback(
      (signal) => {
        if (++requests === 2) console.warn("Ledger backup request", { action });
        return requestBackend<T>(action, payload, signal, 1);
      },
      8000,
      (error) => error instanceof BackendResultError,
    );
  }
  // Financial writes and failed passwords must never run speculative duplicates.
  return requestBackend<T>(action, payload);
}
async function requestBackend<T>(
  action: string,
  payload: Record<string, unknown>,
  outerSignal?: AbortSignal,
  attempts = 2,
): Promise<T> {
  const url = process.env.LEDGER_BACKEND_URL,
    secret = process.env.LEDGER_BACKEND_SECRET;
  if (!url || !secret) throw new Error("Google Sheets 尚未连接");
  for (let attempt = 0; attempt < attempts; attempt++) {
    const startedAt = Date.now();
    const body = JSON.stringify({
      action,
      ...payload,
      at: Date.now(),
      nonce: randomUUID(),
    }).replace(
      /[^\x00-\x7f]/g,
      (character) =>
        "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
    );
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    let result: { ok: boolean; data?: T; error?: string };
    let stage = "start",
      status = 0,
      hops = 0;
    try {
      let target = url;
      let method = "POST";
      // Two sequential write attempts must fit inside the 60-second function limit.
      const deadline = AbortSignal.timeout(28000);
      const signal = outerSignal
        ? AbortSignal.any([deadline, outerSignal])
        : deadline;
      let response: Response | undefined;
      for (let hop = 0; hop < 5; hop++) {
        hops = hop;
        stage = method + " " + new URL(target).hostname;
        response = await fetch(target, {
          method,
          ...(method === "POST"
            ? {
                headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({ body, signature }),
              }
            : {}),
          redirect: "manual",
          // The ContentService result is at a one-time redirect URL. Give its
          // download time to complete before repeating the signed execution.
          signal:
            method === "GET"
              ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
              : signal,
        });
        status = response.status;
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        // Manual redirects must release their bodies, otherwise Node keeps the
        // Google connections occupied until garbage collection.
        await response.body?.cancel();
        if (!location) throw new Error("Missing Google redirect");
        const next = new URL(location, target);
        if (
          next.protocol !== "https:" ||
          !["script.google.com", "script.googleusercontent.com"].includes(
            next.hostname,
          )
        ) {
          throw new Error("Unexpected Google redirect");
        }
        // Apps Script may first redirect to its canonical execution URL. Keep
        // the signed POST there; only the ContentService result URL uses GET.
        method =
          next.hostname === "script.googleusercontent.com" ? "GET" : "POST";
        target = next.href;
      }
      if (!response?.ok) {
        if (response && !response.bodyUsed) await response.body?.cancel();
        throw new Error("Google transport failed");
      }
      stage = "decode-json";
      result = await response.json();
      stage = "validate-result";
      if (result.ok && result.data === undefined)
        throw new Error("Missing ledger result");
    } catch (error) {
      if (outerSignal?.aborted) throw error;
      console.warn("Ledger transport retry", {
        action,
        attempt: attempt + 1,
        reason: error instanceof Error ? error.name : "Unknown",
        stage,
        status,
        hops,
        elapsedMs: Date.now() - startedAt,
      });
      if (attempt + 1 < attempts) continue;
      throw new Error("Google Sheets 连接暂时中断，内容已保留，请重试");
    }
    if (!result.ok) {
      const message = backendErrorMessage(result.error);
      console.warn("Ledger backend rejected", {
        action,
        kind:
          result.error === "Unauthorized"
            ? "authorization"
            : message.includes("后端处理失败")
              ? "script"
              : "operation",
      });
      throw new BackendResultError(message);
    }
    return result.data as T;
  }
  throw new Error("Google Sheets 连接失败，请重试");
}
