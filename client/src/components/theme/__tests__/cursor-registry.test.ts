import { describe, expect, it } from "vitest";
import {
  CURSOR_SCHEMES,
  CURSOR_SCHEME_IDS,
  CURSOR_STATES,
  getCursorScheme,
  resolveCursorCss,
} from "../cursor-registry";

describe("cursor registry", () => {
  it("ships furina, dot and minimal schemes", () => {
    expect(CURSOR_SCHEME_IDS).toEqual(expect.arrayContaining(["furina", "dot", "minimal"]));
  });

  it("furina maps every state onto an existing png path", () => {
    for (const state of CURSOR_STATES) {
      expect(CURSOR_SCHEMES.furina.states[state]).toMatch(/^\/cursors\/furina\/.+\.png$/);
    }
  });

  it("dot states are inline svg data uris (zero image assets)", () => {
    for (const state of CURSOR_STATES) {
      expect(CURSOR_SCHEMES.dot.states[state]?.startsWith("data:image/svg+xml,")).toBe(true);
    }
  });

  it("unknown scheme ids fall back to furina instead of throwing", () => {
    expect(getCursorScheme("no-such-scheme")).toBe(CURSOR_SCHEMES.furina);
    expect(getCursorScheme(undefined)).toBe(CURSOR_SCHEMES.furina);
  });
});

describe("resolveCursorCss", () => {
  it("emits url + hotspot + keyword fallback", () => {
    expect(resolveCursorCss("furina", "pointer")).toBe(
      'url("/cursors/furina/link.png") 2 2, pointer',
    );
    expect(resolveCursorCss("furina", "default")).toBe(
      'url("/cursors/furina/normal.png") 2 2, auto',
    );
  });

  it("minimal scheme resolves to plain keywords", () => {
    expect(resolveCursorCss("minimal", "pointer")).toBe("pointer");
    expect(resolveCursorCss("minimal", "default")).toBe("auto");
  });

  it("missing states reuse the scheme default image", () => {
    CURSOR_SCHEMES["partial-test"] = {
      id: "partial-test",
      hotspot: "1 1",
      states: { default: "/x/normal.png" },
    };
    try {
      expect(resolveCursorCss("partial-test", "help")).toBe('url("/x/normal.png") 1 1, help');
    } finally {
      delete CURSOR_SCHEMES["partial-test"];
    }
  });

  it("per-state overrides win over the scheme, unless blank", () => {
    expect(resolveCursorCss("dot", "text", "/custom/t.png")).toBe(
      'url("/custom/t.png") 8 8, text',
    );
    // 空串与纯空白都视为「未覆盖」，跟随方案图案
    expect(resolveCursorCss("dot", "text", "").startsWith('url("data:image/svg+xml')).toBe(true);
    expect(resolveCursorCss("dot", "text", "   ").startsWith('url("data:image/svg+xml')).toBe(true);
  });
});
