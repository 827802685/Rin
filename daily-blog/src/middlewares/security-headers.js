import { config } from "../config.js";

/**
 * 安全响应头：把「浏览器 defaults 里缺失的那一层」补齐，并给出严格的 CSP。
 *
 * 为什么 CSP 里没有 'unsafe-inline'：
 * 内联脚本/样式是 XSS 最主要的落地点，一旦放行这一项，CSP 基本失去意义。
 * 因此 Day 7 顺手把 `onsubmit="return confirm(...)"` 这类内联处理属性
 * 全部改成了 `data-confirm` + 外部脚本（public/confirm-submit.js），
 * 模板里不存在任何内联脚本或内联样式，策略可以做到只允许同源资源。
 *
 * 为什么 img-src 放开 https：文章正文引用外链图是正常使用方式，
 * 不允许就得把图传上来（本站尚无附件上传），因此按最小够用放开 https 与 data。
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
].join("; ");

const PERMISSIONS_POLICY = [
  "geolocation=()",
  "microphone=()",
  "camera=()",
  "payment=()",
  "usb=()",
  "interest-cohort=()",
].join(", ");

/** 只有当请求确实走 HTTPS 时才发 HSTS：明文 HTTP 上发 HSTS 会让浏览器拒绝再访问 http 端口。 */
function isHttpsRequest(req) {
  if (req.secure) {
    return true;
  }
  const forwarded = req.headers["x-forwarded-proto"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim() === "https";
  }
  return false;
}

export function securityHeaders(req, res, next) {
  if (!config.security.headersEnabled) {
    next();
    return;
  }

  // X-Powered-By 只会告诉攻击者技术栈版本，没有收益。
  res.removeHeader("X-Powered-By");

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);

  if (config.security.hstsMaxAge > 0 && isHttpsRequest(req)) {
    res.setHeader(
      "Strict-Transport-Security",
      `max-age=${config.security.hstsMaxAge}; includeSubDomains`,
    );
  }

  next();
}
