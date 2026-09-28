import { incomeCategories, expenseCategories } from "./types.js";
export const books = {
  teachers: {
    name: "教师联谊会",
    incomeCategories,
    expenseCategories,
  },
  pta: {
    name: "家协",
    incomeCategories: [
      "报效与捐款",
      "政府拨款",
      "活动收入",
      "定存利息",
      "其他收入",
    ],
    expenseCategories: [
      "学校日常费用",
      "设施与维修",
      "学生活动",
      "援助与福利",
      "账户转出（待核对）",
      "其他支出",
    ],
  },
  store: {
    name: "贩卖部",
    incomeCategories: ["簿子与文具", "资源回收", "账户转入", "其他收入"],
    expenseCategories: ["学生奖励", "簿子进货", "文具进货", "其他支出"],
  },
} as const;
export type BookId = keyof typeof books;
export function isBookId(id: unknown): id is BookId {
  return typeof id === "string" && Object.hasOwn(books, id);
}
export function bookFor(id?: string) {
  return books[isBookId(id) ? id : "teachers"];
}
