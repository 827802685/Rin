import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { requestContext } from "./middlewares/request-context.js";
import { notFoundHandler } from "./middlewares/not-found.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { healthRouter } from "./routes/health.routes.js";
import { siteRouter } from "./routes/site.routes.js";

/** 应用组装：中间件顺序为 请求上下文 → 静态资源 → 路由 → 404 → 错误处理器。 */
export function createApp() {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(import.meta.dirname, "views"));
  app.locals.site = config.site;

  app.use(requestContext);
  app.use("/assets", express.static(path.join(import.meta.dirname, "..", "public")));

  app.use(healthRouter);
  app.use(siteRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
