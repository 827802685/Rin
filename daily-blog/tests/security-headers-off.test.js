import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createIsolatedApp } from "./helpers/isolated-app.js";

/**
 * 安全头的总开关。
 * 只验证「关掉就一个都不发」——配置是进程级的，
 * 必须单独起一个进程才能和 tests/security-headers.test.js 取到不同取值。
 */
const { app } = await createIsolatedApp({
  tag: "security-off",
  env: { RATE_LIMIT_ENABLED: "false", SECURITY_HEADERS_ENABLED: "false" },
});

test("关闭开关后不再输出任何安全响应头", async () => {
  const res = await request(app).get("/");

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-security-policy"], undefined);
  assert.equal(res.headers["x-frame-options"], undefined);
  assert.equal(res.headers["referrer-policy"], undefined);
  assert.equal(res.headers["permissions-policy"], undefined);
});
