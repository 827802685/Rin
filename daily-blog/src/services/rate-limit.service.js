import { config } from "../config.js";
import { rateLimitRepository } from "../repositories/rate-limit.repository.js";

/**
 * 限流业务规则：窗口与额度的取值、恢复时刻的估算、过期行的清理时机。
 *
 * 与 Day 5 的评论限流是两套独立额度，刻意不去合并：
 * 评论限流按「内容 + 来源」判定（重复内容、蜜罐），属于业务防灌水；
 * 这里按「请求」判定，属于传输层保护，两者拦的东西不同。
 */

export const RATE_BUCKETS = Object.freeze({
  general: "general",
  login: "login",
});

/** 每累计这么多次命中就顺带做一次全表清理，避免每个请求都多一次 DELETE。 */
const PRUNE_EVERY = 64;
let sincePrune = 0;

/** SQLite 的 datetime 是 UTC 秒级字符串，补上 Z 才能被 JS 正确解析。 */
function parseSqliteTime(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

function resolvePolicy(bucket) {
  if (bucket === RATE_BUCKETS.login) {
    return {
      limit: config.rateLimit.loginMax,
      windowSeconds: config.rateLimit.loginWindowMinutes * 60,
    };
  }
  return {
    limit: config.rateLimit.max,
    windowSeconds: config.rateLimit.windowSeconds,
  };
}

/**
 * 记录一次请求并判断是否在额度内。
 *
 * 先写后判：超限的那一次也要落库，否则「刚好卡在额度上」的请求会被重复放行。
 */
export function consume(bucket, subject) {
  const { limit, windowSeconds } = resolvePolicy(bucket);

  rateLimitRepository.record(bucket, subject);
  rateLimitRepository.pruneSubject(bucket, subject, windowSeconds);

  if (++sincePrune >= PRUNE_EVERY) {
    sincePrune = 0;
    rateLimitRepository.pruneStale(Math.max(windowSeconds, config.rateLimit.windowSeconds));
  }

  const used = rateLimitRepository.countRecent(bucket, subject, windowSeconds);
  const allowed = used <= limit;

  let retryAfterSeconds = 0;
  if (!allowed) {
    const oldest = parseSqliteTime(
      rateLimitRepository.oldestRecent(bucket, subject, windowSeconds),
    );
    retryAfterSeconds = oldest
      ? Math.max(1, Math.ceil((oldest + windowSeconds * 1000 - Date.now()) / 1000))
      : windowSeconds;
  }

  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - used),
    windowSeconds,
    retryAfterSeconds,
  };
}

/** 只查询、不记数：用于给响应头提供当前余量。 */
export function peek(bucket, subject) {
  const { limit, windowSeconds } = resolvePolicy(bucket);
  const used = rateLimitRepository.countRecent(bucket, subject, windowSeconds);
  return {
    limit,
    remaining: Math.max(0, limit - used),
    windowSeconds,
  };
}

/** 登录成功后清零该来源的失败计数：额度是挡暴力破解的，不该惩罚刚登录成功的人。 */
export function resetLoginAttempts(subject) {
  return rateLimitRepository.clear(RATE_BUCKETS.login, subject);
}

export function pruneStale(windowSeconds = 86400) {
  return rateLimitRepository.pruneStale(windowSeconds);
}

export const rateLimitService = { consume, peek, resetLoginAttempts, pruneStale };
