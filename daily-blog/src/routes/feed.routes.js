import express from "express";
import { feedService } from "../services/feed.service.js";
import { asyncHandler } from "../middlewares/request-context.js";

const router = express.Router();

/**
 * 订阅与站点地图端点。
 *
 * 内容随文章状态实时变化，但不需要「秒级新鲜」：订阅阅读器通常半小时到一小时抓一次，
 * 因此给 5 分钟的共享缓存，省下大量重复的 Markdown 渲染。
 */
const CACHE_CONTROL = "public, max-age=300";

function sendXml(res, body) {
  res.set("Cache-Control", CACHE_CONTROL);
  res.type("application/xml; charset=utf-8").send(body);
}

router.get(
  "/feed.xml",
  asyncHandler(async (req, res) => {
    // 订阅源地址必须是绝对的：阅读器拿不到「当前站点」，相对地址会解析到阅读器自己身上。
    sendXml(res, feedService.buildRss({ site: res.locals.site, baseUrl: res.locals.baseUrl }));
  }),
);

router.get(
  "/sitemap.xml",
  asyncHandler(async (req, res) => {
    sendXml(res, feedService.buildSitemap({ baseUrl: res.locals.baseUrl }));
  }),
);

router.get(
  "/robots.txt",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", CACHE_CONTROL);
    res
      .type("text/plain; charset=utf-8")
      .send(feedService.buildRobots({ site: res.locals.site, baseUrl: res.locals.baseUrl }));
  }),
);

export { router as feedRouter };
