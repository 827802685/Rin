import { useContext } from "react";
import { ClientConfigContext } from "../../state/config";
import { CURSOR_STATES, resolveCursorCss, type CursorState } from "./cursor-registry";

// 各状态命中的选择器；新增语义类（.cursor-move 等）供组件手动声明
const STATE_SELECTORS: Record<CursorState, string> = {
  default: "html, body, *, *::before, *::after",
  pointer:
    'a, button, [role="button"], select, summary, label, input[type="button"], input[type="submit"], input[type="reset"], .link-line a, .cursor-pointer',
  text: 'input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="number"], input[type="password"], textarea, [contenteditable="true"], .cursor-text',
  move: 'input[type="range"], .cursor-move',
  wait: "button:disabled, input:disabled, select:disabled, textarea:disabled, [aria-busy=\"true\"]",
  help: "[title], abbr, .cursor-help",
};

export function buildCursorCss(
  schemeId: unknown,
  overrides: Partial<Record<CursorState, string>>,
): string {
  return CURSOR_STATES.map((state) => {
    const value = resolveCursorCss(schemeId, state, overrides[state]);
    return `    ${STATE_SELECTORS[state]} {\n      cursor: ${value} !important;\n    }`;
  }).join("\n");
}

export function CursorStyle() {
  const config = useContext(ClientConfigContext);
  const enabled = config.getBoolean("widget.cursor.enabled");
  if (!enabled) {
    return null;
  }

  const schemeId = String(config.get("widget.cursor.scheme") ?? "furina");
  // 旧三键继续作为逐态覆盖：留空表示跟随所选方案
  const overrides: Partial<Record<CursorState, string>> = {
    default: String(config.get("widget.cursor.default") ?? ""),
    pointer: String(config.get("widget.cursor.pointer") ?? ""),
    text: String(config.get("widget.cursor.text") ?? ""),
  };

  return <style>{`\n${buildCursorCss(schemeId, overrides)}\n`}</style>;
}
