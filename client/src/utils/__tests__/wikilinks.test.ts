import { describe, expect, it } from "vitest";
import { transformWikilinks } from "../wikilinks";

describe("transformWikilinks", () => {
  it("returns empty input unchanged", () => {
    expect(transformWikilinks("")).toBe("");
    expect(transformWikilinks("   ")).toBe("   ");
  });

  it("converts a bare [[Target]] into a search link", () => {
    const out = transformWikilinks("see [[Project Notes]]");
    expect(out).toBe("see [Project Notes](/search/Project%20Notes)");
  });

  it("uses the alias as the label for [[Target|Alias]]", () => {
    const out = transformWikilinks("[[Project Notes|笔记]]");
    expect(out).toBe("[笔记](/search/Project%20Notes)");
  });

  it("trims surrounding whitespace of target and alias", () => {
    const out = transformWikilinks("[[  A B  |  B  ]]");
    expect(out).toBe("[B](/search/A%20B)");
  });

  it("leaves fenced code blocks untouched (regression: 不破坏公式/图表源码)", () => {
    const md = "before\n```\nconst x = [[NotALink]]\n```\nafter [[Real Link]]";
    const out = transformWikilinks(md);
    expect(out).toContain("const x = [[NotALink]]");
    expect(out).toContain("[Real Link](/search/Real%20Link)");
  });

  it("handles tilde fences too", () => {
    const md = "~~~\n[[NoLink]]\n~~~\n[[YesLink]]";
    const out = transformWikilinks(md);
    expect(out).toContain("[[NoLink]]");
    expect(out).toContain("[YesLink](/search/YesLink)");
  });

  it("supports multiple links on the same line", () => {
    const out = transformWikilinks("[[A]] and [[B]]");
    expect(out).toBe("[A](/search/A) and [B](/search/B)");
  });

  it("ignores empty targets", () => {
    const out = transformWikilinks("[[]] and [[]]");
    // 空目标不替换，保持原样（不会生成 /search/ 空路径）
    expect(out).toBe("[[]] and [[]]");
  });
});
