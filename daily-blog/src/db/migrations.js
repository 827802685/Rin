import fs from "node:fs";
import path from "node:path";
import { DatabaseError } from "../errors.js";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "..", "migrations");

/**
 * 限流专用库只需要这一份迁移。
 *
 * Day 8 起限流计数可以放到独立的共享库文件（`RATE_LIMIT_DB_PATH`），
 * 那份库里没有文章、没有评论，没必要把 001~005 全建一遍。
 * 代价是：将来若有迁移改动 `rate_limit_hits`，必须同步把文件名加到这里。
 */
export const RATE_LIMIT_MIGRATION_FILES = ["006_rate_limit.sql"];

/** 同步睡眠：better-sqlite3 是同步 API，等锁时只能阻塞。 */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 「锁竞争」这类错误重试有意义；语法错误、约束冲突重试一百次也一样。 */
function isTransient(error) {
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i.test(
    error?.message ?? "",
  );
}

/** 真正执行一轮迁移；遇到锁竞争由调用方重试。 */
function applyMigrations(db, files) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version),
  );
  const isApplied = (file) =>
    db.prepare("SELECT 1 AS ok FROM schema_migrations WHERE version = ?").get(file) !== undefined;

  const executed = [];
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      // IMMEDIATE：立刻拿写锁。多实例同时首次启动时，另一个进程会在这里等到
      // 前一个提交完（busy_timeout），然后看到版本记录、跳过这份迁移；
      // 用延迟事务的话两边都会一路走到 INSERT，撞 UNIQUE 约束直接崩在启动阶段。
      db.exec("BEGIN IMMEDIATE");
      if (isApplied(file)) {
        db.exec("COMMIT");
        continue;
      }
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new DatabaseError(`迁移 ${file} 执行失败：${error.message}`);
    }
    executed.push(file);
  }

  return executed;
}

/**
 * 迁移执行器：按文件名顺序执行未执行过的 SQL 迁移，单迁移单事务。
 * 已执行的迁移记录在 schema_migrations 表中，重复启动不会重复执行。
 *
 * `only` 用于只应用其中几份迁移（限流共享库场景）；不传即全部。
 *
 * 锁竞争会重试三次：多实例同时首启时，进程之间抢的是同一个库文件的写锁，
 * 而 busy_timeout 之外的 SQLITE_BUSY_SNAPSHOT 之类并不会自动等，
 * 重试比「第二个实例启动失败」体面得多。迁移是幂等的，重跑一轮不会出问题。
 */
export function runMigrations(db, { only = null } = {}) {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => (only ? only.includes(file) : true))
    .sort();

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return applyMigrations(db, files);
    } catch (error) {
      if (!isTransient(error)) {
        throw error;
      }
      lastError = error;
      sleep(150 * (attempt + 1));
    }
  }
  throw lastError;
}
