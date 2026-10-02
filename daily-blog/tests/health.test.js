import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./helpers/app.js";

test("GET /health 返回存活状态", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
  assert.ok(res.body.requestId);
});

test("GET /ready 校验数据库可用", async () => {
  const res = await request(app).get("/ready");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ready");
  assert.equal(res.body.database, "ok");
});

test("未知路径返回 404 错误页", async () => {
  const res = await request(app).get("/not-exist");
  assert.equal(res.status, 404);
  assert.match(res.text, /404/);
});
