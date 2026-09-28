import test from "node:test";
import assert from "node:assert/strict";
import {
  filterTransactions,
  parseAmount,
  periodFor,
  summary,
  validDate,
} from "../src/ledger.js";
import type { Ledger, Transaction } from "../src/types.js";
const transaction = (
  id: string,
  date: string,
  type: "income" | "expense",
  amountCents: number,
  status: "active" | "void" = "active",
): Transaction => ({
  id,
  date,
  type,
  amountCents,
  status,
  category: "其他收入",
  description: "Yakult 回馈",
  party: "财政",
  note: "收据001",
  version: 1,
  createdAt: date,
  updatedAt: date,
  operator: "test",
  source: "test",
});
const ledger: Ledger = {
  openingDate: "2025-01-01",
  openingCents: 10000,
  sourceNote: "fixture",
  events: [],
  transactions: [
    transaction("a", "2025-12-31", "income", 2000),
    transaction("b", "2026-01-01", "expense", 3000),
    transaction("c", "2026-06-30", "income", 5000),
    transaction("d", "2026-07-01", "expense", 7000),
    transaction("e", "2026-08-01", "income", 99999, "void"),
  ],
};
test("half-year boundaries carry balance, exclude voids and do not double-count opening", () => {
  const h1 = summary(ledger, periodFor(2026, "h1", 1));
  assert.equal(h1.opening, 12000);
  assert.equal(h1.income, 5000);
  assert.equal(h1.expense, 3000);
  assert.equal(h1.closing, 14000);
  const h2 = summary(ledger, periodFor(2026, "h2", 1));
  assert.equal(h2.opening, h1.closing);
  assert.equal(h2.closing, 7000);
  const year = summary(ledger, periodFor(2026, "year", 1));
  assert.equal(year.closing, 7000);
  assert.equal(year.income, 5000);
});
test("leap years and invalid calendar dates", () => {
  assert.equal(periodFor(2024, "month", 2).end, "2024-02-29");
  assert.equal(periodFor(2026, "month", 2).end, "2026-02-28");
  assert.equal(validDate("2026-06-31"), false);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2024-02-29"), true);
});
test("money is calculated in integer cents", () => {
  assert.equal(parseAmount("0.10") + parseAmount("0.20"), 30);
  assert.equal(parseAmount("12.5"), 1250);
  for (const invalid of ["0", "-1", "1.234", "1e3", "NaN", "2,000"])
    assert.throws(() => parseAmount(invalid));
});
test("search intersects words across project, party and receipt and ignores case", () => {
  assert.equal(
    filterTransactions(ledger.transactions, "YAKULT 财政 001", "income", "")
      .length,
    2,
  );
  assert.equal(
    filterTransactions(ledger.transactions, "700", "all", "").length,
    0,
  );
  assert.equal(
    filterTransactions(ledger.transactions, "", "all", "", "void").length,
    1,
  );
});
