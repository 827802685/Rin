import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./helpers/app.js";

/** 示例标签「迭代」的 slug 就是中文本身，URL 里需要编码后请求。 */
const ITERATION_TAG = encodeURIComponent("迭代");

test("首页文章卡片展示分类与标签", async () => {
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.match(res.text, />每日迭代<\/a>/, "首页应显示分类chip");
  assert.match(res.text, new RegExp(`href="/tags/${ITERATION_TAG}"`));
  assert.match(res.text, />架构设计<\/a>/);
});

test("站点头部提供分类与标签入口", async () => {
  const res = await request(app).get("/");
  assert.match(res.text, /href="\/categories"/);
  assert.match(res.text, /href="\/tags"/);
});

test("分类总览列出全部分类与已发布文章数", async () => {
  const res = await request(app).get("/categories");
  assert.equal(res.status, 200);
  assert.match(res.text, /共 2 个分类/);
  assert.match(res.text, /href="\/categories\/daily-iteration"/);
  assert.match(res.text, /href="\/categories\/engineering"/);
  assert.match(res.text, />2 篇<\/span>/);
  assert.match(res.text, />1 篇<\/span>/);
});

test("分类页只显示该分类下的已发布文章", async () => {
  const res = await request(app).get("/categories/daily-iteration");
  assert.equal(res.status, 200);
  assert.match(res.text, /共 2 篇已发布文章/);
  assert.match(res.text, /第一天：搭起能跑起来的最小博客/);
  assert.match(res.text, /为什么选择每日迭代/);
  assert.doesNotMatch(res.text, /工程底线：配置、日志与错误处理/);
  assert.match(res.text, /返回全部分类/);
});

test("标签总览与标签文章页按已发布文章统计", async () => {
  const list = await request(app).get("/tags");
  assert.equal(list.status, 200);
  assert.match(list.text, /href="\/tags\/methodology"/);
  assert.match(list.text, />2 篇<\/span>/, "标签「迭代」下有 2 篇已发布文章");

  const detail = await request(app).get(`/tags/${ITERATION_TAG}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /标签：迭代/);
  assert.match(detail.text, /第一天：搭起能跑起来的最小博客/);
  assert.match(detail.text, /为什么选择每日迭代/);
  assert.doesNotMatch(detail.text, /工程底线：配置、日志与错误处理/);
});

test("文章详情页展示分类与标签链接", async () => {
  const res = await request(app).get("/posts/hello-daily-blog");
  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/categories\/daily-iteration"/);
  assert.match(res.text, new RegExp(`href="/tags/${ITERATION_TAG}"`));
  assert.match(res.text, />架构设计<\/a>/);
});

test("不存在的分类与标签返回 404", async () => {
  const category = await request(app).get("/categories/no-such-category");
  assert.equal(category.status, 404);
  assert.match(category.text, /分类不存在/);

  const tag = await request(app).get("/tags/no-such-tag");
  assert.equal(tag.status, 404);
  assert.match(tag.text, /标签不存在/);
});
