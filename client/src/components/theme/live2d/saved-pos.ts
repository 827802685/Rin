// 看板娘拖动位置的持久化与限位。
//
// 纯逻辑模块：只依赖 localStorage（jsdom 可测），无 React 依赖，
// 行为与 live2d-widget.tsx 拆分前的内联逻辑等价：
//   - loadSavedPos：读取失败/结构非法一律回退 null（组件回到默认 bottom 锚点）；
//   - saveSavedPos：与拆分前一致，不做 try/catch（写失败直接抛出，由调用方指针处理）；
//   - clampDragPosition：限位规则为"不小于 0，且不超过视口右下 20px 边距"。

// 拖动位置持久化 key
const POS_KEY = "rin.live2d.pos";

// 记忆的拖动偏移 {left, top}：均为像素
export type SavedPos = { left: number; top: number } | null;

export function loadSavedPos(): SavedPos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { left: number; top: number };
    if (typeof parsed.left === "number" && typeof parsed.top === "number") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveSavedPos(left: number, top: number): void {
  localStorage.setItem(POS_KEY, JSON.stringify({ left, top }));
}

// 拖拽落点限位：左上不超过 0，右下各留 20px 边距不超出视口。
export function clampDragPosition(
  left: number,
  top: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  return {
    left: Math.min(Math.max(left, 0), viewportWidth - 20),
    top: Math.min(Math.max(top, 0), viewportHeight - 20),
  };
}
