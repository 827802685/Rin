import { settingsService } from "../services/settings.service.js";
import { joinUrl, resolveBaseUrl } from "../lib/base-url.js";

/**
 * 把「当前生效的站点配置」注入每个请求。
 *
 * app.locals.site 是环境变量提供的兜底值（错误页在未进路由时也要能渲染），
 * 这里挂到 res.locals 上覆盖它——Express 的渲染优先级是
 * app.locals < res.locals < render 参数，因此路由里的显式传参仍然优先。
 *
 * 同时挂上 absoluteUrl(path)：SEO meta、RSS 与 sitemap 都要输出绝对地址，
 * 与其在每个视图里各拼一遍（迟早拼出 http://host//posts 这种双斜杠），
 * 不如统一提供一个拼接函数。
 */
export function siteSettings(req, res, next) {
  const site = settingsService.getEffective();
  const baseUrl = resolveBaseUrl(site, req);

  res.locals.site = { ...site, baseUrl };
  res.locals.baseUrl = baseUrl;
  res.locals.absoluteUrl = (path) => joinUrl(baseUrl, path);
  // canonical 的默认取值：去掉查询串的当前路径，避免把 ?page=2 当成独立页面收录。
  res.locals.requestPath = String(req.originalUrl ?? "/").split("?")[0] || "/";

  next();
}
