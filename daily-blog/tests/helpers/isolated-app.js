import fs from "node:fs";

/**
 * 按用例文件单独起一个应用实例：环境变量与数据库完全独立。
 *
 * 为什么需要它：`tests/helpers/app.js` 里的环境变量是写死的（进程级、只生效一次），
 * 而「频率限制」「外链上限」这类防灌水规则必须靠配置项取不同值才能覆盖，
 * 只能在导入应用之前改写环境变量。每个测试文件由 node:test 单独起进程执行，
 * 因此这里的 env 改写不会影响其他测试文件。
 */
export async function createIsolatedApp({ tag, env = {}, withSeed = false } = {}) {
  const dbPath = `./data/test-${process.pid}-${tag}.db`;
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }

  process.env.NODE_ENV = "test";
  process.env.DB_PATH = dbPath;
  process.env.SITE_PAGE_SIZE = "2";
  process.env.LOG_LEVEL = "error";
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "test-password-123";
  process.env.SESSION_TTL_HOURS = "2";
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = String(value);
  }

  // 环境变量必须在导入配置模块之前设置，因此使用动态 import。
  const { createApp } = await import("../../src/app.js");
  const { getDb } = await import("../../src/db/index.js");

  const db = getDb();
  if (withSeed) {
    const { seed } = await import("../../src/db/seed.js");
    const { authService } = await import("../../src/services/auth.service.js");
    seed(db);
    authService.ensureAdminFromEnv();
  }

  return { app: createApp(), db, dbPath };
}
