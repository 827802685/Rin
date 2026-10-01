import { config } from "../config.js";

/**
 * 站点绝对地址的解析：canonical、RSS 的 link 与 sitemap 的 loc 都依赖它。
 *
 * 优先级：后台配置 / 环境变量 SITE_BASE_URL → 请求头推断。
 *
 * 反向代理后面的部署必须显式配置 SITE_BASE_URL：
 * 靠请求头推断时拿到的往往是容器内部的 host，写进 sitemap 会指向一个爬不到的地址。
 *
 * 用请求头推断时**必须**校验 Host：Host 头是客户端可控的，
 * 直接拼接会让攻击者把 canonical / RSS 链接指到任意站点（缓存投毒与 SEO 劫持）。
 */

const HOST_PATTERN = /^[a-zA-Z0-9.-]+(:\d+)?$/;

/** 拼接成绝对地址；path 保证以单个 / 开头。 */
export function joinUrl(baseUrl, path = "/") {
  const base = String(baseUrl ?? "").replace(/\/+$/, "");
  const suffix = String(path ?? "");
  if (!suffix) {
    return base;
  }
  return `${base}${suffix.startsWith("/") ? "" : "/"}${suffix}`;
}

/** 推断请求对应的站点根地址；拿不到可信值时回落到本机默认端口。 */
export function resolveBaseUrl(site = {}, req = null) {
  const configured = String(site.baseUrl ?? "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const host = String(req?.get?.("host") ?? "").trim();
  if (HOST_PATTERN.test(host)) {
    const forwarded = String(req?.get?.("x-forwarded-proto") ?? "").split(",")[0].trim();
    const proto = forwarded || req?.protocol || "http";
    if (proto === "http" || proto === "https") {
      return `${proto}://${host}`;
    }
  }

  return `http://127.0.0.1:${config.port}`;
}
