import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { requestContext } from "./middlewares/request-context.js";
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
 * 应用组装：中间件顺序为 请求上下文 → 站点配置 → 请求体解析 → 静态资源 → 会话 → 路由 → 404 → 错误处理器。
 *
 * app.locals.site 是环境变量提供的兜底值：错误页可能在还没进路由时就渲染，
 * 那时 res.locals.site 还没挂上，视图里仍然要有 site 可用。
 */
export function createApp() {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(import.meta.dirname, "views"));
  app.locals.site = config.site;

  app.use(requestContext);
  app.use(siteSettings);
  // 文章正文可能较长，放宽到 2MB；后台表单全部是扁平字段，无需嵌套解析。
  app.use(express.urlencoded({ extended: false, limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));
  app.use("/assets", express.static(path.join(import.meta.dirname, "..", "public")));

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
