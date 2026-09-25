import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { runMigrations } from "./migrations.js";

let instance = null;

/** 打开数据库连接并应用迁移；进程内复用同一连接。 */
export function getDb() {
  if (instance) {
    return instance;
  }

  const dir = path.dirname(config.dbPath);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  runMigrations(db);
  instance = db;
  return db;
}

export function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}
