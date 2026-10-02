import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createIsolatedApp } from "./helpers/isolated-app.js";

/**
 * 全局限流与登录限流。
 *
 * 额度刻意调小（3 次 / 60 秒、登录 2 次 / 10 分钟）才能在用例里触发到边界；
 * 生产默认值在 config.js 里，是另一个数量级。
 * CSRF 在这里关掉：本文件只关心「请求次数」，带令牌会平白多消耗额度。
 */
const { app, db } = await createIsolatedApp({
  tag: "rate-limit",
  withSeed: true,
  env: {
    RATE_LIMIT_MAX: "3",
    RATE_LIMIT_WINDOW_SECONDS: "60",
    LOGIN_RATE_MAX: "2",
    LOGIN_RATE_WINDOW_MINUTES: "10",
    CSRF_ENABLED: "false",
  },
});

const { rateLimitService } = await import("../src/services/rate-limit.service.js");

/** 把某个桶的历史清干净，让每个用例都从空额度开始。 */
function clearBucket(bucket) {
  db.prepare("DELETE FROM rate_limit_hits WHERE bucket = ?").run(bucket);
}

/** 清空全部桶：统计「整表」的用例必须从零开始，否则会被上一个用例的残留带走。 */
function clearAllBuckets() {
  db.prepare("DELETE FROM rate_limit_hits").run();
}

function hits(bucket) {
  return db
    .prepare("SELECT COUNT(*) AS total FROM rate_limit_hits WHERE bucket = ?")
    .get(bucket).total;
}

test("额度内放行并回传速率头", async () => {
  clearBucket("general");

  const res = await request(app).get("/");

  assert.equal(res.status, 200);
  assert.equal(res.headers["ratelimit-limit"], "3");
  // 这一次请求本身也算一次命中，因此剩余 2。
  assert.equal(res.headers["ratelimit-remaining"], "2");
  assert.equal(res.headers["ratelimit-reset"], "60");
});

test("超出额度返回 429 并给出 Retry-After", async () => {
  clearBucket("general");

  const statuses = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await request(app).get("/");
    statuses.push(res.status);
  }

  assert.deepEqual(statuses, [200, 200, 200, 429]);
});

test("被限流的响应给出中文提示", async () => {
  clearBucket("general");
  for (let i = 0; i < 3; i += 1) {
    await request(app).get("/");
  }

  const blocked = await request(app).get("/");
  assert.equal(blocked.status, 429);
  assert.match(blocked.text, /请求过于频繁/);
  assert.ok(Number(blocked.headers["retry-after"]) > 0, "Retry-After 应当是正数秒");
});

test("限流命中的是数据库里的记录，不是进程内存", async () => {
  clearBucket("general");
  await request(app).get("/");
  assert.equal(hits("general"), 1);
});

test("静态资源不占用额度", async () => {
  clearBucket("general");
  for (let i = 0; i < 3; i += 1) {
    await request(app).get("/");
  }
  // 额度刚好耗尽（3 次），此时页面已被限流……
  assert.equal((await request(app).get("/")).status, 429);

  // ……但样式表依然可取，否则被限流的用户会看到一个全裸的 HTML 页面。
  const css = await request(app).get("/assets/styles.css");
  assert.equal(css.status, 200);
});

test("登录有独立且更严格的额度", async () => {
  clearBucket("login");

  const wrong = { username: "admin", password: "definitely-wrong-password" };
  const statuses = [];
  for (let i = 0; i < 3; i += 1) {
    const res = await request(app).post("/admin/login").type("form").send(wrong);
    statuses.push(res.status);
  }

  // 额度 2：前两次照常返回 401（口令错），第三次才被限流拦下。
  assert.deepEqual(statuses, [401, 401, 429]);
});

test("被限流的登录给出「登录尝试过于频繁」的提示", async () => {
  clearBucket("login");
  const wrong = { username: "admin", password: "definitely-wrong-password" };
  for (let i = 0; i < 3; i += 1) {
    var blocked = await request(app).post("/admin/login").type("form").send(wrong);
  }
  assert.equal(blocked.status, 429);
  assert.match(blocked.text, /登录尝试过于频繁/);
});

test("登录成功后清零该来源的失败计数", async () => {
  clearBucket("login");

  const ok = await request(app)
    .post("/admin/login")
    .type("form")
    .send({ username: "admin", password: "test-password-123" });
  assert.equal(ok.status, 303);
  assert.equal(hits("login"), 0, "登录成功后该来源的登录记录应当被清空");

  // 额度已重置：还能再错两次，第三次才 429（否则等于自己把自己锁在门外）。
  const wrong = { username: "admin", password: "definitely-wrong-password" };
  const statuses = [];
  for (let i = 0; i < 3; i += 1) {
    const res = await request(app).post("/admin/login").type("form").send(wrong);
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [401, 401, 429]);
});

test("过期的命中记录会被清理掉", async () => {
  clearAllBuckets();
  await request(app).get("/");
  assert.equal(hits("general"), 1);

  // 把时间往前推 10 分钟，超出 60 秒窗口后即属于过期数据。
  db.prepare("UPDATE rate_limit_hits SET created_at = datetime('now', '-600 seconds')").run();
  const pruned = rateLimitService.pruneStale(60);

  assert.equal(pruned, 1);
  assert.equal(hits("general"), 0);
});
