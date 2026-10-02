import { NotFoundError } from "../errors.js";

/** 404 兜底：未匹配任何路由时抛出类型化错误，交给错误处理器统一渲染。 */
export function notFoundHandler(req, res, next) {
  next(new NotFoundError(`页面不存在：${req.originalUrl}`));
}
