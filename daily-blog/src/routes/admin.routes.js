import express from "express";
import { config } from "../config.js";
import { UnauthorizedError, isAppError } from "../errors.js";
import { POST_STATUSES, postsService } from "../services/posts.service.js";
import { authService } from "../services/auth.service.js";
import { parsePostInput } from "../validation/post-input.js";
import { renderPage } from "../views/render.js";
import { asyncHandler } from "../middlewares/request-context.js";
import {
  requireAdmin,
  redirectIfAuthenticated,
  setSessionCookie,
  clearSessionCookie,
  safeNextPath,
} from "../middlewares/auth.js";

const router = express.Router();

/** 后台列表每页条数：后台需要一屏看到更多，因此独立于前台 pageSize。 */
const ADMIN_PAGE_SIZE = 20;

const FLASH_MESSAGES = Object.freeze({
  created: "文章已创建",
  updated: "文章已保存",
  published: "文章已发布",
  drafted: "已转为草稿",
  deleted: "文章已删除",
});

function emptyFormValues() {
  return {
    title: "",
    slug: "",
    summary: "",
    content: "",
    author: config.site.author,
    status: "draft",
  };
}

function formValuesFromPost(post) {
  return {
    title: post.title,
    slug: post.slug,
    summary: post.summaryRaw ?? "",
    content: post.contentMd ?? "",
    author: post.author,
    status: post.status,
  };
}

/** slug 冲突是唯一能映射到具体表单项的业务错误，其余只显示整体提示。 */
function conflictErrors(error) {
  return error.code === "conflict" ? { slug: error.message } : {};
}

async function renderLogin(res, { status = 200, error = null, username = "", next = "/admin" } = {}) {
  await renderPage(res.status(status), "pages/admin/login.ejs", {
    title: "后台登录",
    wide: true,
    error,
    username,
    next,
    adminEnabled: config.admin.enabled,
  });
}

async function renderEditor(
  res,
  { status = 200, mode, postId = null, values, errors = {}, notice = null },
) {
  await renderPage(res.status(status), "pages/admin/editor.ejs", {
    title: mode === "create" ? "新建文章" : "编辑文章",
    wide: true,
    mode,
    postId,
    action: mode === "create" ? "/admin/posts" : `/admin/posts/${postId}`,
    values,
    errors,
    notice,
  });
}

function adminRedirect(res, flash, filter = null) {
  const params = new URLSearchParams();
  if (flash) {
    params.set("flash", flash);
  }
  if (filter) {
    params.set("status", filter);
  }
  const query = params.toString();
  res.redirect(303, query ? `/admin?${query}` : "/admin");
}

/** 列表筛选：GET 时读查询串，状态切换/删除表单则通过隐藏字段 filter 带回。 */
function readStatusFilter(req) {
  const raw = req.body?.filter || req.query?.status;
  return POST_STATUSES.includes(raw) ? raw : null;
}

// ---------- 登录 / 登出 ----------

router.get(
  "/admin/login",
  redirectIfAuthenticated,
  asyncHandler(async (req, res) => {
    await renderLogin(res, { next: safeNextPath(req.query?.next ?? "/admin") });
  }),
);

router.post(
  "/admin/login",
  redirectIfAuthenticated,
  asyncHandler(async (req, res) => {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    const next = safeNextPath(req.body?.next ?? "/admin");

    if (!username || !password) {
      await renderLogin(res, { status: 400, error: "请填写用户名和密码", username, next });
      return;
    }

    if (!config.admin.enabled) {
      await renderLogin(res, {
        status: 503,
        error: "后台登录未启用：请先在 .env 中设置 ADMIN_PASSWORD",
        username,
        next,
      });
      return;
    }

    try {
      const user = authService.authenticate({ username, password });
      const { token, maxAgeSeconds } = authService.createSession({
        userId: user.id,
        userAgent: req.get("user-agent") ?? "",
      });
      setSessionCookie(res, token, maxAgeSeconds);
      req.log.info("auth.login.succeeded", { username: user.username });
      res.redirect(303, next);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        req.log.warn("auth.login.failed", { username });
        await renderLogin(res, {
          status: 401,
          error: "用户名或密码不正确",
          username,
          next,
        });
        return;
      }
      throw error;
    }
  }),
);

router.post(
  "/admin/logout",
  asyncHandler(async (req, res) => {
    const removed = authService.destroySession(req.adminSessionToken);
    clearSessionCookie(res);
    req.log.info("auth.logout", { removed: removed > 0 });
    res.redirect(303, "/");
  }),
);

// ---------- 后台列表 ----------

router.get(
  "/admin",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const statusFilter = readStatusFilter(req);
    const data = postsService.listForAdmin({
      page: req.query?.page,
      pageSize: ADMIN_PAGE_SIZE,
      status: statusFilter,
    });

    await renderPage(res, "pages/admin/dashboard.ejs", {
      title: "后台管理",
      wide: true,
      ...data,
      adminUser: req.admin,
      flash: FLASH_MESSAGES[req.query?.flash] ?? null,
      flashType: req.query?.flash === "deleted" ? "warn" : "info",
    });
  }),
);

// ---------- 新建 / 编辑 ----------

router.get(
  "/admin/posts/new",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await renderEditor(res, { mode: "create", values: emptyFormValues() });
  }),
);

router.post(
  "/admin/posts",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = parsePostInput(req.body);
    if (!parsed.ok) {
      await renderEditor(res, {
        status: 400,
        mode: "create",
        values: parsed.values,
        errors: parsed.errors,
        notice: "请修正表单中标记的问题后重新提交",
      });
      return;
    }

    try {
      const post = postsService.createPost(parsed.data);
      req.log.info("admin.post.created", { id: post.id, slug: post.slug, status: post.status });
      adminRedirect(res, "created");
    } catch (error) {
      if (isAppError(error)) {
        await renderEditor(res, {
          status: error.statusCode,
          mode: "create",
          values: parsed.values,
          errors: conflictErrors(error),
          notice: error.message,
        });
        return;
      }
      throw error;
    }
  }),
);

router.get(
  "/admin/posts/:id/edit",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const post = postsService.getById(req.params.id);
    await renderEditor(res, {
      mode: "edit",
      postId: post.id,
      values: formValuesFromPost(post),
      notice: null,
    });
  }),
);

router.post(
  "/admin/posts/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const postId = req.params.id;
    const parsed = parsePostInput(req.body);

    if (!parsed.ok) {
      await renderEditor(res, {
        status: 400,
        mode: "edit",
        postId,
        values: parsed.values,
        errors: parsed.errors,
        notice: "请修正表单中标记的问题后重新提交",
      });
      return;
    }

    try {
      const post = postsService.updatePost(postId, parsed.data);
      req.log.info("admin.post.updated", { id: post.id, slug: post.slug });
      adminRedirect(res, "updated");
    } catch (error) {
      if (isAppError(error)) {
        await renderEditor(res, {
          status: error.statusCode,
          mode: "edit",
          postId,
          values: parsed.values,
          errors: conflictErrors(error),
          notice: error.message,
        });
        return;
      }
      throw error;
    }
  }),
);

// ---------- 草稿 / 发布 切换 ----------

router.post(
  "/admin/posts/:id/status",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const post = postsService.setStatus(req.params.id, req.body?.status);
    req.log.info("admin.post.status_changed", { id: post.id, status: post.status });
    adminRedirect(res, post.status === "published" ? "published" : "drafted", readStatusFilter(req));
  }),
);

// ---------- 删除 ----------

router.post(
  "/admin/posts/:id/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = postsService.removePost(req.params.id);
    req.log.info("admin.post.deleted", { id: result.id });
    adminRedirect(res, "deleted", readStatusFilter(req));
  }),
);

// ---------- 编辑页 Markdown 预览接口 ----------

router.post(
  "/admin/api/preview",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({
      html: postsService.previewHtml(req.body?.content ?? ""),
      requestId: req.requestId,
    });
  }),
);

export { router as adminRouter };
