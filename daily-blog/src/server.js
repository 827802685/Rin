import { createApp } from "./app.js";
import { config } from "./config.js";
import { getDb, closeDb } from "./db/index.js";
import { authService } from "./services/auth.service.js";
import { getRateLimitStore } from "./lib/rate-limit-store.js";
import { logger, setLogLevel } from "./logger.js";

setLogLevel(config.logLevel);

// 启动时应用数据库迁移，失败即快速失败，避免带着旧结构继续运行。
getDb();

// 按 .env 同步管理员账号：未设置 ADMIN_PASSWORD 时后台登录关闭，仅记录警告。
const adminBootstrap = authService.ensureAdminFromEnv();
if (adminBootstrap.enabled) {
  logger.info("admin.bootstrap", {
    username: adminBootstrap.username,
    created: adminBootstrap.created,
    updated: adminBootstrap.updated,
  });
} else {
  logger.warn("admin.bootstrap.disabled", {
    reason: "未设置 ADMIN_PASSWORD，后台登录不可用",
  });
}

// TRUST_PROXY=all 等于「相信 X-Forwarded-For 的最左侧」：只要前置代理没有覆写掉
// 客户端自带的那一段，任何人都能伪造来源身份，限流与评论防灌水会一起失效。
// 不是错误（有些网关确实只能这么配），但必须在启动日志里留下痕迹。
if (config.trustProxy.mode === "all") {
  logger.warn("trust_proxy.all", {
    message: "TRUST_PROXY=all 信任 X-Forwarded-For 最左侧，客户端可伪造来源；建议改为跳数（如 1）或可信地址列表",
  });
}

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  logger.info("server.started", {
    url: `http://${config.host}:${config.port}`,
    env: config.env,
    dbPath: config.dbPath,
    instanceId: config.instanceId,
    trustProxy: config.trustProxy.label,
    rateLimit: getRateLimitStore().describe(),
  });
});

/** 优雅停机：先停止接收新连接，再关闭数据库，超时强制退出。 */
function shutdown(signal) {
  logger.info("server.shutdown", { signal });
  server.close(() => {
    closeDb();
    logger.info("server.stopped", { signal });
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn("server.shutdown.forced", { signal, timeoutMs: 10000 });
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error("process.unhandledRejection", { message: String(reason) });
});

process.on("uncaughtException", (error) => {
  logger.error("process.uncaughtException", { message: error.message, stack: error.stack });
  process.exit(1);
});
