import test from "node:test";
import assert from "node:assert/strict";
import { backend } from "../server/backend.js";

test("Google canonical redirects preserve signed POST and result redirects use GET", async () => {
  const original = globalThis.fetch;
  process.env.LEDGER_BACKEND_URL =
    "https://script.google.com/macros/s/test/exec";
  process.env.LEDGER_BACKEND_SECRET = "transport-test-secret";
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1)
      return new Response(null, {
        status: 302,
        headers: {
          location: "https://script.google.com/macros/s/test/exec?canonical=1",
        },
      });
    if (calls.length === 2)
      return new Response(null, {
        status: 302,
        headers: {
          location:
            "https://script.googleusercontent.com/macros/echo?result=test",
        },
      });
    return Response.json({ ok: true, data: { saved: true } });
  }) as typeof fetch;
  try {
    assert.deepEqual(
      await backend("write", { eventId: "stable-event", operation: "create" }),
      { saved: true },
    );
    assert.deepEqual(
      calls.map((c) => c.init?.method),
      ["POST", "POST", "GET"],
    );
    assert.equal(calls[0].init?.body, calls[1].init?.body);
    assert.equal(calls[2].init?.body, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("a lost response retries the same event ID without accepting a service landing response", async () => {
  const original = globalThis.fetch;
  const events: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const envelope = JSON.parse(String(init?.body));
    assert.ok(!/[^\x00-\x7f]/.test(envelope.body));
    assert.equal(JSON.parse(envelope.body).description, "中华账簿 🎉");
    events.push(JSON.parse(envelope.body).eventId);
    return events.length === 1
      ? Response.json({ ok: true, service: "landing" })
      : Response.json({ ok: true, data: { saved: true } });
  }) as typeof fetch;
  try {
    assert.deepEqual(
      await backend("write", {
        eventId: "unchanged-event",
        description: "中华账簿 🎉",
      }),
      {
        saved: true,
      },
    );
    assert.deepEqual(events, ["unchanged-event", "unchanged-event"]);
  } finally {
    globalThis.fetch = original;
  }
});
