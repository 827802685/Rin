import express from "express";
import { config } from "../config.js";
import { isAppError } from "../errors.js";
import { postsService } from "../services/posts.service.js";
import { commentsService } from "../services/comments.service.js";
import { parseCommentInput } from "../validation/comment-input.js";
import { clientSubject } from "../lib/client-ip.js";
import { toIso8601 } from "../lib/xml.js";
import { renderPage } from "../views/render.js";
import { asyncHandler } from "../middlewares/request-context.js";

const router = express.Router();

/**
 * 文章详情页的渲染入口。
 * 详情页 GET 与「评论提交失败需要原地回填」两条路径都要渲染同一页面，
 * 因此集中在这里，由 site.routes.js 与本文件的提交路由共用，避免两套渲染逻辑漂移。
 */
export async function renderPostPage(
  res,
  { post, status = 200, commentForm = null, commentErrors = {}, commentNotice = null, commentResult = null },
) {
  const comments = commentsService.listApprovedForPost(post.id);
  await renderPage(res.status(status), "pages/post.ejs", {
    title: post.title,
    description: post.summary,
    canonicalPath: `/posts/${encodeURIComponent(post.slug)}`,
    ogType: "article",
    // 文章页额外输出 article:*，搜索引擎据此识别发布时间、作者与标签。
    article: {
      publishedTime: toIso8601(post.publishedAt),
      author: post.author,
      section: post.category?.name ?? null,
      tags: (post.tags ?? []).map((tag) => tag.name),
    },
    post,
    comments,
    commentForm: commentForm ?? emptyCommentForm(),
    commentErrors,
    commentNotice,
    commentResult,
    commentLimits: {
      minLength: config.comments.minLength,
      maxLength: config.comments.maxLength,
      maxLinks: config.comments.maxLinks,
    },
  });
}

function emptyCommentForm() {
  return { authorName: "", authorEmail: "", authorUrl: "", content: "" };
}

/**
 * 游客提交评论。
 * 成功一律跳回详情页并带上 `?comment=submitted#comments`，
 * 失败则原地渲染详情页并保留已填写内容（评论表单在正文下方，跳走会丢失输入）。
 */
router.post(
  "/posts/:slug/comments",
  asyncHandler(async (req, res) => {
    const slug = req.params.slug;
    // 草稿与不存在的文章都不接受评论：这里抛 404，不必走服务层。
    const post = postsService.getPublishedBySlug(slug);

    const parsed = parseCommentInput(req.body);
    if (!parsed.ok) {
      await renderPostPage(res, {
        post,
        status: 400,
        commentForm: parsed.values,
        commentErrors: parsed.errors,
        commentNotice: "请修正表单中标记的问题后重新提交",
      });
      return;
    }

    try {
      // 表单里的蜜罐字段叫 homepage（对真人伪装成普通输入框），服务层用 honeypot 表达意图。
      const result = commentsService.submit(
        { postId: post.id, ...parsed.data, honeypot: parsed.data.homepage },
        {
          // 用归一化后的地址做摘要（见 src/lib/client-ip.js）：
          // 与全局限流中间件同一个口径，否则「评论限流」和「全局限流」会把同一个人算成两个来源。
          ipHash: clientSubject(req),
          userAgent: req.get("user-agent") ?? "",
        },
      );

      if (result.spam) {
        // 蜜罐命中：对外伪装成成功，让脚本以为得手而不再更换策略重试。
        req.log.warn("comment.spam_rejected", { postId: post.id, reason: result.reason });
      } else {
        req.log.info("comment.submitted", { id: result.id, postId: post.id });
      }

      res.redirect(303, `/posts/${encodeURIComponent(slug)}?comment=submitted#comments`);
    } catch (error) {
      if (isAppError(error)) {
        await renderPostPage(res, {
          post,
          status: error.statusCode,
          commentForm: parsed.values,
          commentNotice: error.message,
        });
        return;
      }
      throw error;
    }
  }),
);

export { router as commentsRouter };
