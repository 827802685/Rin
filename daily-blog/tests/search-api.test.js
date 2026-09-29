import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./helpers/app.js";
import { createSearchFixtures } from "./helpers/search-fixtures.js";

createSearchFixtures();

test("搜索接口返回 JSON 结果、相关度排序与分页信息", async () => {
  const res = await request(app).get(
    `/api/search?q=${encodeURIComponent("分页测试")}`,
  );

  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /json/);
  assert.equal(res.body.query, "分页测试");
  assert.equal(res.body.submitted, true);
  assert.equal(res.body.filters.category, null);
  assert.equal(res.body.filters.tag, null);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.pagination.totalPages, 2);
  assert.equal(res.body.items.length, 2);

  const [first] = res.body.items;
  assert.equal(first.slug, "search-fixture-title");
  assert.equal(first.title, "分页测试：标题命中");
  assert.equal(first.titleHtml, "<mark>分页测试</mark>：标题命中");
  assert.equal(first.url, "/posts/search-fixture-title");
  assert.match(first.excerptHtml, /这篇的关键词写在标题里/);
  assert.equal(first.category.slug, "daily-iteration");
  assert.deepEqual(
    first.tags.map((tag) => tag.slug),
    ["architecture"],
  );
});

test("搜索接口在未提供关键词时返回空结果而不是报错", async () => {
  const res = await request(app).get("/api/search");

  assert.equal(res.status, 200);
  assert.equal(res.body.submitted, false);
  assert.equal(res.body.total, 0);
  assert.deepEqual(res.body.items, []);
  assert.equal(res.body.pagination.page, 1);
});

test("搜索接口只返回已发布文章", async () => {
  const res = await request(app).get(`/api/search?q=${encodeURIComponent("分页测试")}`);
  const slugs = res.body.items.map((item) => item.slug);

  assert.ok(!slugs.includes("search-fixture-draft"), "草稿不应出现在接口结果里");
});

test("搜索接口支持分类与标签筛选", async () => {
  const res = await request(app).get(
    `/api/search?q=${encodeURIComponent("分页测试")}&tag=architecture&page=1`,
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.filters.tag, "architecture");
  assert.equal(res.body.total, 1);
  assert.equal(res.body.items[0].slug, "search-fixture-title");
});

test("搜索接口的关键词超长返回 400 JSON", async () => {
  const res = await request(app).get(`/api/search?q=${encodeURIComponent("长".repeat(65))}`);

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "validation_error");
  assert.match(res.body.error.message, /搜索关键词最长 64 个字符/);
});

test("搜索接口在筛选条件不存在时返回 404 JSON", async () => {
  const res = await request(app).get("/api/search?q=test&category=no-such-category");

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "not_found");
});
