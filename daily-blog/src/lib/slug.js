import { randomBytes } from "node:crypto";

/**
 * slug 生成规则集中在这里：文章、分类、标签三处共用同一套逻辑，
 * 避免各自实现导致行为漂移。
 */

/** 由标题/名称生成 URL 友好的 slug；非 ASCII（如纯中文）会得到空串，交由调用方兜底。 */
export function slugifyText(value, maxLength = 80) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/** 是否至少包含一个 ASCII 字母，用于判断自动生成的 slug 是否有意义。 */
export function hasMeaningfulSlug(slug) {
  return /[a-z]/.test(slug);
}

/**
 * 中文内容的兜底 slug。
 * 分类/标签允许直接用中文原文作为 slug（前台 URL 会被浏览器编码，
 * 但可读性好于 category-20260928-a1b2c3），文章仍沿用时间戳兜底。
 */
export function cjkSlug(name, maxLength = 40) {
  const normalized = String(name ?? "").trim().replace(/\s+/g, "-");
  if (!normalized || normalized.length > maxLength) {
    return "";
  }
  // 只允许字母、数字、汉字与连字符/下划线，避免出现需要转义的特殊字符。
  return /^[\p{Script=Han}\p{L}\p{N}_-]+$/u.test(normalized) ? normalized : "";
}

/** 时间戳随机 slug：`post-20260928-3fa1c2`。 */
export function timestampSlug(prefix = "post") {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${stamp}-${randomBytes(3).toString("hex")}`;
}
