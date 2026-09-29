/**
 * 搜索关键词的高亮与片段提取。
 *
 * 关键点：**先按原文切分，再分别转义**。
 * 如果先把整段文本转义、再拿原始关键词去匹配，像 `a&b` 这样的关键词会因为
 * 文本里已经变成 `a&amp;b` 而匹配不到；反过来先匹配再转义，才能既命中正确，
 * 又不会把用户输入里的 `<script>` 当成 HTML 注入到页面里。
 */

const HTML_ESCAPES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

/** HTML 转义（搜索结果里的标题/摘要来自用户输入，必须转义后再拼接高亮标签）。 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** 正则元字符转义：关键词可能包含 `.` `*` `(` 等字符。 */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把关键词拆成多个检索词：按空白分隔、去空项、忽略大小写去重。
 * 「关键词搜索」需要支持多个词（如「博客 日志」），单靠整串匹配几乎搜不到东西。
 */
export function splitSearchTerms(query) {
  const seen = new Set();
  const terms = [];
  for (const part of String(query ?? "").split(/\s+/)) {
    const term = part.trim();
    if (!term) {
      continue;
    }
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

/** 构造匹配正则：长词优先，避免短词先把长词的一部分吃掉导致高亮碎片化。 */
function buildMatchRegex(terms) {
  const usable = terms.filter(Boolean).sort((a, b) => b.length - a.length);
  if (usable.length === 0) {
    return null;
  }
  return new RegExp(usable.map(escapeRegExp).join("|"), "gi");
}

/** 文本里第一次命中任一关键词的位置，未命中返回 -1。 */
export function findFirstMatchIndex(text, terms) {
  const regex = buildMatchRegex(terms);
  if (!regex) {
    return -1;
  }
  return String(text ?? "").search(regex);
}

/** 是否命中任一关键词（大小写不敏感，中文按子串匹配）。 */
export function hasMatch(text, terms) {
  return findFirstMatchIndex(text, terms) >= 0;
}

/**
 * 把命中的关键词包进 `<mark>`。
 * 返回的是「已转义 + 带高亮」的 HTML 片段，模板里必须用 `<%- %>` 输出。
 */
export function highlightMatches(text, terms) {
  const source = String(text ?? "");
  const regex = buildMatchRegex(terms);
  if (!regex) {
    return escapeHtml(source);
  }

  let html = "";
  let cursor = 0;
  for (const match of source.matchAll(regex)) {
    html += escapeHtml(source.slice(cursor, match.index));
    html += `<mark>${escapeHtml(match[0])}</mark>`;
    cursor = match.index + match[0].length;
  }
  html += escapeHtml(source.slice(cursor));
  return html;
}

/**
 * 以首次命中的位置为中心截取片段，命中处加高亮；未命中时退化为开头截断。
 * 这样用户能一眼看出「为什么这篇文章会被搜出来」。
 */
export function buildMatchExcerpt({ text, terms = [], maxLength = 180 } = {}) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) {
    return "";
  }
  if (source.length <= maxLength) {
    return highlightMatches(source, terms);
  }

  const hitIndex = findFirstMatchIndex(source, terms);
  const lead = hitIndex <= 0 ? 0 : Math.max(0, hitIndex - Math.floor(maxLength / 3));
  const start = Math.min(Math.max(0, lead), source.length - maxLength);
  const end = Math.min(source.length, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";

  return `${prefix}${highlightMatches(source.slice(start, end), terms)}${suffix}`;
}
