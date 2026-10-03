import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import request from "supertest";
import { createIsolatedApp } from "./helpers/isolated-app.js";

/**
 * 运行形态配置：INSTANCE_ID / RATE_LIMIT_STORE。
 *
 * 这一类配置写错的表现是「悄悄用了另一个值」而不是报错，
 * 所以除了行为断言，还要验证**非法取值会让进程启动失败**（fail fast）。
 */

const ROOT = path.join(import.meta.dirname, "..");

/** 用子进程实跑一次配置加载：非法取值必须让它非 0 退出。 */
function loadConfigWith(env) {
  try {
    execFileSync(
      process.execPath,
      ["--input-type=module", "-e", "await import('./src/config.js')"],
      { cwd: ROOT, env: { ...process.env, ...env }, stdio: "pipe" },
    );
    return { failed: false, stderr: "" };
  } catch (error) {
    return { failed: true, stderr: String(error.stderr ?? "") };
  }
}

test("RATE_LIMIT_STORE 取值非法时启动即失败", () => {
  const result = loadConfigWith({ RATE_LIMIT_STORE: "redis" });
  assert.equal(result.failed, true, "非法取值必须让进程退出，而不是悄悄回落");
  assert.match(result.stderr, /RATE_LIMIT_STORE/);
});

test("TRUST_PROXY 取值非法时启动即失败", () => {
  const result = loadConfigWith({ TRUST_PROXY: "放我进去" });
  assert.equal(result.failed, true);
  assert.match(result.stderr, /TRUST_PROXY/);
});

test("合法取值不会阻止启动", () => {
  for (const env of [
    { RATE_LIMIT_STORE: "memory", TRUST_PROXY: "1" },
    { RATE_LIMIT_STORE: "sqlite", TRUST_PROXY: "10.0.0.1,loopback" },
  ]) {
    const result = loadConfigWith(env);
    assert.equal(result.failed, false, `配置 ${JSON.stringify(env)} 应当能正常加载`);
  }
});

// ---------- memory 存储：行为一致，只是不落盘、不共享 ----------

const { app, db } = await createIsolatedApp({
  tag: "rate-memory",
  withSeed: true,
  env: {
    INSTANCE_ID: "instance-alpha",
    RATE_LIMIT_STORE: "memory",
    RATE_LIMIT_ENABLED: "true",
    RATE_LIMIT_MAX: "2",
    RATE_LIMIT_WINDOW_SECONDS: "60",
    CSRF_ENABLED: "false",
  },
});

test("memory 存储下健康检查报告存储形态与实例标识", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.body.rateLimit.store, "memory");
  assert.equal(res.body.rateLimit.shared, false);
  assert.equal(res.body.instanceId, "instance-alpha");
});

test("memory 存储下额度照样生效", async () => {
  // 上一条用例已经打过一次 /health，先把内存里的计数清干净再看额度。
  const { getRateLimitStore } = await import("../src/lib/rate-limit-store.js");
  getRateLimitStore().pruneStale(0);

  const statuses = [];
  for (let i = 0; i < 3; i += 1) {
    const res = await request(app).get("/");
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [200, 200, 429]);
});

test("memory 存储不写数据库：主库的命中表始终为空", async () => {
  const { getRateLimitStore } = await import("../src/lib/rate-limit-store.js");
  const store = getRateLimitStore();
  assert.equal(store.kind, "memory");
  assert.ok(store.countAll() > 0, "计数确实都在内存里，没丢");

  // 主库干干净净：换成 memory 之后不会有人在库里找到半份计数。
  const rows = db.prepare("SELECT COUNT(*) AS total FROM rate_limit_hits").get().total;
  assert.equal(rows, 0);
});
