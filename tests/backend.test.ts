import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
test("durable event append is idempotent, rejects stale edits and keeps void audit history", () => {
  const rows: unknown[][] = [["headers"]],
    settings = [
      ["key", "value"],
      ["openingDate", "2025-01-01"],
      ["openingRM", 100],
      ["sourceNote", "test"],
    ];
  let locked = false;
  let eventReads = 0;
  const sheet = {
    getDataRange: () => ({
      getValues: () => {
        eventReads++;
        return rows;
      },
    }),
    getLastRow: () => rows.length,
    getRange: () => ({
      setValues: (values: unknown[][]) => {
        assert.ok(locked);
        rows.push(...values);
      },
    }),
  };
  const book = {
    getSheetByName: (name: string) =>
      name === "账目事件"
        ? sheet
        : { getDataRange: () => ({ getValues: () => settings }) },
    getUrl: () => "https://example.invalid/test-sheet",
  };
  const ptaRows: unknown[][] = [["headers"]];
  const originalGet = book.getSheetByName;
  book.getSheetByName = (name: string) =>
    name === "家协账目事件"
      ? {
          getDataRange: () => ({ getValues: () => ptaRows }),
          getLastRow: () => ptaRows.length,
          getRange: () => ({
            setValues: (values: unknown[][]) => {
              assert.ok(locked);
              ptaRows.push(...values);
            },
          }),
        }
      : originalGet(name);
  const loginAttempts = new Map<string, string>();
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Number,
    Object,
    String,
    Math,
    Error,
    ledgerConfig_: () => ({ secret: "test", spreadsheetId: "test" }),
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text: string) => ({
        text,
        setMimeType() {
          return this;
        },
      }),
    },
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      computeHmacSha256Signature: (body: string, key: string) =>
        Array.from(createHmac("sha256", key).update(body).digest()),
    },
    SpreadsheetApp: { openById: () => book, flush: () => {} },
    CacheService: {
      getScriptCache: () => ({
        get: (key: string) => loginAttempts.get(key),
        put: (key: string, value: string) => {
          assert.ok(locked);
          loginAttempts.set(key, value);
        },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          locked = true;
          return true;
        },
        releaseLock: () => {
          locked = false;
        },
      }),
    },
  });
  vm.runInContext(fs.readFileSync("gas/Code.js", "utf8"), context);
  const call = (data: object, badSignature = false) => {
    const body = JSON.stringify({ at: Date.now(), ...data }),
      signature = badSignature
        ? "invalid"
        : createHmac("sha256", "test").update(body).digest("hex");
    const result = context.doPost({
      postData: { contents: JSON.stringify({ body, signature }) },
    });
    return JSON.parse(result.text);
  };
  const t = {
    id: "CHB-test123",
    date: "2026-01-01",
    type: "income",
    category: "其他收入",
    description: "测试账目",
    amountCents: 100,
    party: "",
    note: "",
    status: "active",
  };
  const create = {
    action: "write",
    operation: "create",
    eventId: "event000000000001",
    expectedVersion: 0,
    transaction: t,
    actor: "财政",
  };
  assert.equal(call(create, true).ok, false);
  assert.equal(rows.length, 1);
  assert.equal(call(create).data.transactions[0].amountCents, 100);
  assert.equal(rows.length, 2);
  assert.equal(eventReads, 1, "write must read the event sheet only once");
  assert.equal(locked, false);
  assert.equal(call(create).ok, true);
  assert.equal(rows.length, 2);
  const edit = {
    ...create,
    operation: "edit",
    eventId: "event000000000002",
    expectedVersion: 1,
    transaction: { ...t, amountCents: 250 },
  };
  assert.equal(call(edit).data.transactions[0].version, 2);
  assert.equal(rows.length, 3);
  assert.equal(call({ ...edit, eventId: "event000000000003" }).ok, false);
  assert.equal(rows.length, 3);
  const removed = call({
    ...edit,
    operation: "void",
    eventId: "event000000000004",
    expectedVersion: 2,
    transaction: { ...t, amountCents: 999, note: "作废原因：测试" },
  });
  assert.equal(removed.data.transactions[0].status, "void");
  assert.equal(removed.data.transactions[0].amountCents, 250);
  assert.equal(removed.data.events.length, 3);
  assert.equal(
    call({ ...edit, eventId: "event000000000005", expectedVersion: 3 }).ok,
    false,
  );
  assert.equal(
    call({ action: "read", ledgerId: "pta" }).data.transactions.length,
    0,
  );
  assert.equal(
    call({ ...edit, ledgerId: "pta", eventId: "event000000000099" }).ok,
    false,
  );
  assert.equal(call({ ...create, ledgerId: "pta" }).data.id, "pta");
  assert.equal(
    ptaRows.length,
    2,
    "same event ID belongs only to its selected ledger",
  );
  assert.equal(rows.length, 4, "writing PTA does not touch teacher events");
  assert.equal(
    call({ action: "read", ledgerId: "teachers" }).data.transactions[0].status,
    "void",
  );
  for (const ledgerId of ["../teachers", "toString", "__proto__", "bad"]) {
    assert.equal(call({ ...create, ledgerId }).ok, false);
  }
  let loginReads = 0;
  context.SpreadsheetApp.openById = () => {
    assert.equal(
      locked,
      false,
      "login releases the global lock before reading",
    );
    loginReads++;
    return book;
  };
  for (let i = 0; i < 12; i++) {
    const signed = call({
      action: "throttle",
      key: "same-account",
      ledgerId: "pta",
      includeLedger: true,
    });
    assert.equal(signed.data.allowed, true);
    assert.equal(signed.data.ledger.id, "pta");
  }
  const limited = call({
    action: "throttle",
    key: "same-account",
    ledgerId: "pta",
    includeLedger: true,
  });
  assert.equal(limited.data.allowed, false);
  assert.equal(limited.data.ledger, undefined);
  assert.equal(loginReads, 12, "a blocked attempt never reads financial data");
  assert.equal(locked, false);
  const verified = {
    action: "throttle",
    key: "checked-account",
    ledgerId: "pta",
    includeLedger: true,
    credentialValid: true,
  };
  for (let i = 0; i < 18; i++)
    assert.equal(
      call(verified).data.allowed,
      true,
      "successful sign-ins do not consume password-error attempts",
    );
  assert.equal(loginAttempts.get("login-failures:checked-account"), "0");
  const beforeWrong = loginReads;
  for (let i = 0; i < 6; i++) {
    const wrong = call({ ...verified, credentialValid: false });
    assert.equal(wrong.data.allowed, true);
    assert.equal(wrong.data.ledger, undefined);
  }
  assert.equal(loginReads, beforeWrong, "wrong passwords never read a sheet");
  assert.equal(call(verified).data.allowed, true);
  assert.equal(loginAttempts.get("login-failures:checked-account"), "0");
  for (let i = 0; i < 12; i++) call({ ...verified, credentialValid: false });
  assert.equal(
    call(verified).data.allowed,
    false,
    "a correct password still cannot bypass an active lockout",
  );
  assert.equal(loginAttempts.get("login-failures:checked-account"), "12");
});
