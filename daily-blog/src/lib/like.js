/**
 * SQL LIKE 通配符转义。
 *
 * 用户输入里的 `%` 与 `_` 在 LIKE 里是通配符，若不转义，
 * 搜索「100%」会变成「以 100 开头」，搜索「a_b」会匹配「axb」——
 * 结果与用户预期不符。这里统一转义，并在 SQL 中配合 `ESCAPE` 使用。
 */

/** 转义字符本身也要转义，否则用户输入 `\` 会破坏转义序列。 */
export const LIKE_ESCAPE_CHAR = "\\";

/** 把用户输入转成「字面量」形式，供 `LIKE ? ESCAPE '\'` 使用。 */
export function escapeLikePattern(value) {
  return String(value ?? "").replace(/[\\%_]/g, (char) => `${LIKE_ESCAPE_CHAR}${char}`);
}

/** 构造「包含」匹配的 pattern：`%关键词%`。 */
export function buildContainsPattern(value) {
  return `%${escapeLikePattern(value)}%`;
}
