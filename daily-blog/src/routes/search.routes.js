import express from "express";
import { config } from "../config.js";
import { searchService } from "../services/search.service.js";
import { taxonomyService } from "../services/taxonomy.service.js";
import { parseSearchParams } from "../validation/search-input.js";
import { renderPage } from "../views/render.js";
import { asyncHandler } from "../middlewares/request-context.js";

const router = express.Router();

/** 翻页链接必须带上关键词与筛选条件，否则点「下一页」就把搜索条件丢了。 */
function buildListQuery({ query, category, tag }) {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  if (category) {
    params.set("category", category.slug);
  }
  if (tag) {
    params.set("tag", tag.slug);
  }
  return params.toString();
}

/** 搜索页：?q= 关键词，?page= 页码，?category= / ?tag= 可选筛选。 */
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const params = parseSearchParams(req.query);
    const { items: posts, ...result } = searchService.search({
      ...params,
      pageSize: res.locals.site.pageSize,
    });

    await renderPage(res, "pages/search.ejs", {
      title: result.query ? `搜索：${result.query}` : "搜索",
      description: result.query
        ? `在「${res.locals.site.title}」中搜索「${result.query}」`
        : "按标题、摘要与正文搜索站内文章",
      ...result,
      posts,
      listQuery: buildListQuery(result),
      categories: taxonomyService.listCategories({ publishedOnly: true }),
      tags: taxonomyService.listTags({ publishedOnly: true }),
      searchMaxLength: config.site.searchMaxLength,
    });
  }),
);

/**
 * 搜索接口（JSON）：与搜索页共用同一套服务层实现，
 * 只返回已发布文章，便于前端脚本或第三方直接消费。
 * `titleHtml` / `excerptHtml` 是「已转义 + 已高亮」的 HTML 片段（命中处包 `<mark>`）。
 */
router.get(
  "/api/search",
  asyncHandler(async (req, res) => {
    const params = parseSearchParams(req.query);
    const { query, submitted, category, tag, items, pagination } = searchService.search({
      ...params,
      pageSize: res.locals.site.pageSize,
    });

    res.json({
      query,
      submitted,
      filters: {
        category: category ? category.slug : null,
        tag: tag ? tag.slug : null,
      },
      total: pagination.total,
      pagination,
      items: items.map((item) => ({
        slug: item.slug,
        title: item.title,
        titleHtml: item.titleHtml,
        excerptHtml: item.excerptHtml,
        url: `/posts/${encodeURIComponent(item.slug)}`,
        author: item.author,
        publishedAt: item.publishedAt,
        readingMinutes: item.readingMinutes,
        category: item.category,
        tags: item.tags,
      })),
    });
  }),
);

export { router as searchRouter };
