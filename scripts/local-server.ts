import { createServer } from "node:http";
import handler from "../server/handler.js";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* A disconnected local demo is supported. */
}
createServer((req, res) => void handler(req, res)).listen(
  3001,
  "127.0.0.1",
  () => console.log("Ledger API on http://127.0.0.1:3001"),
);
