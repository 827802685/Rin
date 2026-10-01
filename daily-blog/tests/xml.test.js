import test from "node:test";
import assert from "node:assert/strict";
import { escapeXml, parseSqliteDate, toIso8601, toRfc822 } from "../src/lib/xml.js";

test("escapeXml 转义 XML 的五个特殊字符", () => {
  assert.equal(
    escapeXml(`a & b < c > d " e ' f`),
    "a &amp; b &lt; c &gt; d &quot; e &apos; f",
  );
  assert.equal(escapeXml(null), "");
  assert.equal(escapeXml(0), "0");
});

test("SQLite 时间按 UTC 解析，而不是本地时区", () => {
  const date = parseSqliteDate("2026-09-20 10:00:00");
  assert.equal(date.toISOString(), "2026-09-20T10:00:00.000Z");
  assert.equal(parseSqliteDate(""), null);
  assert.equal(parseSqliteDate("not-a-date"), null);
});

test("RSS 与 sitemap 使用各自要求的日期格式", () => {
  assert.equal(toRfc822("2026-09-20 10:00:00"), "Sun, 20 Sep 2026 10:00:00 GMT");
  assert.equal(toIso8601("2026-09-20 10:00:00"), "2026-09-20T10:00:00.000Z");
});

test("时间缺失时回落到当前时间而不是抛错", () => {
  assert.match(toRfc822(null), /GMT$/);
  assert.match(toIso8601("bad"), /^\d{4}-\d{2}-\d{2}T/);
});
