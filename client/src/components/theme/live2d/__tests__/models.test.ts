import { describe, expect, it } from "vitest";

import { BUILTIN_MODELS, EXPECTED_TOTAL_BY_NAME, MODEL_FILES_BY_NAME, resolveDefaultName } from "../models";

describe("resolveDefaultName", () => {
  it("keeps an explicitly configured builtin id", () => {
    expect(resolveDefaultName("furina-mini")).toBe("furina-mini");
    expect(resolveDefaultName("BCSZ1.1")).toBe("BCSZ1.1");
  });

  // 兜底必须是轻模型：furina-mini 全套约 2.4MB（自研渲染器，无需 Cubism Core），
  // 未配置的访客也能秒开；原 Cubism furina（95MB）已被它替换出内置列表。
  it("falls back to furina-mini for blank or unknown values", () => {
    expect(resolveDefaultName(undefined)).toBe("furina-mini");
    expect(resolveDefaultName("")).toBe("furina-mini");
    expect(resolveDefaultName("   ")).toBe("furina-mini");
    expect(resolveDefaultName("no-such-model")).toBe("furina-mini");
    expect(resolveDefaultName(null)).toBe("furina-mini");
  });

  it("accepts a custom model id only when it is in the custom list", () => {
    const custom = [{ id: "custom-abc", name: "ABC", url: "https://cdn/x/index.json" }];
    expect(resolveDefaultName("custom-abc", custom)).toBe("custom-abc");
    expect(resolveDefaultName("custom-abc")).toBe("furina-mini");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(resolveDefaultName("  furina-mini  ")).toBe("furina-mini");
  });

  it("lists the light models as builtins so the fallback id is real", () => {
    expect(BUILTIN_MODELS).toContain("furina-mini");
    expect(BUILTIN_MODELS).toContain("BCSZ1.1");
    // 原 95MB 的 Cubism furina 已被 2.4MB 的 furina-mini 替换，不再是内置项
    expect(BUILTIN_MODELS).not.toContain("furina");
  });

  it("carries a progress denominator for every builtin model", () => {
    for (const id of BUILTIN_MODELS) {
      expect(EXPECTED_TOTAL_BY_NAME[id]).toBeGreaterThan(0);
      expect(MODEL_FILES_BY_NAME[id]?.length).toBeGreaterThan(0);
    }
  });
});
