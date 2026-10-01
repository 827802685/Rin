import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./helpers/app.js";
import { createArchiveFixtures, ARCHIVE_DRAFT_TITLE } from "./helpers/archive-fixtures.js";

createArchiveFixtures();

/** 示例文章 3 篇（今天附近）+ 固定数据 3 篇已发布 = 6 篇。 */
const TOTAL_PUBLISHED = 6;

test("归档页按年份倒序列出全部已发布文章", async () => {
  const res = await request(app).get("/archive");
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`共 ${TOTAL_PUBLISHED} 篇已发布文章`));
  assert.match(res.text, /href="\/archive\/2026"/);
  assert.match(res.text, /href="\/archive\/2025"/);
  assert.match(res.text, /href="\/archive\/2024"/);
  // 年份倒序：2026 必须排在 2025 之前，否则说明排序反了。
  assert.ok(
    res.text.indexOf(">2026 年<") < res.text.indexOf(">2025 年<"),
    "年份应当按倒序排列",
  );
});

test("归档页按月分组并展示发布日期", async () => {
  const res = await request(app).get("/archive");
  assert.match(res.text, /10 月/);
  assert.match(res.text, /9 月/);
  assert.match(res.text, /1 月/);
  assert.match(res.text, /2026-01-08/);
  assert.match(res.text, /href="\/posts\/archive-fixture-2026-jan"/);
});

test("草稿不出现在归档里", async () => {
  const res = await request(app).get("/archive");
  assert.doesNotMatch(res.text, new RegExp(ARCHIVE_DRAFT_TITLE));
  assert.doesNotMatch(res.text, /archive-fixture-draft/);
});

test("单年归档页只列出那一年的文章", async () => {
  const res = await request(app).get("/archive/2026");
  assert.equal(res.status, 200);
  assert.match(res.text, /2026 年归档/);
  assert.match(res.text, /共 4 篇已发布文章/);
  assert.match(res.text, /2026 年 1 月写下的文章/);
  assert.match(res.text, /第一天：搭起能跑起来的最小博客/);
  assert.doesNotMatch(res.text, /2025 年写下的文章/);
  assert.doesNotMatch(res.text, /2024 年写下的旧文章/);
  assert.match(res.text, /href="\/archive"/, "单年页要能返回全部归档");
});

test("只有一篇的年份也能正常访问", async () => {
  const res = await request(app).get("/archive/2024");
  assert.equal(res.status, 200);
  assert.match(res.text, /共 1 篇已发布文章/);
  assert.match(res.text, /2024 年写下的旧文章/);
});

test("没有文章的年份返回 404，非法年份返回 400", async () => {
  const missing = await request(app).get("/archive/1999");
  assert.equal(missing.status, 404);
  assert.match(missing.text, /1999 年没有已发布的文章/);

  const invalid = await request(app).get("/archive/not-a-year");
  assert.equal(invalid.status, 400);
  assert.match(invalid.text, /年份必须是 4 位数字/);

  const outOfRange = await request(app).get("/archive/0001");
  assert.equal(outOfRange.status, 400);
});

test("站点头部与页脚提供归档入口", async () => {
  const res = await request(app).get("/");
  assert.match(res.text, /href="\/archive"/);
});
