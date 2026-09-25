import express from "express";
import { postsService } from "../services/posts.service.js";
import { renderPage } from "../views/render.js";
import { asyncHandler } from "../middlewares/request-context.js";

const router = express.Router();

/** 首页：已发布文章列表，支持 ?page= 分页。 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { items, pagination } = postsService.listPublished({
      page: req.query.page,
      pageSize: req.app.locals.site.pageSize,
    });
    await renderPage(res, "pages/home.ejs", {
      title: "首页",
      posts: items,
      pagination,
    });
  }),
);

/** 文章详情页。 */
router.get(
  "/posts/:slug",
  asyncHandler(async (req, res) => {
    const post = postsService.getPublishedBySlug(req.params.slug);
    await renderPage(res, "pages/post.ejs", {
      title: post.title,
      description: post.summary,
      post,
    });
  }),
);

export { router as siteRouter };
