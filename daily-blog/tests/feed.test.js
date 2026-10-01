import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./helpers/app.js";
import { getDb } from "../src/db/index.js";

/**
 * 订阅源用例的固定数据：
 * - 一篇草稿，验证草稿绝不外泄到 RSS / sitemap（这是最容易漏的一条口径）；
 * - 一篇标题含 XML 特殊字符的文章，验证转义（一个 & 就能让订阅源变成坏 XML）。
 */
const FEED_FIXTURES = [
  {
    slug: "feed-fixture-draft",
    title: "订阅源里不该出现的草稿",
    publishedAt: null,
    status: "draft",
  },
  {
    slug: "feed-fixture-escaped",
    title: '转义测试 & <标签> "引号"',
    publishedAt: "2026-09-26 08:00:00",
    status: "published",
  },
];

function createFeedFixtures() {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO posts (slug, title, summary, content_md, status, author, published_at)
     VALUES (@slug, @title, '订阅源用例固定数据', '订阅源正文。', @status, 'admin', @publishedAt)
     ON CONFLICT(slug) DO NOTHING`,
  );
  db.transaction((posts) => {
    for (const post of posts) {
      insert.run(post);
    }
  })(FEED_FIXTURES);
}

createFeedFixtures();

test("RSS 输出规范的频道信息", async () => {
  const res = await request(app).get("/feed.xml");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/xml/);
  assert.match(res.headers["cache-control"], /max-age=300/);
  assert.match(res.text, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(res.text, /<rss version="2\.0"/);
  assert.match(res.text, /<title>每日迭代博客<\/title>/);
  assert.match(res.text, /<language>zh-CN<\/language>/);
  assert.match(res.text, /<atom:link href="http:\/\/127\.0\.0\.1:\d+\/feed\.xml" rel="self"/);
});

test("RSS 每篇文章都有稳定 guid 与 RFC 822 时间", async () => {
  const res = await request(app).get("/feed.xml");
  assert.match(res.text, /<link>http:\/\/127\.0\.0\.1:\d+\/posts\/hello-daily-blog<\/link>/);
  assert.match(
    res.text,
    /<guid isPermaLink="true">http:\/\/127\.0\.0\.1:\d+\/posts\/hello-daily-blog<\/guid>/,
  );
  // pubDate 必须是 RFC 822/1123（Mon, 02 Oct 2026 03:04:05 GMT），自己拼字符串很容易写错。
  assert.match(res.text, /<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/);
  assert.match(res.text, /<dc:creator>admin<\/dc:creator>/);
});

test("RSS 对标题里的 XML 特殊字符做转义", async () => {
  const res = await request(app).get("/feed.xml");
  assert.match(res.text, /转义测试 &amp; &lt;标签&gt; &quot;引号&quot;/);
  assert.doesNotMatch(res.text, /<title>转义测试 & <标签>/);
});

test("草稿不出现在 RSS 里", async () => {
  const res = await request(app).get("/feed.xml");
  assert.doesNotMatch(res.text, /订阅源里不该出现的草稿/);
  assert.doesNotMatch(res.text, /feed-fixture-draft/);
});

test("sitemap 覆盖文章、分类、标签与归档，且不含草稿", async () => {
  const res = await request(app).get("/sitemap.xml");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/xml/);
  assert.match(res.text, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);

  for (const path of [
    "/",
    "/archive",
    "/archive/2026",
    "/categories",
    "/categories/daily-iteration",
    "/tags",
    "/posts/hello-daily-blog",
  ]) {
    assert.match(
      res.text,
      new RegExp(`<loc>http://127\\.0\\.0\\.1:\\d+${path.replace(/\//g, "\\/")}<\\/loc>`),
      `站点地图应包含 ${path}`,
    );
  }

  assert.doesNotMatch(res.text, /feed-fixture-draft/);
  assert.match(res.text, /<lastmod>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z<\/lastmod>/);
});

test("robots.txt 屏蔽后台并给出站点地图地址", async () => {
  const res = await request(app).get("/robots.txt");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/plain/);
  assert.match(res.text, /User-agent: \*/);
  assert.match(res.text, /Disallow: \/admin/);
  assert.match(res.text, /Disallow: \/search/);
  assert.match(res.text, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
});
