import fs from "node:fs";
import path from "node:path";
import { DatabaseError } from "../errors.js";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "..", "migrations");

/**
 * 迁移执行器：按文件名顺序执行未执行过的 SQL 迁移，单迁移单事务。
 * 已执行的迁移记录在 schema_migrations 表中，重复启动不会重复执行。
 */
export function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version),
  );

  const executed = [];
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      db.exec("BEGIN");
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
