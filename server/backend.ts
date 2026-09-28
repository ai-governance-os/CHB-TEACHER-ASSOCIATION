import { createHmac, randomUUID } from "node:crypto";
export async function backend<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const url = process.env.LEDGER_BACKEND_URL,
    secret = process.env.LEDGER_BACKEND_SECRET;
  if (!url || !secret) throw new Error("Google Sheets 尚未连接");
  const body = JSON.stringify({
    action,
    ...payload,
    at: Date.now(),
    nonce: randomUUID(),
  });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, signature }),
    redirect: "follow",
    signal: AbortSignal.timeout(35000),
  });
  if (!r.ok) throw new Error("Google Sheets 连接失败，请稍后重试");
  let result: { ok: boolean; data: T; error?: string };
  try {
    result = await r.json();
  } catch {
    throw new Error("Google Sheets 服务尚未授权或未正确部署");
  }
  if (!result.ok) throw new Error(result.error || "账本操作失败");
  return result.data;
}
