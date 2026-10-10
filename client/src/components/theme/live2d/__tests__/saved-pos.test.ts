import { beforeEach, describe, expect, it } from "vitest";
import { clampDragPosition, loadSavedPos, saveSavedPos } from "../saved-pos";

// jsdom 环境已提供 localStorage；用例覆盖拆分前 widget 的读取/写入/限位三处内联逻辑。
const POS_KEY = "rin.live2d.pos";

describe("loadSavedPos", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing was saved yet (falls back to bottom anchor)", () => {
    expect(loadSavedPos()).toBeNull();
  });

  it("reads a saved {left, top} pair in pixels", () => {
    localStorage.setItem(POS_KEY, JSON.stringify({ left: 120, top: 40 }));
    expect(loadSavedPos()).toEqual({ left: 120, top: 40 });
  });

  it("ignores corrupt storage values instead of throwing", () => {
    localStorage.setItem(POS_KEY, "not-json");
    expect(loadSavedPos()).toBeNull();
    localStorage.setItem(POS_KEY, JSON.stringify({ left: "x", top: 1 }));
    expect(loadSavedPos()).toBeNull();
    localStorage.setItem(POS_KEY, JSON.stringify({ left: 1 }));
    expect(loadSavedPos()).toBeNull();
  });
});

describe("saveSavedPos", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips through loadSavedPos with the same JSON shape as before", () => {
    saveSavedPos(10, 20);
    expect(localStorage.getItem(POS_KEY)).toBe('{"left":10,"top":20}');
    expect(loadSavedPos()).toEqual({ left: 10, top: 20 });
  });
});

describe("clampDragPosition", () => {
  it("keeps in-viewport positions unchanged", () => {
    expect(clampDragPosition(500, 300, 1280, 720)).toEqual({ left: 500, top: 300 });
  });

  it("never lets the widget go above/left of the viewport origin", () => {
    expect(clampDragPosition(-30, -10, 1280, 720)).toEqual({ left: 0, top: 0 });
  });

  it("keeps a 20px margin at the right/bottom edge", () => {
    expect(clampDragPosition(1300, 800, 1280, 720)).toEqual({ left: 1260, top: 700 });
    expect(clampDragPosition(1260, 700, 1280, 720)).toEqual({ left: 1260, top: 700 });
  });
});
