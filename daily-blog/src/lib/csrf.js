import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * CSRF 令牌：双提交 Cookie（double-submit cookie）。
 *
 * 为什么这样选型：
 * 1. 不需要服务端状态——令牌本身就是随机串，不落库、不占内存，
 *    也就没有「会话过期但令牌还在」之类的状态漂移；
 * 2. 对游客同样有效——评论表单是匿名的，没有会话可绑定，
 *    而令牌写在 HttpOnly Cookie 里，攻击者读不到也写不进受害者的浏览器；
 * 3. 表单里回传同一个值：攻击者拿不到受害者的 Cookie，构造不出能匹配的表单。
 *
 * 它保护的不是「请求来自谁」，而是「这个写请求确实是本站页面发出的」。
 */
const TOKEN_BYTES = 32;

export function generateCsrfToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** 恒定时间比较：长度不同直接不等，长度相同再逐字节比，避免靠耗时泄漏前缀。 */
export function csrfTokensEqual(expected, actual) {
  const a = String(expected ?? "");
  const b = String(actual ?? "");
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** 只接受自己签发过的格式（base64url 定长），避免 Cookie 被塞进超长畸形值参与比较。 */
export function isWellFormedCsrfToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
