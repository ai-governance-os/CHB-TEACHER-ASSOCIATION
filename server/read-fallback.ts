// Google occasionally stalls one connection while another completes normally.
// Only side-effect-free reads / verified successful sign-ins use this helper.
export async function withReadFallback<T>(
  request: (signal: AbortSignal) => Promise<T>,
  delayMs = 8000,
  isTerminal: (error: unknown) => boolean = () => false,
): Promise<T> {
  const controller = new AbortController();
  let started = false;
  let settled = false;
  let failures = 0;
  let resolveResult!: (value: T) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const finish = (value: T) => {
    if (settled) return;
    settled = true;
    resolveResult(value);
  };
  const fail = (error: unknown, primary: boolean) => {
    if (settled) return;
    if (isTerminal(error)) {
      settled = true;
      rejectResult(error);
      return;
    }
    failures++;
    if (primary) startBackup();
    if (failures === 2) {
      settled = true;
      rejectResult(new Error("Google Sheets 连接暂时中断，内容已保留，请重试"));
    }
  };
  const launch = (primary: boolean) => {
    try {
      request(controller.signal).then(finish, (error) => fail(error, primary));
    } catch (error) {
      fail(error, primary);
    }
  };
  const startBackup = () => {
    if (started || settled) return;
    started = true;
    launch(false);
  };
  const timer = setTimeout(startBackup, delayMs);
  launch(true);
  try {
    return await result;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
