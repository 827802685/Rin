import { config } from "../config.js";
import { isAppError } from "../errors.js";
import { NotFoundError } from "../errors.js";

/**
 * 全局错误处理器：
 * - 类型化错误按 statusCode 返回；
 * - 未知错误记录完整堆栈（服务端），客户端只看到规范化结构；
 * - HTML 请求渲染错误页，JSON 请求返回错误对象。
 */
export function errorHandler(error, req, res, next) {
  const statusCode = isAppError(error) ? error.statusCode : 500;
  const code = isAppError(error) ? error.code : "internal_error";
  const message =
    statusCode === 500 && config.env !== "development" ? "服务器内部错误" : error.message;

  (req.log ?? console).error("request.failed", {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code,
    message: error.message,
    stack: config.env === "development" ? error.stack : undefined,
  });

  if (res.headersSent) {
    next(error);
    return;
  }

  if (req.accepts("html") && !isJsonEndpoint(req)) {
    res.status(statusCode).render("pages/error", {
      title: `${statusCode} · ${message}`,
      statusCode,
      code,
      message,
    });
    return;
  }

  res.status(statusCode).json({ error: { code, message } });
}

/** 接口路径统一返回 JSON，避免接口出错时把错误页 HTML 塞给调用方。 */
function isJsonEndpoint(req) {
  const url = req.originalUrl ?? "";
  return url.startsWith("/api/") || url.startsWith("/admin/api/");
}
