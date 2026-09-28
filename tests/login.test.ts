import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import handler from "../server/handler.js";
import { hashPassword } from "../server/security.js";
import { LedgerCache } from "../src/ledger-cache.js";
import type { Ledger } from "../src/types.js";

const ledger: Ledger = {
  id: "teachers",
  transactions: [],
  events: [],
  openingDate: "2024-01-01",
  openingCents: 0,
  sourceNote: "test",
};
test("one login round trip returns a snapshot only after BOTH password and global rate limit pass", async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  Object.assign(process.env, {
    LEDGER_BACKEND_URL: "https://script.google.com/macros/s/test/exec",
    LEDGER_BACKEND_SECRET: "test",
    SESSION_SECRET: "test-session-secret",
    LEDGER_USERS_JSON: JSON.stringify([
      {
        username: "finance",
        displayName: "Test",
        role: "admin",
        passwordHash: hashPassword("valid-password"),
      },
    ]),
  });
  let allowed = true;
  const calls: { key: string; includeLedger: boolean; ledgerId: string }[] = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(JSON.parse(String(init?.body)).body));
    return new Response(
      JSON.stringify({ ok: true, data: { allowed, ledger } }),
      { status: 200 },
    );
  };
  const login = async (
    password: string,
    username = "finance",
    ledgerId = "teachers",
  ) => {
    const headers: Record<string, unknown> = {};
    let response = "";
    const req = {
      method: "POST",
      url: "/api?action=login",
      headers: {
        "content-type": "application/json",
        host: "localhost",
        origin: "http://localhost",
        "x-real-ip": "127.0.0.1",
      },
      body: { username, password, includeLedger: true, ledgerId },
    } as unknown as IncomingMessage;
    const res = {
      statusCode: 0,
      setHeader: (key: string, value: unknown) => {
        headers[key] = value;
      },
      end: (text: string) => {
        response = text;
      },
    };
    await handler(req, res as unknown as ServerResponse);
    return { status: res.statusCode, data: JSON.parse(response), headers };
  };
  try {
    const good = await login("valid-password");
    assert.equal(good.status, 200);
    assert.equal(good.data.ledger.id, "teachers");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].includeLedger, true);
    assert.match(
      String(good.headers["Set-Cookie"]),
      /HttpOnly; SameSite=Strict/,
    );
    const bad = await login("wrong", " FINANCE ");
    assert.equal(bad.status, 401);
    assert.equal(bad.data.ledger, undefined);
    assert.equal(bad.headers["Set-Cookie"], undefined);
    assert.equal(
      calls[0].key,
      calls[1].key,
      "spaces/case cannot bypass the limit",
    );
    allowed = false;
    const blocked = await login("valid-password");
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.ledger, undefined);
    assert.equal(blocked.headers["Set-Cookie"], undefined);
    const count = calls.length;
    assert.equal(
      (await login("valid-password", "finance", "__proto__")).status,
      400,
    );
    assert.equal(calls.length, count);
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env))
      if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});

test("session cache isolates books, expires freshness, preserves writes and clears all data on logout", () => {
  const cache = new LedgerCache();
  cache.set("teachers", ledger, 1000);
  cache.set("pta", { ...ledger, id: "pta", openingCents: 999 }, 1000);
  assert.equal(cache.get("teachers")?.ledger.openingCents, 0);
  assert.equal(cache.get("pta")?.ledger.openingCents, 999);
  assert.equal(cache.fresh("teachers", 15999), true);
  assert.equal(cache.fresh("teachers", 16000), false);
  assert.equal(cache.fresh("store", 1001), false);
  assert.throws(() => cache.set("teachers", { ...ledger, id: "pta" }));
  cache.set("teachers", { ...ledger, openingCents: 321 }, 17000);
  assert.equal(cache.get("teachers")?.ledger.openingCents, 321);
  cache.clear();
  assert.equal(cache.get("teachers"), undefined);
  assert.equal(cache.get("pta"), undefined);
});
