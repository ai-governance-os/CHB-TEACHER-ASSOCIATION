import type { Ledger } from "./types.js";
import type { BookId } from "./books.js";

// Session memory only: no financial records in localStorage or shared browser caches.
export class LedgerCache {
  private entries = new Map<BookId, { ledger: Ledger; at: number }>();
  get(id: BookId) {
    return this.entries.get(id);
  }
  set(id: BookId, ledger: Ledger, at = Date.now()) {
    if (ledger.id !== id) throw new Error("账本载入不一致，请重新连接");
    this.entries.set(id, { ledger, at });
  }
  fresh(id: BookId, now = Date.now()) {
    const entry = this.entries.get(id);
    return !!entry && now - entry.at < 15000;
  }
  clear() {
    this.entries.clear();
  }
}
