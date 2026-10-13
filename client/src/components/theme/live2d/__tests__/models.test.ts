import { describe, expect, it } from "vitest";

import { BUILTIN_MODELS, resolveDefaultName } from "../models";

describe("resolveDefaultName", () => {
  it("keeps an explicitly configured builtin id", () => {
    expect(resolveDefaultName("furina")).toBe("furina");
    expect(resolveDefaultName("BCSZ1.1")).toBe("BCSZ1.1");
  });

  // 兜底必须是可随站打包的轻模型：furina 的 moc3 约 95MB 且只在远端 CDN，
  // 拿它兜底会让未配置的访客直接拖 95MB 并把整页压到约 12 帧。
  it("falls back to the bundled light model for blank or unknown values", () => {
    expect(resolveDefaultName(undefined)).toBe("BCSZ1.1");
    expect(resolveDefaultName("")).toBe("BCSZ1.1");
    expect(resolveDefaultName("   ")).toBe("BCSZ1.1");
    expect(resolveDefaultName("no-such-model")).toBe("BCSZ1.1");
    expect(resolveDefaultName(null)).toBe("BCSZ1.1");
  });

  it("accepts a custom model id only when it is in the custom list", () => {
    const custom = [{ id: "custom-abc", name: "ABC", url: "https://cdn/x/index.json" }];
    expect(resolveDefaultName("custom-abc", custom)).toBe("custom-abc");
    expect(resolveDefaultName("custom-abc")).toBe("BCSZ1.1");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(resolveDefaultName("  furina  ")).toBe("furina");
  });

  it("lists the light model as a builtin so the fallback id is real", () => {
    expect(BUILTIN_MODELS).toContain("BCSZ1.1");
  });
});
