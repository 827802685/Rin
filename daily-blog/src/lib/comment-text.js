/**
 * 评论正文的纯文本处理：归一化换行 + 外链计数。
 * 评论不做 Markdown 渲染（避免游客可控的富文本带来额外攻击面），
 * 只做换行保留与 HTML 转义，转义由 EJS 的 `<%= %>` 负责。
 */

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** 统一换行为 \n，压掉连续空行，去掉首尾空白。 */
export function normalizeCommentText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 统计正文里的 http(s) 链接条数，用于「外链过多视为推广垃圾」的规则。 */
export function countLinks(text) {
  const matches = String(text ?? "").match(URL_PATTERN);
  return matches ? matches.length : 0;
}
