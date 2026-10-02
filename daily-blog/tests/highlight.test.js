import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMatchExcerpt,
  escapeHtml,
  findFirstMatchIndex,
  hasMatch,
  highlightMatches,
  splitSearchTerms,
} from "../src/lib/highlight.js";
import { buildContainsPattern, escapeLikePattern } from "../src/lib/like.js";

test("escapeHtml 转义 HTML 特殊字符", () => {
  assert.equal(
    escapeHtml(`<a href="x">a&b'c</a>`),
    "&lt;a href=&quot;x&quot;&gt;a&amp;b&#39;c&lt;/a&gt;",
  );
});

test("splitSearchTerms 按空白拆分、去空项并忽略大小写去重", () => {
  assert.deepEqual(splitSearchTerms("  博客   日志 "), ["博客", "日志"]);
  assert.deepEqual(splitSearchTerms("Blog blog BLOG"), ["Blog"]);
  assert.deepEqual(splitSearchTerms(""), []);
  assert.deepEqual(splitSearchTerms(undefined), []);
});

test("highlightMatches 高亮命中片段，并转义非命中片段", () => {
  assert.equal(highlightMatches("第一天与第二天", ["第二"]), "第一天与<mark>第二</mark>天");
  assert.equal(highlightMatches("<b>加粗</b>", ["加粗"]), "&lt;b&gt;<mark>加粗</mark>&lt;/b&gt;");
  assert.equal(highlightMatches("没有命中", ["xyz"]), "没有命中");
  assert.equal(highlightMatches(null, ["xyz"]), "");
});

test("highlightMatches 把正则元字符当字面量处理", () => {
  assert.equal(highlightMatches("a.b*c", ["."]), "a<mark>.</mark>b*c");
  assert.equal(highlightMatches("1+1=2", ["1+1"]), "<mark>1+1</mark>=2");
});

test("highlightMatches 长词优先，避免高亮被短词切碎", () => {
  assert.equal(highlightMatches("每日迭代", ["迭代", "每日迭代"]), "<mark>每日迭代</mark>");
});

test("findFirstMatchIndex / hasMatch 提供命中位置判断", () => {
  assert.equal(findFirstMatchIndex("前面有词后面", ["有词"]), 2);
  assert.equal(findFirstMatchIndex("没有命中", ["xyz"]), -1);
  assert.equal(findFirstMatchIndex("任意文本", []), -1);
  assert.equal(hasMatch("每日迭代", ["迭代"]), true);
  assert.equal(hasMatch("每日迭代", ["搜索"]), false);
});

test("buildMatchExcerpt 以命中位置为中心截取并加省略号", () => {
  const text = `${"填".repeat(200)}关键词${"充".repeat(200)}`;
  const html = buildMatchExcerpt({ text, terms: ["关键词"], maxLength: 60 });

  assert.match(html, /^…/);
  assert.match(html, /<mark>关键词<\/mark>/);
  assert.match(html, /…$/);
  assert.ok(html.length < 200, "片段应明显短于原文");
});

test("buildMatchExcerpt 处理短文本与空文本", () => {
  assert.equal(buildMatchExcerpt({ text: "短文本", terms: ["短"] }), "<mark>短</mark>文本");
  assert.equal(buildMatchExcerpt({ text: "", terms: ["a"] }), "");
  assert.equal(buildMatchExcerpt({ text: null, terms: ["a"] }), "");
  assert.equal(
    buildMatchExcerpt({ text: "没有命中", terms: ["xyz"] }),
    "没有命中",
    "未命中时退化为开头截断，不报错",
  );
});

test("escapeLikePattern 转义 LIKE 通配符与转义字符本身", () => {
  assert.equal(escapeLikePattern("100%"), "100\\%");
  assert.equal(escapeLikePattern("a_b"), "a\\_b");
  assert.equal(escapeLikePattern("a\\b"), "a\\\\b");
  assert.equal(escapeLikePattern("普通关键词"), "普通关键词");
  assert.equal(buildContainsPattern("x"), "%x%");
});
