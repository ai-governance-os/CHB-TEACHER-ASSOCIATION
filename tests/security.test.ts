import test from "node:test";
import assert from "node:assert/strict";
import {
  checkPassword,
  createSession,
  hashPassword,
  readSession,
} from "../server/security.js";
import { validateTransaction } from "../server/handler.js";
import type { Transaction } from "../src/types.js";
test("passwords are salted and checked without storing plaintext", () => {
  const a = hashPassword("example-secure-password"),
    b = hashPassword("example-secure-password");
  assert.notEqual(a, b);
  assert.equal(checkPassword("example-secure-password", a), true);
  assert.equal(checkPassword("wrong", a), false);
});
test("sessions reject tampering, expiration and removed users", () => {
  process.env.SESSION_SECRET = "test-only-secret";
  process.env.LEDGER_USERS_JSON = JSON.stringify([
    {
      username: "fiscal",
      displayName: "财政",
      role: "treasurer",
      passwordHash: hashPassword("test"),
    },
  ]);
  const token = createSession("fiscal", 1000);
  const anotherDevice = createSession("fiscal", 1000);
  assert.notEqual(token, anotherDevice);
  assert.equal(readSession(token, 2000)?.role, "treasurer");
  assert.equal(readSession(anotherDevice, 2000)?.role, "treasurer");
  assert.equal(readSession(token + "X", 2000), null);
  assert.equal(readSession(token, 1000 + 13 * 60 * 60 * 1000), null);
  process.env.LEDGER_USERS_JSON = "[]";
  assert.equal(readSession(token, 2000), null);
});
test("server rejects invalid monetary inputs and mismatched categories", () => {
  const t = {
    id: "CHB-test123",
    date: "2026-09-27",
    type: "income",
    category: "其他收入",
    description: "测试",
    party: "",
    note: "",
    amountCents: 100,
    status: "active",
  } as Transaction;
  assert.doesNotThrow(() => validateTransaction(t));
  assert.throws(() => validateTransaction({ ...t, amountCents: 1.2 }));
  assert.throws(() => validateTransaction({ ...t, category: "教职员福利" }));
  assert.throws(() => validateTransaction({ ...t, date: "2026-06-31" }));
});
