import { generateRequestId, createRequestLogger } from "../logger.js";

/** 为每个请求注入 requestId，并挂上带 requestId 的日志器与计时。 */
export function requestContext(req, res, next) {
  req.requestId = req.headers["x-request-id"] || generateRequestId();
  req.log = createRequestLogger(req.requestId);
  req.startedAt = process.hrtime.bigint();

  res.setHeader("x-request-id", req.requestId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
    req.log.info("request.completed", {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
    });
  });

  next();
}

/** 统一包裹异步处理器，保证异常一定进入错误中间件。 */
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
