import { describe, expect, it } from "vitest";
import {
  isEdgeRestEnabled,
  normalizeScale,
  parseLayoutConfig,
  widgetBoxSize,
} from "../widget-config";

// 用例均取自拆分前 live2d-widget.tsx 内联逻辑的真实输入/输出，断言行为等价。

describe("normalizeScale", () => {
  it("defaults to 1 when the config value is missing or invalid", () => {
    expect(normalizeScale(undefined)).toBe(1);
    expect(normalizeScale(null)).toBe(1);
    expect(normalizeScale("abc")).toBe(1);
    expect(normalizeScale(NaN)).toBe(1);
  });

  it("passes through in-range numeric values (incl. numeric strings)", () => {
    expect(normalizeScale(1)).toBe(1);
    expect(normalizeScale("0.5")).toBe(0.5);
    expect(normalizeScale(1.8)).toBe(1.8);
  });

  it("clamps runaway values into the safe [0.1, 2] range", () => {
    expect(normalizeScale(3)).toBe(2);
    expect(normalizeScale(0.01)).toBe(0.1);
    expect(normalizeScale(-5)).toBe(0.1);
    expect(normalizeScale(0)).toBe(0.1);
  });

  it("treats non-finite numbers as invalid (falls back to 1, like the old logic)", () => {
    expect(normalizeScale(Infinity)).toBe(1);
  });
});

describe("isEdgeRestEnabled", () => {
  it("enables only on the literal \"true\" flag, ignoring case and whitespace", () => {
    expect(isEdgeRestEnabled("true")).toBe(true);
    expect(isEdgeRestEnabled(" TRUE ")).toBe(true);
    expect(isEdgeRestEnabled("True")).toBe(true);
  });

  it("disables for anything else, including missing config", () => {
    expect(isEdgeRestEnabled("false")).toBe(false);
    expect(isEdgeRestEnabled("")).toBe(false);
    expect(isEdgeRestEnabled(undefined)).toBe(false);
    expect(isEdgeRestEnabled(null)).toBe(false);
    expect(isEdgeRestEnabled("1")).toBe(false);
  });
});

describe("parseLayoutConfig", () => {
  it("parses numeric layout keys from a JSON string", () => {
    expect(parseLayoutConfig('{"Center Y": 0.05}')).toEqual({ "Center Y": 0.05 });
    expect(parseLayoutConfig('{"X": 1, "Y": -0.5}')).toEqual({ X: 1, Y: -0.5 });
  });

  it("keeps only finite number values and drops the rest", () => {
    expect(parseLayoutConfig('{"a": 1, "b": "x", "c": null, "d": true}')).toEqual({ a: 1 });
    expect(parseLayoutConfig('{"a": NaN}')).toBeNull();
  });

  it("returns null for empty input, empty object or invalid JSON", () => {
    expect(parseLayoutConfig("")).toBeNull();
    expect(parseLayoutConfig("{}")).toBeNull();
    expect(parseLayoutConfig("not-json")).toBeNull();
  });

  it("treats a JSON array as index→number entries (same as the old inline logic)", () => {
    expect(parseLayoutConfig("[1,2]")).toEqual({ "0": 1, "1": 2 });
  });
});

describe("widgetBoxSize", () => {
  it("uses the plugin canvas baseline 300x300 at scale 1", () => {
    expect(widgetBoxSize(1)).toEqual({ width: 300, height: 300 });
  });

  it("scales and rounds to integer pixels", () => {
    expect(widgetBoxSize(1.5)).toEqual({ width: 450, height: 450 });
    expect(widgetBoxSize(0.8)).toEqual({ width: 240, height: 240 });
    expect(widgetBoxSize(1.25)).toEqual({ width: 375, height: 375 });
    expect(widgetBoxSize(0.1)).toEqual({ width: 30, height: 30 });
  });
});
