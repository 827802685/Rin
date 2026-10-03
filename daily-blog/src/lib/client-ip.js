import { hashIp } from "./ip.js";

/**
 * 客户端地址的统一口径。
 *
 * 归一化这一步不是洁癖：Node 在双栈监听时，同一个浏览器可能被记成
 * `::ffff:127.0.0.1`（IPv4 映射）或 `::1`（IPv6 回环），
 * 直接拿去做限流摘要会得到**两个不同的来源**，同一个人就能拿到双倍额度。
 * 统一之后再哈希，同一个来源在任何监听形态下都只有一个身份。
 */

const IPV4_MAPPED_IPV6 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** 归一化：去掉 IPv4 映射前缀，IPv6 回环统一成 IPv4 回环。 */
export function normalizeIp(ip) {
  const raw = String(ip ?? "").trim();
  if (!raw) {
    return "unknown";
  }
  const mapped = IPV4_MAPPED_IPV6.exec(raw);
  if (mapped) {
    return mapped[1];
  }
  if (raw === "::1") {
    return "127.0.0.1";
  }
  return raw;
}

/** 取本次请求的客户端地址；`req.ip` 已按 TRUST_PROXY 解析过转发头。 */
export function clientIpOf(req) {
  return normalizeIp(req?.ip ?? req?.socket?.remoteAddress ?? "");
}

/** 限流与防灌水共用的来源标识（加盐摘要，不可逆推）。 */
export function clientSubject(req) {
  return hashIp(clientIpOf(req));
}
