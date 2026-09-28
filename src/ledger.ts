import type { Ledger, Period, Transaction, TransactionType } from "./types";
export const money = (cents: number) =>
  new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function parseAmount(value: string) {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("请输入有效金额，最多两位小数");
  const [a, b = ""] = value.trim().split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (n <= 0) throw new Error("金额必须大于零");
  return n;
}
export function periodFor(
  year: number,
  mode: string,
  month: number,
  start = "",
  end = "",
): Period {
  if (mode === "custom") return { start, end, label: "自定义期间" };
  if (mode === "month") {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      start: `${year}-${String(month).padStart(2, "0")}-01`,
      end: `${year}-${String(month).padStart(2, "0")}-${last}`,
      label: `${year}年${month}月`,
    };
  }
  if (mode === "h1")
    return {
      start: `${year}-01-01`,
      end: `${year}-06-30`,
      label: `${year}年上半年`,
    };
  if (mode === "h2")
    return {
      start: `${year}-07-01`,
      end: `${year}-12-31`,
      label: `${year}年下半年`,
    };
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    label: `${year}年全年`,
  };
}
export function summary(ledger: Ledger, period: Period) {
  let opening = ledger.openingCents,
    income = 0,
    expense = 0;
  const rows: Transaction[] = [];
  for (const t of ledger.transactions) {
    if (t.status !== "active") continue;
    const signed = t.type === "income" ? t.amountCents : -t.amountCents;
    if (t.date < period.start) opening += signed;
    else if (t.date <= period.end) {
      rows.push(t);
      if (t.type === "income") income += t.amountCents;
      else expense += t.amountCents;
    }
  }
  return {
    opening,
    income,
    expense,
    closing: opening + income - expense,
    rows: rows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
    ),
  };
}
export function filterTransactions(
  rows: Transaction[],
  q: string,
  type: TransactionType | "all",
  category: string,
  status = "active",
) {
  const terms = q.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return rows
    .filter(
      (t) =>
        (status === "all" || t.status === status) &&
        (type === "all" || t.type === type) &&
        (!category || t.category === category) &&
        terms.every((term) =>
          [
            t.description,
            t.party,
            t.note,
            t.category,
            t.id,
            t.date,
            money(t.amountCents),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(term),
        ),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
}
export function categoryTotals(rows: Transaction[], type: TransactionType) {
  const result: Record<string, number> = {};
  for (const t of rows)
    if (t.status === "active" && t.type === type)
      result[t.category] = (result[t.category] || 0) + t.amountCents;
  return Object.entries(result).sort((a, b) => b[1] - a[1]);
}
