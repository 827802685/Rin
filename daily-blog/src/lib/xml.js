/**
 * XML 输出的小工具：RSS 与 sitemap 都是手写模板拼出来的（RSS 只有二十来行），
 * 为此引入一个依赖不划算，但**转义是绝对不能省的**——
 * 标题里一个 `&` 就能让整个订阅源变成无法解析的坏 XML。
 */

const XML_ESCAPES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
});

/** 转义 XML 的五个特殊字符。 */
export function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

/**
 * SQLite 里的时间是 UTC 的 'YYYY-MM-DD HH:MM:SS'。
 * 直接用 new Date(那个串) 会被当成**本地时间**解析，因此必须显式补上 Z。
 */
export function parseSqliteDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** RSS 的 pubDate 要求 RFC 822/1123（例如 Mon, 02 Oct 2026 03:04:05 GMT）。 */
export function toRfc822(value) {
  const date = parseSqliteDate(value);
  return date ? date.toUTCString() : new Date().toUTCString();
}

/** sitemap 的 lastmod 要求 ISO 8601，与 RSS 的日期格式不同，不要混用。 */
export function toIso8601(value) {
  const date = parseSqliteDate(value) ?? new Date();
  return date.toISOString();
}
