export type TransactionType = "income" | "expense" | "transfer";
export const typeLabel = (type: TransactionType) =>
  ({ income: "收入", expense: "支出", transfer: "账户转账" })[type];
export type Transaction = {
  id: string;
  date: string;
  type: TransactionType;
  category: string;
  description: string;
  amountCents: number;
  party: string;
  note: string;
  status: "active" | "void";
  version: number;
  createdAt: string;
  updatedAt: string;
  operator: string;
  source: string;
};
export type LedgerEvent = {
  eventId: string;
  action: string;
  transaction: Transaction;
  at: string;
  actor: string;
};
export type Ledger = {
  id?: string;
  reviewNotes?: string[];
  balanceCheckpoints?: { date: string; amountCents: number; note: string }[];
  transactions: Transaction[];
  events: LedgerEvent[];
  openingDate: string;
  openingCents: number;
  sourceNote: string;
  spreadsheetUrl?: string;
};
export type User = {
  username: string;
  displayName: string;
  role: "admin" | "treasurer" | "viewer";
};
export type Period = { start: string; end: string; label: string };
export const incomeCategories = [
  "报效与捐款",
  "义卖收入",
  "饮品回馈",
  "衣服收入",
  "活动结余",
  "其他收入",
];
export const expenseCategories = [
  "教职员福利",
  "聚餐与活动",
  "慰问与帛金",
  "办公室用品",
  "衣服支出",
  "其他支出",
];
