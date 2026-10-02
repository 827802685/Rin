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
// 评论的频率限制默认 3 条 / 10 分钟，冒烟型用例会连续提交多条，这里放宽到不影响功能验证。
// 频率限制本身的用例在 tests/comment-antispam.test.js 中用独立进程 + 独立配置覆盖。
process.env.COMMENT_RATE_LIMIT = "50";

// Day 7 启用了 CSRF 与全局限流。这两个横切能力不适合塞进业务断言里：
// 每个写请求都得先取表单令牌，用例的主体会变成「怎么发请求」而不是「业务规则对不对」。
// 处理口径与上面的评论限流一致——全局默认开启，发送 Day 1-6 的用例时关掉，
// 功能本身由 tests/csrf.test.js 与 tests/rate-limit.test.js 用独立配置专门覆盖。
process.env.CSRF_ENABLED = "false";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.LOGIN_RATE_MAX = "100";

// 环境变量必须在导入配置模块之前设置，因此使用动态 import。
const { createApp } = await import("../../src/app.js");
const { getDb } = await import("../../src/db/index.js");
const { seed } = await import("../../src/db/seed.js");
const { authService } = await import("../../src/services/auth.service.js");

seed(getDb());
authService.ensureAdminFromEnv();

// 进程退出时自行收摊：Day 1-6 累积下来 data/ 里堆了几百个 test-<pid>.db，
// 靠 npm run cleanup 事后清理远不如自己用完就删。
// 两个坑：① 必须先关连接，Windows 上删不掉被占用的文件（EBUSY 会让进程异常退出）；
//       ② 清理失败不能影响测试结果，删不掉就留给 npm run cleanup。
const { closeDb } = await import("../../src/db/index.js");
process.on("exit", () => {
  try {
    closeDb();
  } catch {}
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {}
  }
});

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
