// Google occasionally stalls one connection while another completes normally.
// Only side-effect-free reads / verified successful sign-ins use this helper.
export async function withReadFallback<T>(
  request: (signal: AbortSignal) => Promise<T>,
  delayMs = 4000,
): Promise<T> {
  const controller = new AbortController();
  let started = false;
  let startBackup!: () => void;
  const backup = new Promise<T>((resolve, reject) => {
    startBackup = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      request(controller.signal).then(resolve, reject);
    };
  });
  const timer = setTimeout(startBackup, delayMs);
  const primary = request(controller.signal).catch((error) => {
    startBackup();
    throw error;
  });
  try {
    return await Promise.any([primary, backup]);
  } catch {
    throw new Error("Google Sheets 连接暂时中断，内容已保留，请重试");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
