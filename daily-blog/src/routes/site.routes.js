import express from "express";
import { postsService } from "../services/posts.service.js";
import { taxonomyService } from "../services/taxonomy.service.js";
import { renderPage } from "../views/render.js";
import { renderPostPage } from "./comments.routes.js";
import { asyncHandler } from "../middlewares/request-context.js";

const router = express.Router();

/** 首页：已发布文章列表，支持 ?page= 分页。 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, pagination } = postsService.listPublished({
      page: req.query.page,
      pageSize: res.locals.site.pageSize,
    });
    await renderPage(res, "pages/home.ejs", {
      title: "首页",
      canonicalPath: "/",
      posts: items,
      pagination,
    });
  }),
);

// ---------- Day 3：分类与标签 ----------

/** 分类总览：只统计已发布文章，避免前台泄露草稿数量。 */
router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const categories = taxonomyService.listCategories({ publishedOnly: true });
    await renderPage(res, "pages/taxonomies.ejs", {
      title: "分类",
      canonicalPath: "/categories",
      heading: "分类",
      items: categories,
      emptyHint: "还没有分类。管理员可在后台「分类与标签」中创建。",
    });
  }),
);

/** 单个分类下的已发布文章列表。 */
router.get(
  "/categories/:slug",
  asyncHandler(async (req, res) => {
    const data = postsService.listByCategorySlug(req.params.slug, {
      page: req.query.page,
      pageSize: res.locals.site.pageSize,
    });
    await renderPage(res, "pages/taxonomy.ejs", {
      title: `分类：${data.category.name}`,
      description: data.category.description || undefined,
      canonicalPath: `/categories/${encodeURIComponent(data.category.slug)}`,
      kind: "分类",
      listPath: "/categories",
      taxonomy: data.category,
      posts: data.items,
      pagination: data.pagination,
      basePath: `/categories/${encodeURIComponent(data.category.slug)}`,
    });
  }),
);

/** 标签总览。 */
router.get(
  "/tags",
  asyncHandler(async (req, res) => {
    const tags = taxonomyService.listTags({ publishedOnly: true });
    await renderPage(res, "pages/taxonomies.ejs", {
      title: "标签",
      canonicalPath: "/tags",
      heading: "标签",
      items: tags,
      emptyHint: "还没有标签。写文章时在「标签」一栏填写即可自动创建。",
    });
  }),
);

/** 单个标签下的已发布文章列表。 */
router.get(
  "/tags/:slug",
  asyncHandler(async (req, res) => {
    const data = postsService.listByTagSlug(req.params.slug, {
      page: req.query.page,
      pageSize: res.locals.site.pageSize,
    });
    await renderPage(res, "pages/taxonomy.ejs", {
      title: `标签：${data.tag.name}`,
      canonicalPath: `/tags/${encodeURIComponent(data.tag.slug)}`,
      kind: "标签",
      listPath: "/tags",
      taxonomy: data.tag,
      posts: data.items,
      pagination: data.pagination,
      basePath: `/tags/${encodeURIComponent(data.tag.slug)}`,
    });
  }),
);

/**
 * 文章详情页（含评论区）。
 * 渲染逻辑放在 comments.routes.js 的 renderPostPage，与「评论提交失败原地回填」共用一套。
 */
router.get(
  "/posts/:slug",
  asyncHandler(async (req, res) => {
    const post = postsService.getPublishedBySlug(req.params.slug);
    await renderPostPage(res, {
      post,
      // 评论提交成功后跳回这里，给出「待审核」提示。
      commentResult: req.query?.comment === "submitted" ? "submitted" : null,
    });
  }),
);

export { router as siteRouter };
