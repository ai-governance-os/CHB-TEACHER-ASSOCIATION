import type { Ledger, Transaction } from "./types";
import { books, type BookId } from "./books";
// Fictional data only. Real school financial records are never included in a public bundle.
export function demoLedger(id: BookId = "teachers"): Ledger {
  const y = new Date().getFullYear();
  const rows: Array<[string, "income" | "expense", string, string, number]> =
    [];
  for (let m = 1; m <= 9; m++) {
    const mm = String(m).padStart(2, "0");
    rows.push(
      [
        `${y}-${mm}-05`,
        "income",
        "饮品回馈",
        "饮品回馈（演示）",
        (70 + m * 17) * 100,
      ],
      [
        `${y}-${mm}-12`,
        "expense",
        "教职员福利",
        "教职员生日祝福（演示）",
        (40 + (m % 3) * 20) * 100,
      ],
    );
    if (m % 2 === 0)
      rows.push([
        `${y}-${mm}-18`,
        "expense",
        "办公室用品",
        "办公室用品（演示）",
        (34 + m * 11) * 100,
      ]);
  }
  rows.push(
    [`${y}-02-23`, "income", "报效与捐款", "新春活动报效（演示）", 120000],
    [`${y}-06-15`, "expense", "聚餐与活动", "教师联谊聚餐（演示）", 68000],
    [`${y}-08-11`, "income", "义卖收入", "校园义卖活动（演示）", 208000],
    [`${y}-09-20`, "expense", "办公室用品", "办公室茶水用品（演示）", 9600],
  );
  const ts = rows.map(
    (r, i): Transaction => ({
      id: `DEMO-${String(i + 1).padStart(4, "0")}`,
      date: r[0],
      type: r[1],
      category:
        id === "teachers"
          ? r[2]
          : books[id][
              r[1] === "income" ? "incomeCategories" : "expenseCategories"
            ][i % 3],
      description:
        id === "teachers"
          ? r[3]
          : `${books[id].name}${r[1] === "income" ? "收入" : "支出"}项目 ${i + 1}（演示）`,
      amountCents: r[4],
      party: "",
      note: "虚构演示数据",
      status: "active",
      version: 1,
      createdAt: r[0] + "T00:00:00Z",
      updatedAt: r[0] + "T00:00:00Z",
      operator: "演示财政",
      source: "demo",
    }),
  );
  return {
    id,
    transactions: ts,
    events: [],
    openingDate: "2024-01-01",
    openingCents: 280000,
    sourceNote:
      "当前使用虚构演示数据。演示操作仅在本次页面中保留，不写入学校账本。",
  };
}
