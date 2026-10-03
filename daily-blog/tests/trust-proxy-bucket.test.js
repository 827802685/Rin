import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createIsolatedApp } from "./helpers/isolated-app.js";

/**
 * 限流分桶跟着 TRUST_PROXY 走。
 *
 * 这是「配错代理」最实际的代价：不配跳数时，所有人都被算成同一个来源，
 * 一个人的额度耗尽会连坐所有访客；配对了，各用各的。
 * 两种情况都在这里断言，形成对照。
 */

const { app, db } = await createIsolatedApp({
  tag: "trust-proxy-bucket",
  withSeed: true,
  env: {
    TRUST_PROXY: "1",
    RATE_LIMIT_ENABLED: "true",
    RATE_LIMIT_MAX: "2",
    RATE_LIMIT_WINDOW_SECONDS: "60",
    CSRF_ENABLED: "false",
  },
});

const CLIENT_A = "203.0.113.9";
const CLIENT_B = "198.51.100.7";

/** 清空全部命中，让每个用例从零额度开始（限流记在主库里，直接清表最快）。 */
function reset() {
  db.prepare("DELETE FROM rate_limit_hits").run();
}

async function hit(forwardedFor) {
  return request(app).get("/").set("X-Forwarded-For", forwardedFor);
}

test("配了跳数：不同客户端各用自己的额度", async () => {
  reset();

  const first = await hit(CLIENT_A);
  assert.equal(first.status, 200);

  // 另一个来源：额度独立，应当是满的（2 - 1 = 1）。
  const other = await hit(CLIENT_B);
  assert.equal(other.status, 200);
  assert.equal(other.headers["ratelimit-remaining"], "1");

  // A 再打一次耗尽自己的额度，不影响 B。
  const again = await hit(CLIENT_A);
  assert.equal(again.headers["ratelimit-remaining"], "0");
  assert.equal((await hit(CLIENT_A)).status, 429);
  assert.equal((await hit(CLIENT_B)).status, 200, "B 的额度不该被 A 用光");
});

test("不配跳数：所有访客连坐同一个额度", async () => {
  reset();
  app.set("trust proxy", false);

  const first = await hit(CLIENT_A);
  assert.equal(first.status, 200);
  assert.equal(first.headers["ratelimit-remaining"], "1");

  // 转发头被忽略，B 被算成和 A 同一个来源：额度接着扣。
  const second = await hit(CLIENT_B);
  assert.equal(second.headers["ratelimit-remaining"], "0");
  assert.equal((await hit(CLIENT_A)).status, 429, "A 被 B 消耗的额度挡在门外");

  app.set("trust proxy", 1);
});
