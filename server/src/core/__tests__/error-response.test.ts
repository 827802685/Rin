import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { registerErrorHandlers } from "../error-response";
import type { RinApp } from "../app-types";
import { BadRequestError } from "../../errors";

/**
 * 错误响应契约测试。
 *
 * 前端 `client/src/components/error-boundary.tsx` 的 parseApiError 读的是
 * `error.requestId` / `error.status`，而这两个字段后端过去从来不产出。
 * 这里把形状钉住：凡是非 2xx 的错误响应，body.error 都要带
 * code / message / status / requestId，并且 X-Request-Id 响应头与 body 一致。
 */

function buildApp(): RinApp {
  const app = new Hono() as unknown as RinApp;
  registerErrorHandlers(app);
  return app;
}

/** onError 会打结构化日志，测试里静默掉，避免污染 bun test 输出 */
async function withSilencedErrorLogs(run: () => Promise<void>): Promise<void> {
  const original = console.error;
  console.error = () => {};
  try {
    await run();
  } finally {
    console.error = original;
  }
}

type ErrorJson = {
  success: boolean;
  error: {
    code: string;
    message: string;
    status?: number;
    requestId?: string;
    details?: Array<{ field?: string; message: string }>;
  };
};

describe("registerErrorHandlers", () => {
  it("404 响应带 requestId、status，并与 X-Request-Id 头一致", async () => {
    await withSilencedErrorLogs(async () => {
      const app = buildApp();
      const response = await app.request("/api/nope", { method: "GET" });
      const body = (await response.json()) as ErrorJson;

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.status).toBe(404);
      expect(body.error.message).toContain("GET /api/nope");
      expect(body.error.requestId).toBeTruthy();
      expect(response.headers.get("X-Request-Id")).toBe(body.error.requestId ?? null);
    });
  });

  it("优先复用上游的 x-request-id", async () => {
    await withSilencedErrorLogs(async () => {
      const app = buildApp();
      const response = await app.request("/api/nope", {
        headers: { "x-request-id": "upstream-1" },
      });
      const body = (await response.json()) as ErrorJson;

      expect(body.error.requestId).toBe("upstream-1");
    });
  });

  it("没有 x-request-id 时退回复用 cf-ray", async () => {
    await withSilencedErrorLogs(async () => {
      const app = buildApp();
      const response = await app.request("/api/nope", {
        headers: { "cf-ray": "cf-ray-1" },
      });
      const body = (await response.json()) as ErrorJson;

      expect(body.error.requestId).toBe("cf-ray-1");
    });
  });

  it("AppError 透出 code / status / details / requestId", async () => {
    await withSilencedErrorLogs(async () => {
      const app = buildApp();
      app.get("/boom-app-error", () => {
        throw new BadRequestError("invalid input", [{ field: "name", message: "too short" }]);
      });

      const response = await app.request("/boom-app-error");
      const body = (await response.json()) as ErrorJson;

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("BAD_REQUEST");
      expect(body.error.message).toBe("invalid input");
      expect(body.error.status).toBe(400);
      expect(body.error.details).toEqual([{ field: "name", message: "too short" }]);
      expect(body.error.requestId).toBeTruthy();
    });
  });

  it("裸异常降级为 INTERNAL_ERROR / 500，但依然带 requestId", async () => {
    await withSilencedErrorLogs(async () => {
      const app = buildApp();
      app.get("/boom-plain", () => {
        throw new TypeError("cannot read property of undefined");
      });

      const response = await app.request("/boom-plain");
      const body = (await response.json()) as ErrorJson;

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.status).toBe(500);
      expect(body.error.requestId).toBeTruthy();
      // 细节留在服务端日志，响应只透出 message
      expect(body.error.details).toBeUndefined();
    });
  });

  it("只有 code 没有 statusCode 的异常也按 500 处理", async () => {
    await withSilencedErrorLogs(async () => {
      const app = buildApp();
      app.get("/boom-code-only", () => {
        throw Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
      });

      const response = await app.request("/boom-code-only");
      const body = (await response.json()) as ErrorJson;

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });
  });

  it("非 AppError 但带 code + statusCode 的异常保持原状态码", async () => {
    await withSilencedErrorLogs(async () => {
      const app = buildApp();
      app.get("/boom-loose", () => {
        // Hono 只把 Error 实例交给 onError（非 Error 的抛出物会直接往上抛），
        // 所以这里模拟"第三方/自建 Error 带业务码"的形状
        throw Object.assign(new Error("slow down"), {
          code: "RATE_LIMITED",
          statusCode: 429,
        });
      });

      const response = await app.request("/boom-loose");
      const body = (await response.json()) as ErrorJson;

      expect(response.status).toBe(429);
      expect(body.error.code).toBe("RATE_LIMITED");
      expect(body.error.status).toBe(429);
      expect(body.error.requestId).toBeTruthy();
    });
  });

  it("两次请求的 requestId 不同", async () => {
    await withSilencedErrorLogs(async () => {
      const app = buildApp();
      const first = (await (await app.request("/api/nope")).json()) as ErrorJson;
      const second = (await (await app.request("/api/nope")).json()) as ErrorJson;

      expect(first.error.requestId).not.toBe(second.error.requestId);
    });
  });
});
