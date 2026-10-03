import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { runMigrations, RATE_LIMIT_MIGRATION_FILES } from "./migrations.js";

let instance = null;
let rateLimitInstance = null;

/**
 * 打开一个库文件并套上统一设置。
 *
 * - WAL：读写不互相阻塞，多个实例共享同一个库文件时也靠它撑住并发；
 * - busy_timeout：别的进程正在写时**等 5 秒**而不是立刻报 SQLITE_BUSY。
 *   多实例共享限流库时这是必须的，否则一次并发写就会让限流「放行并告警」。
 */
function openDatabase(file) {
  const dir = path.dirname(file);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/** 打开数据库连接并应用迁移；进程内复用同一连接。 */
export function getDb() {
  if (instance) {
    return instance;
  }

  const db = openDatabase(config.dbPath);
  runMigrations(db);
  instance = db;
  return db;
}

/**
 * 限流计数的专用连接。
 *
 * 未配 `RATE_LIMIT_DB_PATH` 时复用主库（与 Day 7 行为一致）；
 * 配了就打开独立文件——同一台主机上的多个实例指向同一个文件时，
 * 它们共享同一份额度（SQLite 的跨进程锁保证并发写入不会串行化失败）。
 */
export function getRateLimitDb() {
  const configured = String(config.rateLimit.dbPath ?? "").trim();
  if (!configured || configured === config.dbPath) {
    return getDb();
  }

  if (rateLimitInstance) {
    return rateLimitInstance;
  }

  const db = openDatabase(configured);
  runMigrations(db, { only: RATE_LIMIT_MIGRATION_FILES });
  rateLimitInstance = db;
  return db;
}

export function closeDb() {
  // 先摘引用再关：限流库可能就是主库本身，重复 close 会抛「连接已关闭」。
  const mainDb = instance;
  const rateDb = rateLimitInstance;
  instance = null;
  rateLimitInstance = null;

  if (rateDb && rateDb !== mainDb) {
    rateDb.close();
  }
  if (mainDb) {
    mainDb.close();
  }
}
