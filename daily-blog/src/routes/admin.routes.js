import express from "express";
import { config } from "../config.js";
import { UnauthorizedError, isAppError } from "../errors.js";
import { POST_STATUSES, postsService } from "../services/posts.service.js";
import { taxonomyService } from "../services/taxonomy.service.js";
import { authService } from "../services/auth.service.js";
import { parsePostInput } from "../validation/post-input.js";
import { parseCategoryInput, parseTagInput } from "../validation/taxonomy-input.js";
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
  "category-created": "分类已创建",
  "category-updated": "分类已更新",
  "category-deleted": "分类已删除",
  "tag-created": "标签已创建",
  "tag-updated": "标签已更新",
  "tag-deleted": "标签已删除",
});

function emptyFormValues() {
  return {
    title: "",
    slug: "",
    summary: "",
    content: "",
    author: config.site.author,
    status: "draft",
    categoryId: "",
    tags: "",
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
    categoryId: post.category ? String(post.category.id) : "",
    tags: (post.tags ?? []).map((tag) => tag.name).join(", "),
  };
}

/** slug 冲突是唯一能映射到具体表单项的业务错误，其余只显示整体提示。 */
function conflictErrors(error) {
  return error.code === "conflict" ? { slug: error.message } : {};
}

/** 分类/标签的名称唯一与 slug 占用都映射到对应输入框。 */
function taxonomyFieldErrors(error) {
  if (error.code !== "conflict") {
    return {};
  }
  if (error.message.includes("slug")) {
    return { slug: error.message };
  }
  if (error.message.includes("名称")) {
    return { name: error.message };
  }
  return {};
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
    // 分类是单选下拉，标签用输入框 + datalist 提示已有标签（可自由新建）。
    categories: taxonomyService.listCategories(),
    allTags: taxonomyService.listTags(),
    maxTags: config.site.maxTagsPerPost,
  });
}

/**
 * 后台「分类与标签」页。
 * 新建表单出错时用同一页面回填输入；重命名/删除失败只给整体提示（行内表单不便逐字段回填）。
 */
async function renderTaxonomy(
  res,
  { status = 200, activeForm = "category", values = {}, errors = {}, notice = null, flash = null },
) {
  await renderPage(res.status(status), "pages/admin/taxonomy.ejs", {
    title: "分类与标签",
    wide: true,
    categories: taxonomyService.listCategories(),
    tags: taxonomyService.listTags(),
    values: {
      category: { name: "", slug: "", description: "", ...(values.category ?? {}) },
      tag: { name: "", slug: "", ...(values.tag ?? {}) },
    },
    errors,
    activeForm,
    notice,
    flash,
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

// ---------- 分类与标签管理 ----------

router.get(
  "/admin/taxonomy",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await renderTaxonomy(res, { flash: FLASH_MESSAGES[req.query?.flash] ?? null });
  }),
);

/** 新建成功走跳转，失败就地渲染并回填输入。 */
function handleTaxonomyCreate({ kind, parse, create, activeForm, flashKey }) {
  return asyncHandler(async (req, res) => {
    const parsed = parse(req.body);
    if (!parsed.ok) {
      await renderTaxonomy(res, {
        status: 400,
        activeForm,
        values: { [activeForm]: parsed.values },
        errors: parsed.errors,
        notice: "请修正表单中标记的问题后重新提交",
      });
      return;
    }

    try {
      const created = create(parsed.data);
      req.log.info(`admin.${kind}.created`, { id: created.id, slug: created.slug });
      res.redirect(303, `/admin/taxonomy?flash=${flashKey}`);
    } catch (error) {
      if (isAppError(error)) {
        await renderTaxonomy(res, {
          status: error.statusCode,
          activeForm,
          values: { [activeForm]: parsed.values },
          errors: taxonomyFieldErrors(error),
          notice: error.message,
        });
        return;
      }
      throw error;
    }
  });
}

router.post(
  "/admin/taxonomy/categories",
  requireAdmin,
  handleTaxonomyCreate({
    kind: "category",
    parse: parseCategoryInput,
    create: (data) => taxonomyService.createCategory(data),
    activeForm: "category",
    flashKey: "category-created",
  }),
);

router.post(
  "/admin/taxonomy/tags",
  requireAdmin,
  handleTaxonomyCreate({
    kind: "tag",
    parse: parseTagInput,
    create: (data) => taxonomyService.createTag(data),
    activeForm: "tag",
    flashKey: "tag-created",
  }),
);

/** 重命名 / 调整 slug：成功后回到列表，失败时把原因整体提示出来。 */
function handleTaxonomyUpdate({ kind, parse, update, flashKey }) {
  return asyncHandler(async (req, res) => {
    const parsed = parse(req.body);
    if (!parsed.ok) {
      const [firstError] = Object.values(parsed.errors);
      await renderTaxonomy(res, {
        status: 400,
        activeForm: kind,
        notice: firstError ?? "请检查输入内容",
      });
      return;
    }

    try {
      const updated = update(req.params.id, parsed.data);
      req.log.info(`admin.${kind}.updated`, { id: updated.id, slug: updated.slug });
      res.redirect(303, `/admin/taxonomy?flash=${flashKey}`);
    } catch (error) {
      if (isAppError(error)) {
        await renderTaxonomy(res, { status: error.statusCode, activeForm: kind, notice: error.message });
        return;
      }
      throw error;
    }
  });
}

router.post(
  "/admin/taxonomy/categories/:id",
  requireAdmin,
  handleTaxonomyUpdate({
    kind: "category",
    parse: parseCategoryInput,
    update: (id, data) => taxonomyService.updateCategory(id, data),
    flashKey: "category-updated",
  }),
);

router.post(
  "/admin/taxonomy/tags/:id",
  requireAdmin,
  handleTaxonomyUpdate({
    kind: "tag",
    parse: parseTagInput,
    update: (id, data) => taxonomyService.updateTag(id, data),
    flashKey: "tag-updated",
  }),
);

/** 删除：分类被文章占用时返回 409 并说明原因，不做静默解绑。 */
function handleTaxonomyDelete({ kind, remove, flashKey }) {
  return asyncHandler(async (req, res) => {
    try {
      const removed = remove(req.params.id);
      req.log.info(`admin.${kind}.deleted`, {
        id: removed.id,
        affectedPosts: removed.affectedPosts,
      });
      res.redirect(303, `/admin/taxonomy?flash=${flashKey}`);
    } catch (error) {
      if (isAppError(error)) {
        await renderTaxonomy(res, { status: error.statusCode, activeForm: kind, notice: error.message });
        return;
      }
      throw error;
    }
  });
}

router.post(
  "/admin/taxonomy/categories/:id/delete",
  requireAdmin,
  handleTaxonomyDelete({
    kind: "category",
    remove: (id) => taxonomyService.removeCategory(id),
    flashKey: "category-deleted",
  }),
);

router.post(
  "/admin/taxonomy/tags/:id/delete",
  requireAdmin,
  handleTaxonomyDelete({
    kind: "tag",
    remove: (id) => taxonomyService.removeTag(id),
    flashKey: "tag-deleted",
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
