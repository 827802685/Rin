import { config } from "../config.js";
import { UnauthorizedError } from "../errors.js";
import { parseCookies, serializeCookie } from "../lib/cookies.js";
import { authService } from "../services/auth.service.js";

/** 只允许站内相对路径，避免 ?next=https://evil 造成开放重定向。 */
export function safeNextPath(value, fallback = "/admin") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  return value;
}

/** 接口请求（/api/*、/admin/api/*）返回 JSON，其余走页面跳转。 */
function apiRequest(req) {
  const url = req.originalUrl ?? "";
  return url.startsWith("/api/") || url.startsWith("/admin/api/") || !req.accepts("html");
}

function redirectWithStatus(req, res, location) {
  const status = req.method === "GET" || req.method === "HEAD" ? 302 : 303;
  res.redirect(status, location);
}

export function readSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[config.session.cookieName] ?? null;
}

export function setSessionCookie(res, token, maxAgeSeconds) {
  res.append(
    "Set-Cookie",
    serializeCookie(config.session.cookieName, token, {
      maxAge: maxAgeSeconds,
      secure: config.session.secureCookie,
    }),
  );
}

export function clearSessionCookie(res) {
  res.append(
    "Set-Cookie",
    serializeCookie(config.session.cookieName, "", {
      maxAge: 0,
      secure: config.session.secureCookie,
    }),
  );
}

/**
 * 每个请求都尝试解析会话：命中则把当前管理员挂到 req.admin 与 res.locals，
 * 让页面（如站点头部）无需在每个路由里重复查询。
 */
export function attachAdmin(req, res, next) {
  const token = readSessionToken(req);
  const session = token ? authService.resolveSession(token) : null;

  req.admin = session?.user ?? null;
  req.adminSessionToken = session ? token : null;
  res.locals.currentAdmin = req.admin;

  next();
}

/** 保护后台页面：未登录时页面请求跳登录页，接口请求返回 401。 */
export function requireAdmin(req, res, next) {
  if (req.admin) {
    next();
    return;
  }

  if (apiRequest(req)) {
    next(new UnauthorizedError("登录状态已失效，请重新登录"));
    return;
  }

  const next_ = safeNextPath(req.originalUrl);
  redirectWithStatus(req, res, `/admin/login?next=${encodeURIComponent(next_)}`);
}

/** 已登录时不再展示登录页，直接回到目标页。 */
export function redirectIfAuthenticated(req, res, next) {
  if (!req.admin) {
    next();
    return;
  }
  redirectWithStatus(req, res, safeNextPath(req.query?.next ?? "/admin"));
}
