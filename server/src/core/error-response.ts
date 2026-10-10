import type { Context } from "hono";
import type { RinApp } from "./app-types";
import { createErrorResponse, isAppError } from "../errors";
import type { ErrorCode, ErrorDetail, ErrorResponse } from "../errors";

/**
 * 错误响应统一出口。
 *
 * 这里曾经并存两套实现：`error-handler.ts`（AppError 中间件 + 进程内日志缓存，
 * 全仓库零引用）和这个真正被 `hono-app.ts` 挂载的版本。零引用的那套已删除，
 * 其中有价值的两点——请求追踪 ID、结构化错误日志——移植到这里；
 * 同时 `onError` / `notFound` 的响应体改为复用 `server/src/errors` 的
 * `ErrorResponse` 形状（code / message / status / requestId / details），
 * 不再各写各的 JSON。
 */

/** 纯时间戳 + 随机尾巴的短 ID，够日志检索用，不假装是 UUID */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * 优先复用上游/边缘已经分配好的 ID（`x-request-id`、Cloudflare 的 `cf-ray`），
 * 这样 worker 日志、`wrangler tail` 和用户反馈里的 ID 才能互相对上。
 */
function requestIdFor(c: Context): string {
  const headers = c.req.raw.headers;
  return headers.get("x-request-id") || headers.get("cf-ray") || generateRequestId();
}

/**
 * 把任意抛出物压成对外的错误响应，三条分支的对外行为与改造前一致：
 * 1. `AppError`（业务代码实际抛出的类型）→ 用自己的 `toJSON`，details/status 齐全；
 * 2. 带 `code` + `statusCode` 但非 AppError 实例的 Error（自建或第三方错误子类）
 *    → 原样透出，不降级；注意 Hono 只把 Error 实例交给 onError，非 Error 抛出物
 *    会直接冒到运行时，不会走这里；
 * 3. 其余（裸异常、只有 code 的系统错误等）→ 统一 INTERNAL_ERROR / 500。
 */
function toErrorResponse(error: unknown, requestId: string): ErrorResponse {
  if (isAppError(error)) {
    return error.toJSON(requestId);
  }

  const loose = error as {
    code?: ErrorCode;
    statusCode?: number;
    message?: string;
    details?: ErrorDetail[];
  } | null;

  if (loose?.code && loose?.statusCode) {
    return {
      success: false,
      error: {
        code: loose.code,
        message: loose.message || "An unexpected error occurred",
        details: loose.details,
        requestId,
        status: loose.statusCode,
      },
    };
  }

  return createErrorResponse(error, requestId);
}

function sendError(c: Context, body: ErrorResponse, error?: unknown) {
  const status = body.error.status ?? 500;

  // 仍然全量打印，只是从 `console.error("Error:", err)` 变成带 requestId 的结构化一条；
  // 5xx 保留 stack（排查靠它），业务错误（4xx）不必。
  console.error("[rin:error]", {
    requestId: body.error.requestId,
    method: c.req.method,
    path: c.req.path,
    status,
    code: body.error.code,
    message: body.error.message,
    stack: status >= 500 && error instanceof Error ? error.stack : undefined,
  });

  return c.json(
    body,
    // Hono 的状态码是字面量联合类型，这里的值来自运行时错误对象
    status as 200,
    { "X-Request-Id": body.error.requestId ?? "" },
  );
}

export function registerErrorHandlers(app: RinApp) {
  app.notFound((c: Context) => {
    const requestId = requestIdFor(c);

    return sendError(c, {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${c.req.path} not found`,
        requestId,
        status: 404,
      },
    });
  });

  app.onError((err: Error, c: Context) => {
    return sendError(c, toErrorResponse(err, requestIdFor(c)), err);
  });
}
