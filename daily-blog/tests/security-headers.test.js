import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createIsolatedApp } from "./helpers/isolated-app.js";

/**
 * 安全响应头用例。
 * 限流在这里关掉：它和响应头无关，开着只会让用例在额度上失败。
 */
const { app } = await createIsolatedApp({
  tag: "security-headers",
  env: {
    RATE_LIMIT_ENABLED: "false",
    // 默认 0（不发送）；这里给一个常见的一年，用来验证「只在 HTTPS 下发送」这条规则。
    SECURITY_HSTS_MAX_AGE: "31536000",
  },
});

test("普通页面带上基础安全头", async () => {
  const res = await request(app).get("/");

  assert.equal(res.status, 200);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(res.headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(res.headers["cross-origin-resource-policy"], "same-origin");
});

test("响应里不再暴露 X-Powered-By", async () => {
  const res = await request(app).get("/");
  assert.equal(res.headers["x-powered-by"], undefined);
});

test("CSP 不允许任何内联脚本或内联样式", async () => {
  const res = await request(app).get("/");
  const csp = res.headers["content-security-policy"];

  assert.ok(csp, "应当输出 Content-Security-Policy");
  // 'unsafe-inline' 一旦放行，CSP 对 XSS 基本失去意义；'unsafe-eval' 同理。
  assert.equal(/unsafe-inline/.test(csp), false);
  assert.equal(/unsafe-eval/.test(csp), false);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'self'/);
});

test("CSP 的表单提交目标限定为本站", async () => {
  const res = await request(app).get("/");
  assert.match(res.headers["content-security-policy"], /form-action 'self'/);
});

test("Permissions-Policy 关闭敏感能力", async () => {
  const res = await request(app).get("/");
  const policy = res.headers["permissions-policy"] ?? "";

  assert.match(policy, /camera=\(\)/);
  assert.match(policy, /microphone=\(\)/);
  assert.match(policy, /geolocation=\(\)/);
});

test("错误页同样带安全头，不会因为走了异常路径就漏掉", async () => {
  const res = await request(app).get("/definitely-not-a-page");

  assert.equal(res.status, 404);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.ok(res.headers["content-security-policy"]);
});

test("明文 HTTP 请求不发送 HSTS", async () => {
  const res = await request(app).get("/");
  assert.equal(res.headers["strict-transport-security"], undefined);
});

test("确认是 HTTPS 请求时才发送 HSTS", async () => {
  const res = await request(app).get("/").set("X-Forwarded-Proto", "https");

  assert.equal(res.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
});
