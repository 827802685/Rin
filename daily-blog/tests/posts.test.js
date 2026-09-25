import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./helpers/app.js";

test("首页渲染已发布文章列表", async () => {
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.match(res.text, /最新文章/);
  assert.match(res.text, /第一天：搭起能跑起来的最小博客/);
});

test("分页参数生效且首页只显示第一页", async () => {
  const res = await request(app).get("/?page=1");
  assert.equal(res.status, 200);
  assert.match(res.text, /第 1 \/ 2 页/);

  const secondPage = await request(app).get("/?page=2");
  assert.equal(secondPage.status, 200);
  assert.match(secondPage.text, /第 2 \/ 2 页/);
});

test("文章详情页渲染 Markdown 正文", async () => {
  const res = await request(app).get("/posts/hello-daily-blog");
  assert.equal(res.status, 200);
  assert.match(res.text, /<h2>今天做了什么<\/h2>/);
  assert.match(res.text, /返回文章列表/);
});

test("不存在的文章返回 404", async () => {
  const res = await request(app).get("/posts/unknown-post");
  assert.equal(res.status, 404);
  assert.match(res.text, /文章不存在/);
});

test("静态样式可访问", async () => {
  const res = await request(app).get("/assets/styles.css");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /css/);
});
