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

const port = readInt("PORT", 3000);
if (port <= 0 || port > 65535) {
  throw new Error(`配置项 PORT 必须在 1-65535 之间，当前值：${port}`);
}

export const config = Object.freeze({
  env: readEnum("NODE_ENV", ["development", "test", "production"], "development"),
  port,
  host: readString("HOST", "127.0.0.1"),
  dbPath: readString("DB_PATH", "./data/blog.db"),
  site: Object.freeze({
    title: readString("SITE_TITLE", "每日迭代博客"),
    description: readString("SITE_DESCRIPTION", "以每日迭代方式构建的个人博客"),
    author: readString("SITE_AUTHOR", "admin"),
    pageSize: readInt("SITE_PAGE_SIZE", 10),
  }),
  logLevel: readEnum("LOG_LEVEL", ["debug", "info", "warn", "error"], "info"),
});
