export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const r = await fetch("/api?action=" + encodeURIComponent(path), {
      credentials: "same-origin",
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "操作失败，请稍后重试");
    return data as T;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError")
      throw new Error("连接超时，内容已保留。请重试，系统会避免重复记账。");
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
