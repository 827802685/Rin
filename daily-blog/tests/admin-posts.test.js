import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app, loginAs } from "./helpers/app.js";

const { getDb } = await import("../src/db/index.js");

/** 直接查测试库以拿到 id 与原始字段，用于校验服务层写入结果。 */
function findPost(title) {
  return getDb()
    .prepare(
      `SELECT id, slug, title, summary, content_md, status, author, published_at, updated_at
       FROM posts WHERE title = ?`,
    )
    .get(title);
}

let counter = 0;
function uniqueTitle(prefix = "后台测试文章") {
  counter += 1;
  return `${prefix}-${process.pid}-${counter}`;
}

async function createPost(cookie, overrides = {}) {
  const title = overrides.title ?? uniqueTitle();
  const payload = {
    title,
    slug: overrides.slug ?? "",
    summary: overrides.summary ?? "",
    content: overrides.content ?? "## 后台测试正文\n\n- 第一条\n- 第二条",
    author: overrides.author ?? "admin",
    status: overrides.status ?? "draft",
  };
  const response = await request(app)
    .post("/admin/posts")
    .set("Cookie", cookie)
    .type("form")
    .send(payload);
  return { response, payload, row: findPost(title) };
}

test("新建草稿：前台列表与详情都不可见", async () => {
  const { cookie } = await loginAs();
  const { response, row } = await createPost(cookie, { status: "draft" });

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, "/admin?flash=created");
  assert.ok(row, "文章应已写入数据库");
  assert.equal(row.status, "draft");
  assert.equal(row.published_at, null);

  const home = await request(app).get("/");
  assert.equal(home.status, 200);
  assert.doesNotMatch(home.text, new RegExp(row.title));

  const detail = await request(app).get(`/posts/${row.slug}`);
  assert.equal(detail.status, 404);

  const dashboard = await request(app).get("/admin").set("Cookie", cookie);
  assert.match(dashboard.text, new RegExp(row.title));
  assert.match(dashboard.text, /草稿/);
});

test("发布后前台可见，详情页渲染 Markdown", async () => {
  const { cookie } = await loginAs();
  const { row } = await createPost(cookie, { status: "draft" });

  const publish = await request(app)
    .post(`/admin/posts/${row.id}/status`)
    .set("Cookie", cookie)
    .type("form")
    .send({ status: "published" });

  assert.equal(publish.status, 303);
  assert.equal(publish.headers.location, "/admin?flash=published");

  const published = findPost(row.title);
  assert.equal(published.status, "published");
  assert.ok(published.published_at, "首次发布应写入 published_at");

  const home = await request(app).get("/");
  assert.match(home.text, new RegExp(row.title));

  const detail = await request(app).get(`/posts/${row.slug}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /<h2>后台测试正文<\/h2>/);
});

test("转为草稿后前台再次不可见，且保留首次发布时间", async () => {
  const { cookie } = await loginAs();
  const { row } = await createPost(cookie, { status: "published" });
  const firstPublishedAt = findPost(row.title).published_at;
  assert.ok(firstPublishedAt);

  const unpublish = await request(app)
    .post(`/admin/posts/${row.id}/status`)
    .set("Cookie", cookie)
    .type("form")
    .send({ status: "draft" });

  assert.equal(unpublish.status, 303);
  assert.equal(unpublish.headers.location, "/admin?flash=drafted");

  const drafted = findPost(row.title);
  assert.equal(drafted.status, "draft");
  assert.equal(drafted.published_at, firstPublishedAt, "转草稿不应清空首次发布时间");

  const home = await request(app).get("/");
  assert.doesNotMatch(home.text, new RegExp(row.title));

  const detail = await request(app).get(`/posts/${row.slug}`);
  assert.equal(detail.status, 404);
});

test("重新发布不会覆盖首次发布时间", async () => {
  const { cookie } = await loginAs();
  const { row } = await createPost(cookie, { status: "published" });
  const firstPublishedAt = findPost(row.title).published_at;

  await request(app)
    .post(`/admin/posts/${row.id}/status`)
    .set("Cookie", cookie)
    .type("form")
    .send({ status: "draft" });
  await request(app)
    .post(`/admin/posts/${row.id}/status`)
    .set("Cookie", cookie)
    .type("form")
    .send({ status: "published" });

  const republished = findPost(row.title);
  assert.equal(republished.status, "published");
  assert.equal(republished.published_at, firstPublishedAt);
});

test("编辑文章：标题与正文更新，显式 slug 保持不变", async () => {
  const { cookie } = await loginAs();
  const { row } = await createPost(cookie, { status: "published", slug: `keep-slug-${Date.now()}` });
  const newTitle = `${row.title}-已编辑`;

  const response = await request(app)
    .post(`/admin/posts/${row.id}`)
    .set("Cookie", cookie)
    .type("form")
    .send({
      title: newTitle,
      slug: row.slug,
      summary: "手动摘要",
      content: "## 编辑后的正文\n\n内容已更新。",
      author: "admin",
      status: "published",
    });

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, "/admin?flash=updated");

  const edited = findPost(newTitle);
  assert.ok(edited);
  assert.equal(edited.id, row.id);
  assert.equal(edited.slug, row.slug);
  assert.equal(edited.summary, "手动摘要");
  assert.match(edited.content_md, /编辑后的正文/);

  const detail = await request(app).get(`/posts/${row.slug}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, new RegExp(newTitle));
});

test("摘要留空时前台自动截取正文", async () => {
  const { cookie } = await loginAs();
  const { row } = await createPost(cookie, {
    status: "published",
    summary: "",
    content: "## 无摘要文章\n\n这是一段用于自动摘要的正文内容。",
  });

  assert.equal(row.summary, "");
  const detail = await request(app).get(`/posts/${row.slug}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /用于自动摘要的正文内容/);
});

test("中文标题且 slug 留空时自动生成合法 slug", async () => {
  const { cookie } = await loginAs();
  const { row } = await createPost(cookie, { title: uniqueTitle("纯中文标题"), slug: "" });

  assert.match(row.slug, /^post-\d{8}-[0-9a-f]{6}$/);
});

test("slug 冲突返回 409，保留用户输入并提示", async () => {
  const { cookie } = await loginAs();
  const takenSlug = `taken-${Date.now()}`;
  await createPost(cookie, { slug: takenSlug });
  const { row: second } = await createPost(cookie, { slug: `another-${Date.now()}` });

  const response = await request(app)
    .post(`/admin/posts/${second.id}`)
    .set("Cookie", cookie)
    .type("form")
    .send({
      title: second.title,
      slug: takenSlug,
      summary: "",
      content: "## 冲突测试",
      author: "admin",
      status: "draft",
    });

  assert.equal(response.status, 409);
  assert.match(response.text, /slug 已被其他文章占用/);
  assert.match(response.text, new RegExp(takenSlug), "冲突时应回填用户填写的 slug");
});

test("标题为空或状态非法时返回 400 且不写库", async () => {
  const { cookie } = await loginAs();
  const title = uniqueTitle("不应写入");

  const emptyTitle = await request(app)
    .post("/admin/posts")
    .set("Cookie", cookie)
    .type("form")
    .send({ title: "", slug: "", summary: "", content: "## x", author: "admin", status: "draft" });
  assert.equal(emptyTitle.status, 400);
  assert.match(emptyTitle.text, /标题不能为空/);

  const badStatus = await request(app)
    .post("/admin/posts")
    .set("Cookie", cookie)
    .type("form")
    .send({ title, slug: "", summary: "", content: "## x", author: "admin", status: "archived" });
  assert.equal(badStatus.status, 400);
  assert.match(badStatus.text, /文章状态只能是/);

  assert.equal(findPost(title), undefined);
});

test("删除文章后后台与前台都不再出现", async () => {
  const { cookie } = await loginAs();
  const { row } = await createPost(cookie, { status: "published" });

  const response = await request(app)
    .post(`/admin/posts/${row.id}/delete`)
    .set("Cookie", cookie)
    .type("form")
    .send({});

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, "/admin?flash=deleted");
  assert.equal(findPost(row.title), undefined);

  const detail = await request(app).get(`/posts/${row.slug}`);
  assert.equal(detail.status, 404);

  const dashboard = await request(app).get("/admin").set("Cookie", cookie);
  assert.doesNotMatch(dashboard.text, new RegExp(row.title));
});

test("编辑不存在的文章返回 404", async () => {
  const { cookie } = await loginAs();
  const res = await request(app).get("/admin/posts/999999/edit").set("Cookie", cookie);
  assert.equal(res.status, 404);
});

test("Markdown 预览接口返回清洗后的 HTML", async () => {
  const { cookie } = await loginAs();
  const res = await request(app)
    .post("/admin/api/preview")
    .set("Cookie", cookie)
    .type("form")
    .send({ content: "## 预览标题\n\n<script>alert(1)</script>\n\n**加粗**" });

  assert.equal(res.status, 200);
  assert.match(res.body.html, /<h2>预览标题<\/h2>/);
  assert.match(res.body.html, /<strong>加粗<\/strong>/);
  assert.doesNotMatch(res.body.html, /<script/i);
  assert.ok(res.body.requestId);
});

test("未登录的写操作被拦截且不会写库", async () => {
  const title = uniqueTitle("越权写入");
  const res = await request(app)
    .post("/admin/posts")
    .type("form")
    .send({ title, slug: "", summary: "", content: "## x", author: "admin", status: "published" });

  assert.equal(res.status, 303);
  assert.match(res.headers.location, /\/admin\/login/);
  assert.equal(findPost(title), undefined);
});

test("后台列表支持按状态筛选", async () => {
  const { cookie } = await loginAs();
  const { row } = await createPost(cookie, { title: uniqueTitle("筛选草稿"), status: "draft" });

  const drafts = await request(app).get("/admin?status=draft").set("Cookie", cookie);
  assert.equal(drafts.status, 200);
  assert.match(drafts.text, new RegExp(row.title));

  const onlyDrafts = getDb().prepare("SELECT COUNT(*) AS total FROM posts").get().total;
  assert.ok(onlyDrafts > 0);

  const badFilter = await request(app).get("/admin?status=unknown").set("Cookie", cookie);
  assert.equal(badFilter.status, 200, "非法筛选值应被忽略而不是报错");
});
