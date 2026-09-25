import fs from "node:fs";

// 测试使用独立数据库（按进程区分，支持并行执行），每次运行前删除，保证结果可重复。
const dbPath = `./data/test-${process.pid}.db`;
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

process.env.NODE_ENV = "test";
process.env.DB_PATH = dbPath;
process.env.SITE_PAGE_SIZE = "2";
process.env.LOG_LEVEL = "error";

// 环境变量必须在导入配置模块之前设置，因此使用动态 import。
const { createApp } = await import("../../src/app.js");
const { getDb } = await import("../../src/db/index.js");
const { seed } = await import("../../src/db/seed.js");

seed(getDb());

export const app = createApp();
export const testDbPath = dbPath;
