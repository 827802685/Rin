/**
 * 类型化错误体系：所有业务错误都带 statusCode 与 code，
 * 全局错误处理器据此生成规范化的响应，绝不向客户端泄漏堆栈。
 */
export class AppError extends Error {
  constructor(message, { statusCode = 500, code = "internal_error", details = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "资源不存在", details = null) {
    super(message, { statusCode: 404, code: "not_found", details });
  }
}

export class ValidationError extends AppError {
  constructor(message = "请求参数不合法", details = null) {
    super(message, { statusCode: 400, code: "validation_error", details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "需要登录后才能访问", details = null) {
    super(message, { statusCode: 401, code: "unauthorized", details });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "没有权限执行该操作", details = null) {
    super(message, { statusCode: 403, code: "forbidden", details });
  }
}

/** 提交过于频繁（防灌水的频率限制命中）。 */
export class TooManyRequestsError extends AppError {
  constructor(message = "提交过于频繁，请稍后再试", details = null) {
    super(message, { statusCode: 429, code: "rate_limited", details });
  }
}

export class ConflictError extends AppError {
  constructor(message = "资源冲突", details = null) {
    super(message, { statusCode: 409, code: "conflict", details });
  }
}

export class DatabaseError extends AppError {
  constructor(message = "数据库操作失败", details = null) {
    super(message, { statusCode: 500, code: "database_error", details });
  }
}

export class InternalError extends AppError {
  constructor(message = "服务器内部错误", details = null) {
    super(message, { statusCode: 500, code: "internal_error", details });
  }
}

export function isAppError(error) {
  return error instanceof AppError;
}
