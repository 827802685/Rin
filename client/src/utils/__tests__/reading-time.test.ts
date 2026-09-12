import { describe, expect, it } from "vitest";
import { estimateReading } from "../reading-time";

describe("estimateReading", () => {
  it("returns a one minute estimate for empty content", () => {
    expect(estimateReading("")).toEqual({ words: 0, minutes: 1, short: true });
  });

  it("counts latin words", () => {
    const stats = estimateReading("hello world this is a test");
    expect(stats.words).toBe(6);
  });

  it("counts CJK characters individually", () => {
    const stats = estimateReading("你好世界");
    expect(stats.words).toBe(4);
  });

  it("counts mixed CJK and latin content", () => {
    const stats = estimateReading("使用 Cloudflare Workers 部署");
    // 4 CJK chars (使用部署) + 2 latin words
    expect(stats.words).toBe(6);
  });

  it("excludes fenced code blocks", () => {
    const withCode = estimateReading("正文\n```js\nconst aVeryLongVariableName = 1;\n```\n结束");
    expect(withCode.words).toBe(4);
  });

  it("ignores markdown image syntax but keeps link text", () => {
    const stats = estimateReading("![alt](https://example.com/a.png) [link text](https://example.com)");
    expect(stats.words).toBe(2);
  });

  it("strips html tags", () => {
    const stats = estimateReading("<p>hello</p> <strong>world</strong>");
    expect(stats.words).toBe(2);
  });

  it("never reports less than one minute for non-empty content", () => {
    expect(estimateReading("word").minutes).toBe(1);
  });

  it("scales the estimate with length", () => {
    const long = "word ".repeat(3500);
    expect(estimateReading(long).minutes).toBe(10);
  });
});
