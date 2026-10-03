import { config } from "../config.js";
import { TooManyRequestsError } from "../errors.js";
import { clientSubject } from "../lib/client-ip.js";
import { RATE_BUCKETS, rateLimitService } from "../services/rate-limit.service.js";

/**
 * 请求限流：一个中间件管两个桶。
 *
 * - `general` 覆盖全站，挡的是脚本扫站与无意义的高频请求；
 * - `login` 只覆盖 POST /admin/login，额度单独收紧——它是唯一「猜中即通关」的入口。
 *
 * 来源用 IP 摘要而不是明文（与评论限流同一口径），库里没有可反查的地址。
 * `req.ip` 由 Express 按 `TRUST_PROXY` 解析（见 src/lib/trust-proxy.js）：
 * 反向代理后面必须配跳数或可信地址列表，否则所有请求都会被算成同一个来源（代理自己）。
 */

/** 登录路径单独分桶：它已经在全局桶里计过一次，这里不再重复计数。 */
function bucketFor(req) {
  const isLogin = req.method === "POST" && req.path === "/admin/login";
  return isLogin ? RATE_BUCKETS.login : RATE_BUCKETS.general;
}

export function rateLimitGuard(req, res, next) {
  if (!config.rateLimit.enabled) {
    next();
    return;
  }

  const bucket = bucketFor(req);
  const subject = clientSubject(req);

  let result;
  try {
    result = rateLimitService.consume(bucket, subject);
  } catch (error) {
    // 限流本身出故障（例如表被锁）不应该让整站不可用：放行并记录，由日志暴露问题。
    req.log?.warn("rate_limit.unavailable", { bucket, message: error.message });
    next();
    return;
  }

  res.setHeader("RateLimit-Limit", String(result.limit));
  res.setHeader("RateLimit-Remaining", String(result.remaining));
  res.setHeader("RateLimit-Reset", String(result.windowSeconds));

  if (result.allowed) {
    next();
    return;
  }

  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  req.log?.warn("rate_limit.blocked", {
    bucket,
    retryAfterSeconds: result.retryAfterSeconds,
  });

  next(
    new TooManyRequestsError(
      bucket === RATE_BUCKETS.login
        ? `登录尝试过于频繁，请在 ${result.retryAfterSeconds} 秒后重试`
        : `请求过于频繁，请在 ${result.retryAfterSeconds} 秒后重试`,
    ),
  );
}
