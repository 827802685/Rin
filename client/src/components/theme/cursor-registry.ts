/**
 * 鼠标指针注册表：把「光标状态 → 指针图案」的映射收敛到一处。
 * - furina：复用 client/public/cursors/furina/ 已有的 PNG 资源
 * - dot / minimal：零资源内置方案（内联 SVG data-URI / 纯 CSS 关键字）
 * 缺失的状态一律回落到该方案的 default，不会出现「鼠标消失」。
 */

export const CURSOR_STATES = ["default", "pointer", "text", "move", "wait", "help"] as const;

export type CursorState = (typeof CURSOR_STATES)[number];

export interface CursorScheme {
  id: string;
  /** 每个状态对应的图案；undefined 表示回落到 default，空字符串表示用系统原生光标 */
  states: Partial<Record<CursorState, string>>;
  /** 热点（CSS cursor 的 x y） */
  hotspot: string;
}

const FURINA = "/cursors/furina";

// SVG data-URI 工具：16x16，热点在中心
const svg = (body: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'>${body}</svg>`,
  )}`;

const DOT = svg("<circle cx='8' cy='8' r='4.5' fill='white' stroke='#333' stroke-width='1.5'/>");
const DOT_POINTER = svg("<circle cx='8' cy='8' r='5.5' fill='#333' stroke='white' stroke-width='1.5'/>");
const DOT_TEXT = svg("<path d='M6 2h4M8 2v12M6 14h4' stroke='#333' stroke-width='1.6' fill='none'/>");
const DOT_MOVE = svg("<path d='M8 1v14M1 8h14M8 1 5.5 3.5M8 1l2.5 2.5M8 15 5.5 12.5M8 15l2.5-2.5M1 8l2.5-2.5M1 8l2.5 2.5M15 8l-2.5-2.5M15 8l-2.5 2.5' stroke='#333' stroke-width='1.3' fill='none'/>");
const DOT_WAIT = svg("<path d='M4 2h8L8 8l4 6H4l4-6z' fill='none' stroke='#333' stroke-width='1.5'/>");
const DOT_HELP = svg("<circle cx='8' cy='8' r='6.5' fill='none' stroke='#333' stroke-width='1.5'/><path d='M6 6a2 2 0 1 1 2.6 2.1c-.5.2-.6.6-.6 1.1M8 12v.6' stroke='#333' stroke-width='1.5' fill='none'/>");

export const CURSOR_SCHEMES: Record<string, CursorScheme> = {
  furina: {
    id: "furina",
    hotspot: "2 2",
    states: {
      default: `${FURINA}/normal.png`,
      pointer: `${FURINA}/link.png`,
      text: `${FURINA}/text.png`,
      move: `${FURINA}/move.png`,
      wait: `${FURINA}/busy.png`,
      help: `${FURINA}/help.png`,
    },
  },
  dot: {
    id: "dot",
    hotspot: "8 8",
    states: {
      default: DOT,
      pointer: DOT_POINTER,
      text: DOT_TEXT,
      move: DOT_MOVE,
      wait: DOT_WAIT,
      help: DOT_HELP,
    },
  },
  // minimal：不加载任何图案，只把光标语义统一成系统关键字
  minimal: {
    id: "minimal",
    hotspot: "0 0",
    states: {},
  },
};

export const CURSOR_SCHEME_IDS = Object.keys(CURSOR_SCHEMES);

export function getCursorScheme(id: unknown): CursorScheme {
  return CURSOR_SCHEMES[typeof id === "string" ? id : ""] ?? CURSOR_SCHEMES.furina;
}

/** 每个状态在 url() 加载失败或图案缺失时的 CSS 关键字兜底 */
export const CURSOR_FALLBACK_KEYWORD: Record<CursorState, string> = {
  default: "auto",
  pointer: "pointer",
  text: "text",
  move: "move",
  wait: "progress",
  help: "help",
};

/**
 * 解析某状态最终的 CSS cursor 值。
 * override：设置页的逐态覆盖（旧三键），非空 URL 时优先于方案图案。
 */
export function resolveCursorCss(
  schemeId: unknown,
  state: CursorState,
  override?: string | null,
): string {
  const scheme = getCursorScheme(schemeId);
  const keyword = CURSOR_FALLBACK_KEYWORD[state];
  const source =
    (override && override.trim() ? override.trim() : undefined) ??
    scheme.states[state] ??
    scheme.states.default;

  if (!source) {
    // minimal 方案或完全无图案：用原生关键字
    return keyword;
  }
  return `url("${source}") ${scheme.hotspot}, ${keyword}`;
}

/** 设置页三张逐态覆盖选择卡仍按 furina 资源列表展示；这里给出默认展示值 */
export const LEGACY_CURSOR_OVERRIDE_KEYS: Partial<Record<CursorState, string>> = {
  default: "widget.cursor.default",
  pointer: "widget.cursor.pointer",
  text: "widget.cursor.text",
};
