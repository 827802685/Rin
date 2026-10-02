/**
 * Cookie 读写工具：Express 本身不解析 Cookie，这里只做最小实现，
 * 避免为了一个会话 Cookie 引入额外依赖。
 */

/** 解析 Cookie 请求头为普通对象；值会做 URI 解码，非法编码时保留原值。 */
export function parseCookies(header) {
  const cookies = {};
  if (!header || typeof header !== "string") {
    return cookies;
  }

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    const name = part.slice(0, index).trim();
    if (!name) {
      continue;
    }
    const rawValue = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }

  return cookies;
}

/** 序列化 Set-Cookie 值；默认 httpOnly + SameSite=Lax，可显式要求 HTTPS。 */
export function serializeCookie(name, value, options = {}) {
  const {
    maxAge = null,
    httpOnly = true,
    sameSite = "Lax",
    path = "/",
    secure = false,
  } = options;

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (maxAge !== null) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  }
  if (httpOnly) {
    parts.push("HttpOnly");
  }
  if (secure) {
    parts.push("Secure");
  }
  if (sameSite) {
    parts.push(`SameSite=${sameSite}`);
  }

  return parts.join("; ");
}
