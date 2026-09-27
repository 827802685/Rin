import "dotenv/config";

/**
 * 集中配置：所有配置来自环境变量，启动时一次性校验，缺失即快速失败。
 */

function readString(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return fallback;
  }
  return value;
}

function readInt(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`配置项 ${key} 必须是整数，当前值：${raw}`);
  }
  return parsed;
}

function readEnum(key, allowed, fallback) {
  const value = readString(key, fallback);
  if (!allowed.includes(value)) {
    throw new Error(`配置项 ${key} 只能是 ${allowed.join(" / ")}，当前值：${value}`);
  }
  return value;
}

function readBool(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`配置项 ${key} 只能是 true / false，当前值：${raw}`);
}

const port = readInt("PORT", 3000);
if (port <= 0 || port > 65535) {
  throw new Error(`配置项 PORT 必须在 1-65535 之间，当前值：${port}`);
}

const env = readEnum("NODE_ENV", ["development", "test", "production"], "development");

const adminUsername = readString("ADMIN_USERNAME", "admin");
if (!/^[A-Za-z0-9_.-]{3,32}$/.test(adminUsername)) {
  throw new Error(`配置项 ADMIN_USERNAME 只能是 3-32 位字母/数字/_.-，当前值：${adminUsername}`);
}

// 环境变量里写入的密码即管理员密码的“事实来源”：启动时据此创建或同步管理员账号。
// 未设置时不创建管理员，后台登录整体关闭（本地开发仍可正常浏览前台）。
const adminPassword = readString("ADMIN_PASSWORD", "");
const PLACEHOLDER_PASSWORD = "change-me-please";
if (adminPassword !== "" && adminPassword.length < 8) {
  throw new Error("配置项 ADMIN_PASSWORD 至少需要 8 位字符");
}
if (env === "production") {
  if (adminPassword === "") {
    throw new Error("生产环境必须设置 ADMIN_PASSWORD，否则后台无法登录");
  }
  if (adminPassword === PLACEHOLDER_PASSWORD) {
    throw new Error("生产环境的 ADMIN_PASSWORD 不能继续使用 .env.example 中的占位值");
  }
}

const sessionTtlHours = readInt("SESSION_TTL_HOURS", 12);
if (sessionTtlHours <= 0 || sessionTtlHours > 24 * 30) {
  throw new Error(`配置项 SESSION_TTL_HOURS 必须在 1-720 之间，当前值：${sessionTtlHours}`);
}

export const config = Object.freeze({
  env,
  port,
  host: readString("HOST", "127.0.0.1"),
  dbPath: readString("DB_PATH", "./data/blog.db"),
  site: Object.freeze({
    title: readString("SITE_TITLE", "每日迭代博客"),
    description: readString("SITE_DESCRIPTION", "以每日迭代方式构建的个人博客"),
    author: readString("SITE_AUTHOR", "admin"),
    pageSize: readInt("SITE_PAGE_SIZE", 10),
  }),
  admin: Object.freeze({
    username: adminUsername,
    password: adminPassword,
    enabled: adminPassword !== "",
  }),
  session: Object.freeze({
    cookieName: readString("SESSION_COOKIE_NAME", "daily_blog_admin"),
    ttlHours: sessionTtlHours,
    // 生产环境默认要求 HTTPS 才发送 Cookie；本地 HTTP 调试可显式关闭。
    secureCookie: readBool("SESSION_COOKIE_SECURE", env === "production"),
  }),
  logLevel: readEnum("LOG_LEVEL", ["debug", "info", "warn", "error"], "info"),
});
