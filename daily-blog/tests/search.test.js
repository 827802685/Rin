import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./helpers/app.js";
import { createSearchFixtures, setFixtureStatus } from "./helpers/search-fixtures.js";

createSearchFixtures();

/** 用例里反复拼查询串，集中一处避免编码遗漏（中文与 `%` 都必须转义）。 */
function searchUrl(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      search.set(key, String(value));
    }
  }
  return `/search?${search.toString()}`;
}

test("站点头部提供搜索入口，未输入关键词时提示先输入", async () => {
  const res = await request(app).get("/search");

  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/search"/);
  assert.match(res.text, /输入关键词开始搜索/);
  assert.doesNotMatch(res.text, /共命中/);
});

test("搜索命中标题、摘要与正文，并把关键词高亮", async () => {
  const res = await request(app).get(searchUrl({ q: "分页测试" }));

  assert.equal(res.status, 200);
  assert.match(res.text, /共命中 3 篇已发布文章/);
  assert.match(res.text, /<mark>分页测试<\/mark>/);
  assert.match(res.text, /标题命中/);
});

test("相关度排序：标题命中优先于摘要命中，仅正文命中排在最后", async () => {
  const first = await request(app).get(searchUrl({ q: "分页测试" }));

  // SITE_PAGE_SIZE=2：第一页应是「标题命中」与「摘要命中」，且标题命中在前
  assert.ok(
    first.text.indexOf("标题命中") < first.text.indexOf("摘要才有词"),
    "标题命中的文章应排在摘要命中之前",
  );
  assert.doesNotMatch(first.text, /只在正文里/, "仅正文命中的文章应翻到第二页");

  const second = await request(app).get(searchUrl({ q: "分页测试", page: 2 }));
  assert.equal(second.status, 200);
  assert.match(second.text, /只在正文里/);
  assert.match(second.text, /第 2 \/ 2 页/);
});

test("翻页链接带上关键词，越界页码回落到最后一页", async () => {
  const first = await request(app).get(searchUrl({ q: "分页测试" }));
  assert.match(first.text, /page=2/, "下一页链接应保留关键词");
  assert.doesNotMatch(first.text, /page=3/, "最后一页不应有下一页链接");

  const overflow = await request(app).get(searchUrl({ q: "分页测试", page: 99 }));
  assert.equal(overflow.status, 200);
  assert.match(overflow.text, /第 2 \/ 2 页/);
});

test("多个关键词之间是「且」的关系", async () => {
  const res = await request(app).get(searchUrl({ q: "分页测试 独占词乙" }));

  assert.equal(res.status, 200);
  assert.match(res.text, /共命中 1 篇已发布文章/);
  assert.match(res.text, /标题命中/);
  assert.doesNotMatch(res.text, /摘要才有词/, "只命中一个关键词的文章不应出现");
});

test("草稿不出现在搜索结果里，转为草稿后立即搜不到", async () => {
  const drafts = await request(app).get(searchUrl({ q: "分页测试" }));
  assert.doesNotMatch(drafts.text, /草稿不该出现/);

  const before = await request(app).get(searchUrl({ q: "临时下架测试" }));
  assert.match(before.text, /共命中 1 篇已发布文章/);

  setFixtureStatus("search-fixture-retract", "draft");
  try {
    const after = await request(app).get(searchUrl({ q: "临时下架测试" }));
    assert.match(after.text, /没有找到与「临时下架测试」相关的文章/);
  } finally {
    // 恢复发布状态，避免影响后续用例
    setFixtureStatus("search-fixture-retract", "published");
  }
});

test("空结果给出提示与可点的浏览入口", async () => {
  const res = await request(app).get(searchUrl({ q: "不存在的关键词zzz" }));

  assert.equal(res.status, 200);
  assert.match(res.text, /没有找到与「不存在的关键词zzz」相关的文章/);
  assert.match(res.text, /href="\/categories"/);
  assert.match(res.text, /href="\/tags"/);
});

test("搜索结果可叠加分类与标签筛选，并可一键清除", async () => {
  const byCategory = await request(app).get(
    searchUrl({ q: "分页测试", category: "daily-iteration" }),
  );
  assert.equal(byCategory.status, 200);
  assert.match(byCategory.text, /共命中 1 篇已发布文章/);
  assert.match(byCategory.text, /标题命中/);
  assert.match(byCategory.text, /清除筛选/);

  const byTag = await request(app).get(searchUrl({ q: "分页测试", tag: "architecture" }));
  assert.equal(byTag.status, 200);
  assert.match(byTag.text, /共命中 1 篇已发布文章/);

  const noMatch = await request(app).get(
    searchUrl({ q: "分页测试", category: "engineering" }),
  );
  assert.equal(noMatch.status, 200);
  assert.match(noMatch.text, /没有找到/);
});

test("筛选条件不存在时返回 404 而不是空列表", async () => {
  const category = await request(app).get(searchUrl({ q: "测试", category: "no-such-category" }));
  assert.equal(category.status, 404);
  assert.match(category.text, /分类不存在/);

  const tag = await request(app).get(searchUrl({ q: "测试", tag: "no-such-tag" }));
  assert.equal(tag.status, 404);
  assert.match(tag.text, /标签不存在/);
});

test("关键词超过长度上限返回 400，非法页码静默回落到第一页", async () => {
  const tooLong = await request(app).get(searchUrl({ q: "长".repeat(65) }));
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.text, /搜索关键词最长 64 个字符/);

  const badPage = await request(app).get(searchUrl({ q: "分页测试", page: "abc" }));
  assert.equal(badPage.status, 200);
  assert.match(badPage.text, /第 1 \/ 2 页/);
});

test("LIKE 通配符按字面量处理，不会当成模糊匹配", async () => {
  const percent = await request(app).get(searchUrl({ q: "100%" }));
  assert.equal(percent.status, 200);
  assert.match(percent.text, /共命中 1 篇已发布文章/);
  assert.match(percent.text, /进度 <mark>100%<\/mark> 完成/);

  const underscore = await request(app).get(searchUrl({ q: "100_" }));
  assert.equal(underscore.status, 200);
  assert.match(underscore.text, /没有找到/, "`_` 不应匹配任意单个字符");
});

test("搜索结果中的标题与片段经过 HTML 转义", async () => {
  const res = await request(app).get(searchUrl({ q: "脚本注入" }));

  assert.equal(res.status, 200);
  assert.match(res.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
});

test("搜索结果的正文片段截取自正文，并带上高亮", async () => {
  const res = await request(app).get(searchUrl({ q: "独占词乙" }));

  assert.equal(res.status, 200);
  assert.match(res.text, /共命中 1 篇已发布文章/);
  assert.match(res.text, /<mark>独占词乙<\/mark>/);
  assert.match(res.text, /正文里带/, "摘要未命中时应展示正文片段");
});
