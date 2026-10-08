import { describe, expect, it } from "vitest";
import { formatProgressMb, progressPercent } from "../progress-format";

// 用例取自拆分前 live2d-widget.tsx 的真实进度值：
// furina 总量 103740290 字节、BCSZ1.1 总量 22639505 字节（EXPECTED_TOTAL_BY_NAME）。

describe("progressPercent", () => {
  it("returns null before the first progress tick", () => {
    expect(progressPercent(null)).toBeNull();
  });

  it("returns null when the total size is unknown (custom models, total=0)", () => {
    expect(progressPercent({ loaded: 12345678, total: 0 })).toBeNull();
  });

  it("computes a rounded percentage for builtin models", () => {
    expect(progressPercent({ loaded: 0, total: 103740290 })).toBe(0);
    expect(progressPercent({ loaded: 51870145, total: 103740290 })).toBe(50);
    expect(progressPercent({ loaded: 103740290, total: 103740290 })).toBe(100);
    expect(progressPercent({ loaded: 11319752, total: 22639505 })).toBe(50);
  });

  it("never exceeds 100 even if bytes are over-counted", () => {
    expect(progressPercent({ loaded: 220000000, total: 103740290 })).toBe(100);
  });

  it("rounds tiny fractions down to 0 like the old inline expression", () => {
    expect(progressPercent({ loaded: 1, total: 103740290 })).toBe(0);
  });
});

describe("formatProgressMb", () => {
  it("shows loaded / total with one decimal when total is known", () => {
    expect(formatProgressMb({ loaded: 1048576, total: 1048576 })).toBe("1.0 / 1.0 MB");
    expect(formatProgressMb({ loaded: 0, total: 22639505 })).toBe("0.0 / 21.6 MB");
    expect(formatProgressMb({ loaded: 103740290, total: 103740290 })).toBe("98.9 / 98.9 MB");
  });

  it("shows only the loaded amount when total is unknown", () => {
    expect(formatProgressMb({ loaded: 5242880, total: 0 })).toBe("5.0 MB");
    expect(formatProgressMb({ loaded: 0, total: 0 })).toBe("0.0 MB");
  });
});
