import { getDb } from "./index.js";
import { safeRun } from "./errors.js";

/**
 * 把一个「只由仓储层调用组成」的函数包进事务。
 * better-sqlite3 的 transaction 支持嵌套（内部使用 savepoint），因此可以在
 * 已经处于事务中的调用链里继续使用。
 */
export function withTransaction(fn) {
  return safeRun("withTransaction", () => getDb().transaction(fn)());
}
