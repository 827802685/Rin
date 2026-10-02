import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./helpers/app.js";

/**
 * SEO meta 用例：canonical / Open Graph / article:* / 订阅发现。
 * 这些标签肉眼看不出来，写错也不会报错，只能靠断言固定下来。
 */

test("首页输出 canonical 与站点级 Open Graph 标签", async () => {
  const res = await request(app).get("/");
  assert.equal(res.status, 200);
  assert.match(res.text, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/" \/>/);
  assert.match(res.text, /<meta property="og:type" content="website" \/>/);
  assert.match(res.text, /<meta property="og:site_name" content="每日迭代博客" \/>/);
  assert.match(res.text, /<meta property="og:locale" content="zh_CN" \/>/);
  assert.match(res.text, /<meta name="twitter:card" content="summary" \/>/);
  assert.match(res.text, /<meta name="robots" content="index, follow" \/>/);
});

test("分页参数不会污染 canonical", async () => {
  const res = await request(app).get("/?page=2");
  assert.equal(res.status, 200);
  assert.match(res.text, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/" \/>/);
  assert.doesNotMatch(res.text, /canonical" href="[^"]*\?page=/);
});

test("文章页输出 article 级 SEO 标签", async () => {
  const res = await request(app).get("/posts/hello-daily-blog");
  assert.equal(res.status, 200);
  assert.match(res.text, /<meta property="og:type" content="article" \/>/);
  assert.match(
    res.text,
    /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/posts\/hello-daily-blog" \/>/,
  );
  assert.match(
    res.text,
    /<meta property="article:published_time" content="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z" \/>/,
  );
  assert.match(res.text, /<meta property="article:author" content="admin" \/>/);
  assert.match(res.text, /<meta property="article:section" content="每日迭代" \/>/);
  assert.match(res.text, /<meta property="article:tag" content="迭代" \/>/);
  assert.match(res.text, /<meta property="article:tag" content="架构设计" \/>/);
});

test("分类页与标签页各自输出 canonical", async () => {
  const category = await request(app).get("/categories/daily-iteration");
  assert.equal(category.status, 200);
  assert.match(
    category.text,
    /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/categories\/daily-iteration" \/>/,
  );

  const tag = await request(app).get(`/tags/${encodeURIComponent("迭代")}`);
  assert.equal(tag.status, 200);
  assert.match(
    tag.text,
    new RegExp(
      `<link rel="canonical" href="http://127\\.0\\.0\\.1:\\d+/tags/${encodeURIComponent("迭代")}" />`,
    ),
  );
});

test("全站提供 RSS 与站点地图的发现入口", async () => {
  const res = await request(app).get("/");
  assert.match(
    res.text,
    /<link rel="alternate" type="application\/rss\+xml" title="每日迭代博客 · RSS" href="http:\/\/127\.0\.0\.1:\d+\/feed\.xml" \/>/,
  );
  assert.match(res.text, /href="http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml"/);
});
