import { createHmac, randomUUID } from "node:crypto";
import { withReadFallback } from "./read-fallback.js";
export async function backend<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (
    action === "read" ||
    (action === "throttle" && payload.credentialValid === true)
  ) {
    return withReadFallback((signal) =>
      requestBackend<T>(action, payload, signal, 1),
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
      const deadline = AbortSignal.timeout(30000);
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
          // A ContentService result is already computed. Retry a stalled download
          // promptly; the slower signed execution still gets its full budget.
          signal:
            method === "GET"
              ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
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
      });
      if (attempt + 1 < attempts) continue;
      throw new Error("Google Sheets 连接暂时中断，内容已保留，请重试");
    }
    if (!result.ok) throw new Error(result.error || "账本操作失败");
    return result.data as T;
  }
  throw new Error("Google Sheets 连接失败，请重试");
}
