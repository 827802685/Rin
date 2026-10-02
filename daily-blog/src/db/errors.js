import { DatabaseError } from "../errors.js";

/** 统一的仓储层错误包装：把驱动异常转换为类型化错误。 */
export function wrapDatabaseError(operation, error) {
  return new DatabaseError(`数据库操作失败（${operation}）：${error.message}`);
}

export function safeRun(operation, fn) {
  try {
    return fn();
  } catch (error) {
    if (error?.code?.startsWith?.("SQLITE")) {
      throw wrapDatabaseError(operation, error);
    }
    throw error;
  }
}
