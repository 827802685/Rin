import fs from "node:fs";
import request from "supertest";

// 测试使用独立数据库（按进程区分，支持并行执行），每次运行前删除，保证结果可重复。
const dbPath = `./data/test-${process.pid}.db`;
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

process.env.NODE_ENV = "test";
process.env.DB_PATH = dbPath;
process.env.SITE_PAGE_SIZE = "2";
process.env.LOG_LEVEL = "error";
// 后台登录测试使用固定凭据；测试库独立，不会影响本地开发库。
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.SESSION_TTL_HOURS = "2";

// 环境变量必须在导入配置模块之前设置，因此使用动态 import。
const { createApp } = await import("../../src/app.js");
const { getDb } = await import("../../src/db/index.js");
const { seed } = await import("../../src/db/seed.js");
const { authService } = await import("../../src/services/auth.service.js");

seed(getDb());
authService.ensureAdminFromEnv();

export const app = createApp();
export const testDbPath = dbPath;
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/** 把响应的 Set-Cookie 拼成可直接用于后续请求的 Cookie 头。 */
export function cookieHeaderFrom(response) {
  const raw = response.headers["set-cookie"] ?? [];
  return raw.map((line) => line.split(";")[0]).join("; ");
}

/** 登录并返回 Cookie，供需要后台权限的用例复用。 */
export async function loginAs(username = ADMIN_USERNAME, password = ADMIN_PASSWORD) {
  const response = await request(app)
    .post("/admin/login")
    .type("form")
    .send({ username, password });
  return { response, cookie: cookieHeaderFrom(response) };
}
