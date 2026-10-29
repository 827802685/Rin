/**
 * 把正文里的双向链接语法 [[Target]] / [[Target|Alias]] 转换为可点击的 Markdown 链接。
 *
 * 设计取舍：
 * - 目标解析（按 title/alias/slug）由服务端负责，客户端没有全局解析索引，
 *   因此链接到搜索页 /search/<标题>，保证可导航、可被发现。
 * - 跳过围栏代码块（``` 与 ~~~）内部，避免破坏源码（公式/图表块等）。
 */

const FENCE = /^\s*(```|~~~)/;

/** 单行内的 [[...]] 替换 */
function replaceInLine(line: string): string {
  return line.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_m, target: string, alias?: string) => {
      const t = target.trim();
      if (!t) return _m;
      const label = (alias ?? target).trim();
      const href = `/search/${encodeURIComponent(t)}`;
      return `[${label}](${href})`;
    },
  );
}

export function transformWikilinks(markdown: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split("\n");
  let inFence = false;
  let fenceMarker = "";
  for (let i = 0; i < lines.length; i++) {
    const fence = FENCE.exec(lines[i]);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;
    lines[i] = replaceInLine(lines[i]);
  }
  return lines.join("\n");
}
