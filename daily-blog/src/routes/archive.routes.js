import express from "express";
import { archiveService } from "../services/archive.service.js";
import { renderPage } from "../views/render.js";
import { asyncHandler } from "../middlewares/request-context.js";

const router = express.Router();

/**
 * 归档页：全站按年折叠，单年页按月折叠。
 * 两个页面共用同一个模板与同一份服务层分组结果，避免「总览里的篇数」与
 * 「单年页里的篇数」由两套逻辑算出来而对不上。
 */
router.get(
  "/archive",
  asyncHandler(async (req, res) => {
    const data = archiveService.getOverview();
    await renderPage(res, "pages/archive.ejs", {
      title: "归档",
      description: `按年份浏览全部 ${data.total} 篇已发布文章。`,
      canonicalPath: "/archive",
      year: null,
      groups: data.years,
      total: data.total,
    });
  }),
);

router.get(
  "/archive/:year",
  asyncHandler(async (req, res) => {
    const data = archiveService.getYear(req.params.year);
    await renderPage(res, "pages/archive.ejs", {
      title: `${data.year} 年归档`,
      description: `${data.year} 年发布的 ${data.total} 篇文章。`,
      canonicalPath: `/archive/${data.year}`,
      year: data.year,
      groups: [{ ...data, url: `/archive/${data.year}` }],
      total: data.total,
    });
  }),
);

export { router as archiveRouter };
