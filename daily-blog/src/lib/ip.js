import { createHash } from "node:crypto";

/**
 * 把来源 IP 变成不可逆推的定长标识，只用于评论的频率限制。
 *
 * 为什么存摘要而不存明文：评论是游客提交，落库明文 IP 属于可反查的个人信息，
 * 而防灌水只需要「判断这些提交是不是同一来源」，不需要知道来源是谁。
 * 盐是代码内常量（不是密钥），目的是避免直接用彩虹表反推 IPv4 这类小空间取值。
 */
const IP_SALT = "daily-blog:comment-ip";

export function hashIp(ip) {
  const raw = String(ip ?? "").trim();
  if (!raw) {
    return "unknown";
  }
  return createHash("sha256").update(`${IP_SALT}|${raw}`).digest("hex").slice(0, 32);
}
