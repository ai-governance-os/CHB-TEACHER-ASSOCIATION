import test from "node:test";
import assert from "node:assert/strict";
import { withReadFallback } from "../server/read-fallback.js";

test("a stalled read uses one backup and aborts the losing connection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let cancelled = false;
  const result = withReadFallback((signal) => {
    calls++;
    if (calls === 2) return Promise.resolve("snapshot");
    return new Promise<string>((_resolve, reject) =>
      signal.addEventListener(
        "abort",
        () => {
          cancelled = true;
          reject(signal.reason);
        },
        { once: true },
      ),
    );
  });
  assert.equal(calls, 1);
  t.mock.timers.tick(3999);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.equal(await result, "snapshot");
  assert.equal(calls, 2);
  assert.equal(cancelled, true);
});
test("fast reads never start a backup; two failed reads surface a retryable error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  assert.equal(
    await withReadFallback(async () => {
      calls++;
      return 42;
    }),
    42,
  );
  t.mock.timers.tick(10000);
  assert.equal(calls, 1);
  await assert.rejects(
    withReadFallback(async () => {
      calls++;
      throw new Error("network");
    }),
    /Google Sheets/,
  );
  assert.equal(calls, 3);
});
