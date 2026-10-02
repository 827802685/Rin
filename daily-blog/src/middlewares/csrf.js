import { config } from "../config.js";
import { ForbiddenError } from "../errors.js";
import { parseCookies, serializeCookie } from "../lib/cookies.js";
import { generateCsrfToken, csrfTokensEqual, isWellFormedCsrfToken } from "../lib/csrf.js";

/**
 * CSRF 防护中间件。
 *
 * 读请求（GET/HEAD/OPTIONS）一律放行并确保持有令牌；
 * 写请求必须回传与 Cookie 一致的令牌，否则 403。
 * 令牌从哪来都可以：表单隐藏字段、或 `X-CSRF-Token` 头（后台预览这类 fetch 用头）。
 *
 * 关闭开关只建议用在自动化测试：业务断言里塞「先取令牌再提交」会淹没真正的用例意图
 * （Day 5 的评论频率限制也是同样的处理口径，功能本身有独立用例覆盖）。
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** 令牌 Cookie 的寿命：比会话长，避免写文章写到一半令牌过期导致保存被拒。 */
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24;

export function csrfProtection(req, res, next) {
  if (!config.csrf.enabled) {
    res.locals.csrfToken = "";
    next();
    return;
  }

  const existing = parseCookies(req.headers.cookie)[config.csrf.cookieName];
  const token = isWellFormedCsrfToken(existing) ? existing : generateCsrfToken();

  if (token !== existing) {
    res.append(
      "Set-Cookie",
      serializeCookie(config.csrf.cookieName, token, {
        maxAge: TOKEN_MAX_AGE_SECONDS,
        secure: config.session.secureCookie,
      }),
    );
  }

  req.csrfToken = token;
  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const submitted =
    req.body?.[config.csrf.fieldName] ?? req.headers[config.csrf.headerName] ?? "";

  if (!csrfTokensEqual(token, submitted)) {
    req.log?.warn("csrf.rejected", {
      method: req.method,
      path: req.originalUrl,
      hasCookie: Boolean(existing),
    });
    next(new ForbiddenError("表单已过期或来源不可信，请刷新页面后重试"));
    return;
  }

  next();
}

/** 模板里统一用这个片段注入隐藏字段，避免每个表单手写一遍字段名。 */
export const CSRF_FIELD_NAME = config.csrf.fieldName;
