import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { requestContext } from "./middlewares/request-context.js";
import { securityHeaders } from "./middlewares/security-headers.js";
import { rateLimitGuard } from "./middlewares/rate-limit.js";
import { csrfProtection } from "./middlewares/csrf.js";
import { attachAdmin } from "./middlewares/auth.js";
import { siteSettings } from "./middlewares/site-settings.js";
import { notFoundHandler } from "./middlewares/not-found.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { healthRouter } from "./routes/health.routes.js";
import { siteRouter } from "./routes/site.routes.js";
import { archiveRouter } from "./routes/archive.routes.js";
import { feedRouter } from "./routes/feed.routes.js";
import { searchRouter } from "./routes/search.routes.js";
// 评论提交挂在 /posts/:slug/comments，先于 siteRouter 注册，避免被详情页路由抢先匹配。
import { commentsRouter } from "./routes/comments.routes.js";
import { adminRouter } from "./routes/admin.routes.js";

/**
 * 应用组装，中间件顺序为：
 *   请求上下文 → 安全响应头 → 站点配置 → 请求体解析 → 静态资源
 *   → 限流 → CSRF → 会话解析 → 路由 → 404 → 错误处理器。
 *
 * 顺序不是随意排的：
 * - 安全头要在最前面，这样 404 与 500 的响应也带着它们（错误页同样需要 CSP）；
 * - 限流在 CSRF 之前：被限流的请求没必要再算令牌，省一次恒定时间比较；
 * - CSRF 在请求体解析之后（要读 req.body._csrf），但在会话之前——
 *   伪造请求不该因为「已经解析出管理员」就获得更多执行路径；
 * - 静态资源在限流之前：样式与脚本是页面正常渲染的一部分，
 *   把它们算进额度只会让「正常打开一个后台页」消耗掉十几次额度。
 *
 * app.locals.site 是环境变量提供的兜底值：错误页可能在还没进路由时就渲染，
 * 那时 res.locals.site 还没挂上，视图里仍然要有 site 可用。
 */
export function createApp() {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(import.meta.dirname, "views"));
  app.locals.site = config.site;

  // 必须在任何中间件之前设置：`req.ip` 怎么解析（要不要看 X-Forwarded-For）
  // 决定了限流与评论防灌水把请求算成「谁」，晚一步就会有请求按错误的来源处理。
  app.set("trust proxy", config.trustProxy.value);

  app.use(requestContext);
  app.use(securityHeaders);
  app.use(siteSettings);
  // 文章正文可能较长，放宽到 2MB；后台表单全部是扁平字段，无需嵌套解析。
  app.use(express.urlencoded({ extended: false, limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));
  app.use("/assets", express.static(path.join(import.meta.dirname, "..", "public")));

  app.use(rateLimitGuard);
  app.use(csrfProtection);
  app.use(attachAdmin);

  app.use(healthRouter);
  app.use(feedRouter);
  app.use(archiveRouter);
  app.use(searchRouter);
  app.use(commentsRouter);
  app.use(siteRouter);
  app.use(adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
