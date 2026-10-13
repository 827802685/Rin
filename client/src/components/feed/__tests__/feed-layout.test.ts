import { describe, expect, it } from "vitest";
import { getCardVariantForLayout, getFeedListClass } from "../feed-layout";

describe("getFeedListClass", () => {
  it("reproduces the exact class strings the three pages used before", () => {
    // 重构等价性锚点：这三串必须与旧三元判断逐字一致
    expect(getFeedListClass("masonry")).toBe("wauto columns-1 gap-5 md:columns-2");
    expect(getFeedListClass("list")).toBe("wauto flex flex-col");
    expect(getFeedListClass("magazine")).toBe("wauto grid grid-cols-1 gap-4 md:grid-cols-2");
  });

  it("falls back to the single column for unknown layouts", () => {
    expect(getFeedListClass("circular-mosaic")).toBe("wauto flex flex-col");
    expect(getFeedListClass("")).toBe("wauto flex flex-col");
  });

  it("appends an extra class when provided", () => {
    expect(getFeedListClass("masonry", "ani-show")).toBe(
      "wauto columns-1 gap-5 md:columns-2 ani-show",
    );
    expect(getFeedListClass("list")).toBe("wauto flex flex-col");
  });
});

describe("getCardVariantForLayout", () => {
  it("forces the cover card only for the magazine grid", () => {
    expect(getCardVariantForLayout("magazine")).toBe("cover");
    expect(getCardVariantForLayout("list")).toBeUndefined();
    expect(getCardVariantForLayout("masonry")).toBeUndefined();
    expect(getCardVariantForLayout("bogus")).toBeUndefined();
  });
});
