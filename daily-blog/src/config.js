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

// 标签数量上限：超过只会让文章页标签区失控，前台也没有展示价值。
const maxTagsPerPost = readInt("SITE_MAX_TAGS_PER_POST", 8);
if (maxTagsPerPost <= 0 || maxTagsPerPost > 50) {
  throw new Error(`配置项 SITE_MAX_TAGS_PER_POST 必须在 1-50 之间，当前值：${maxTagsPerPost}`);
}

const sitePageSize = readInt("SITE_PAGE_SIZE", 10);
if (sitePageSize <= 0 || sitePageSize > 100) {
  throw new Error(`配置项 SITE_PAGE_SIZE 必须在 1-100 之间，当前值：${sitePageSize}`);
}

// 搜索关键词长度上限：LIKE '%关键词%' 无法走索引，超长关键词只会白白拖慢查询，
// 因此在入口处就拦掉，而不是让数据库去扫一个大 pattern。
const searchMaxLength = readInt("SITE_SEARCH_MAX_LENGTH", 64);
if (searchMaxLength < 8 || searchMaxLength > 200) {
  throw new Error(`配置项 SITE_SEARCH_MAX_LENGTH 必须在 8-200 之间，当前值：${searchMaxLength}`);
}

// ---------- Day 5：评论与基础防灌水 ----------

// 评论正文长度上下限：下限挡住「顶」「沙发」这类无意义灌水，上限挡住长篇复制粘贴。
const commentMinLength = readInt("COMMENT_MIN_LENGTH", 2);
if (commentMinLength < 1 || commentMinLength > 100) {
  throw new Error(`配置项 COMMENT_MIN_LENGTH 必须在 1-100 之间，当前值：${commentMinLength}`);
}
const commentMaxLength = readInt("COMMENT_MAX_LENGTH", 1000);
if (commentMaxLength < 20 || commentMaxLength > 5000) {
  throw new Error(`配置项 COMMENT_MAX_LENGTH 必须在 20-5000 之间，当前值：${commentMaxLength}`);
}
if (commentMinLength >= commentMaxLength) {
  throw new Error(
    `配置项 COMMENT_MIN_LENGTH 必须小于 COMMENT_MAX_LENGTH，当前值：${commentMinLength} / ${commentMaxLength}`,
  );
}

// 频率限制：同一来源（IP 摘要）在窗口期内的提交条数上限。
const commentRateLimit = readInt("COMMENT_RATE_LIMIT", 3);
if (commentRateLimit < 1 || commentRateLimit > 50) {
  throw new Error(`配置项 COMMENT_RATE_LIMIT 必须在 1-50 之间，当前值：${commentRateLimit}`);
}
const commentRateWindowMinutes = readInt("COMMENT_RATE_WINDOW_MINUTES", 10);
if (commentRateWindowMinutes < 1 || commentRateWindowMinutes > 1440) {
  throw new Error(
    `配置项 COMMENT_RATE_WINDOW_MINUTES 必须在 1-1440 之间，当前值：${commentRateWindowMinutes}`,
  );
}

// 单条评论允许携带的外链数量，超出即视为推广垃圾（0 表示完全禁止外链）。
const commentMaxLinks = readInt("COMMENT_MAX_LINKS", 3);
if (commentMaxLinks < 0 || commentMaxLinks > 10) {
  throw new Error(`配置项 COMMENT_MAX_LINKS 必须在 0-10 之间，当前值：${commentMaxLinks}`);
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
    pageSize: sitePageSize,
    maxTagsPerPost,
    searchMaxLength,
  }),
  comments: Object.freeze({
    minLength: commentMinLength,
    maxLength: commentMaxLength,
    rateLimit: commentRateLimit,
    rateWindowMinutes: commentRateWindowMinutes,
    maxLinks: commentMaxLinks,
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
