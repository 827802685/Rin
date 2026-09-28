import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app, loginAs } from "./helpers/app.js";

const { getDb } = await import("../src/db/index.js");
const { config } = await import("../src/config.js");

const MAX_TAGS = config.site.maxTagsPerPost;

function findCategory(slug) {
  return getDb().prepare("SELECT id, slug, name, description FROM categories WHERE slug = ?").get(slug);
}

function findTag(slug) {
  return getDb().prepare("SELECT id, slug, name FROM tags WHERE slug = ?").get(slug);
}

function findPost(title) {
  return getDb().prepare("SELECT id, slug, title, status FROM posts WHERE title = ?").get(title);
}

function categoryLinkOf(postId) {
  return getDb().prepare("SELECT category_id FROM post_categories WHERE post_id = ?").get(postId);
}

function tagNamesOf(postId) {
  return getDb()
    .prepare(
      `SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
       WHERE pt.post_id = ? ORDER BY t.name COLLATE NOCASE`,
    )
    .all(postId)
    .map((row) => row.name);
}

let counter = 0;
function unique(prefix) {
  counter += 1;
  return `${prefix}-${process.pid}-${counter}`;
}

async function createCategory(cookie, overrides = {}) {
  const name = overrides.name ?? unique("测试分类");
  const response = await request(app)
    .post("/admin/taxonomy/categories")
    .set("Cookie", cookie)
    .type("form")
    .send({ name, slug: overrides.slug ?? "", description: overrides.description ?? "" });
  return { response, name };
}

async function createTag(cookie, overrides = {}) {
  const name = overrides.name ?? unique("测试标签");
  const response = await request(app)
    .post("/admin/taxonomy/tags")
    .set("Cookie", cookie)
    .type("form")
    .send({ name, slug: overrides.slug ?? "" });
  return { response, name };
}

function postPayload(overrides = {}) {
  return {
    title: overrides.title ?? unique("分类标签文章"),
    slug: overrides.slug ?? "",
    summary: overrides.summary ?? "",
    content: overrides.content ?? "## 分类标签测试正文",
    author: "admin",
    status: overrides.status ?? "draft",
    categoryId: overrides.categoryId ?? "",
    tags: overrides.tags ?? "",
  };
}

async function createPost(cookie, overrides = {}) {
  const payload = postPayload(overrides);
  const response = await request(app)
    .post("/admin/posts")
    .set("Cookie", cookie)
    .type("form")
    .send(payload);
  return { response, payload, row: findPost(payload.title) };
}

// ---------- 鉴权 ----------

test("未登录访问后台分类标签页会跳转登录", async () => {
  const res = await request(app).get("/admin/taxonomy");
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/admin\/login\?next=/);
});

test("未登录的分类写操作被拦截且不写库", async () => {
  const name = unique("越权分类");
  const res = await request(app)
    .post("/admin/taxonomy/categories")
    .type("form")
    .send({ name, slug: "", description: "" });

  assert.equal(res.status, 303);
  assert.match(res.headers.location, /\/admin\/login/);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS t FROM categories WHERE name = ?").get(name).t, 0);
});

// ---------- 分类 ----------

test("新建分类：中文名称直接作为 slug 并出现在前台", async () => {
  const { cookie } = await loginAs();
  const { response, name } = await createCategory(cookie, {
    name: "技术笔记",
    slug: "",
    description: "技术相关的内容",
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, "/admin/taxonomy?flash=category-created");

  const row = findCategory("技术笔记");
  assert.ok(row, "纯中文名称应保留为 slug，而不是被削成空串");
  assert.equal(row.name, "技术笔记");

  const overview = await request(app).get("/categories");
  assert.match(overview.text, /href="\/categories\/%E6%8A%80%E6%9C%AF%E7%AC%94%E8%AE%B0"/);
  assert.match(overview.text, />技术笔记<\/a>/);
});

test("分类名称为空或重复时给出明确错误", async () => {
  const { cookie } = await loginAs();

  const empty = await request(app)
    .post("/admin/taxonomy/categories")
    .set("Cookie", cookie)
    .type("form")
    .send({ name: "", slug: "", description: "" });
  assert.equal(empty.status, 400);
  assert.match(empty.text, /分类名称不能为空/);

  const name = unique("重复分类");
  const first = await createCategory(cookie, { name });
  assert.equal(first.response.status, 303);

  const duplicate = await request(app)
    .post("/admin/taxonomy/categories")
    .set("Cookie", cookie)
    .type("form")
    .send({ name, slug: "", description: "" });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.text, /分类名称已存在/);
  assert.match(duplicate.text, new RegExp(name), "冲突时应回填用户输入的名称");
});

test("显式填写的分类 slug 冲突返回 409", async () => {
  const { cookie } = await loginAs();
  const slug = unique("cat-taken");

  await createCategory(cookie, { name: unique("占用分类"), slug });
  const conflict = await createCategory(cookie, { name: unique("新分类"), slug });

  assert.equal(conflict.response.status, 409);
  assert.match(conflict.response.text, /分类 slug 已被占用/);
});

test("重命名分类后前台链接同步更新", async () => {
  const { cookie } = await loginAs();
  const before = unique("rename-before");
  await createCategory(cookie, { name: unique("改名前"), slug: before });
  const row = findCategory(before);

  const response = await request(app)
    .post(`/admin/taxonomy/categories/${row.id}`)
    .set("Cookie", cookie)
    .type("form")
    .send({ name: "改名后的分类", slug: unique("rename-after"), description: "已更新" });

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, "/admin/taxonomy?flash=category-updated");
  assert.equal(findCategory(before), undefined, "旧 slug 不应继续存在");
  const renamed = getDb().prepare("SELECT name, description FROM categories WHERE id = ?").get(row.id);
  assert.equal(renamed.name, "改名后的分类");
  assert.equal(renamed.description, "已更新");
});

test("分类下仍有文章时禁止删除，并说明原因", async () => {
  const { cookie } = await loginAs();
  const slug = unique("in-use-cat");
  await createCategory(cookie, { name: unique("在用分类"), slug });
  const category = findCategory(slug);

  const { row } = await createPost(cookie, {
    status: "published",
    categoryId: String(category.id),
  });
  assert.equal(categoryLinkOf(row.id).category_id, category.id);

  const response = await request(app)
    .post(`/admin/taxonomy/categories/${category.id}/delete`)
    .set("Cookie", cookie)
    .type("form")
    .send({});

  assert.equal(response.status, 409);
  assert.match(response.text, /还有 1 篇文章/);
  assert.ok(findCategory(slug), "分类应仍然存在");
  assert.equal(categoryLinkOf(row.id).category_id, category.id);
});

test("删除空分类成功，前台不再出现", async () => {
  const { cookie } = await loginAs();
  const slug = unique("empty-cat");
  await createCategory(cookie, { name: unique("空分类"), slug });
  const category = findCategory(slug);

  const response = await request(app)
    .post(`/admin/taxonomy/categories/${category.id}/delete`)
    .set("Cookie", cookie)
    .type("form")
    .send({});

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, "/admin/taxonomy?flash=category-deleted");
  assert.equal(findCategory(slug), undefined);

  const overview = await request(app).get("/categories");
  assert.doesNotMatch(overview.text, new RegExp(slug));
});

// ---------- 标签 ----------

test("新建标签：中文名称作为 slug，重复名称返回 409", async () => {
  const { cookie } = await loginAs();
  const { response, name } = await createTag(cookie, { name: "前端工程", slug: "" });

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, "/admin/taxonomy?flash=tag-created");
  assert.ok(findTag("前端工程"), "标签中文名称同样直接作为 slug");

  const duplicate = await request(app)
    .post("/admin/taxonomy/tags")
    .set("Cookie", cookie)
    .type("form")
    .send({ name: "前端工程", slug: "" });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.text, /标签名称已存在/);

  assert.ok(name);
});

test("删除标签只解除关联，不影响文章本身", async () => {
  const { cookie } = await loginAs();
  const { row } = await createPost(cookie, { status: "published", tags: "临时标签" });
  const tag = findTag("临时标签");
  assert.ok(tag);
  assert.deepEqual(tagNamesOf(row.id), ["临时标签"]);

  const response = await request(app)
    .post(`/admin/taxonomy/tags/${tag.id}/delete`)
    .set("Cookie", cookie)
    .type("form")
    .send({});

  assert.equal(response.status, 303);
  assert.equal(response.headers.location, "/admin/taxonomy?flash=tag-deleted");
  assert.equal(findTag("临时标签"), undefined);
  assert.ok(findPost(row.title), "文章不应被连带删除");
  assert.deepEqual(tagNamesOf(row.id), []);

  const detail = await request(app).get(`/posts/${row.slug}`);
  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.text, /临时标签/);
});

// ---------- 文章与分类标签的关联 ----------

test("文章可设置分类与多个标签，重复标签自动去重", async () => {
  const { cookie } = await loginAs();
  const slug = unique("post-cat");
  await createCategory(cookie, { name: unique("文章分类"), slug });
  const category = findCategory(slug);

  const { response, row } = await createPost(cookie, {
    status: "published",
    categoryId: String(category.id),
    tags: "测试, 自动验证, 测试",
  });

  assert.equal(response.status, 303);
  assert.equal(categoryLinkOf(row.id).category_id, category.id);
  assert.deepEqual(tagNamesOf(row.id), ["测试", "自动验证"], "重复标签应只保留一条");

  const detail = await request(app).get(`/posts/${row.slug}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, new RegExp(`href="/categories/${slug}"`));
  assert.match(detail.text, />测试<\/a>/);
  assert.match(detail.text, />自动验证<\/a>/);

  const editPage = await request(app).get(`/admin/posts/${row.id}/edit`).set("Cookie", cookie);
  assert.match(editPage.text, /value="测试, 自动验证"/, "编辑页应回填已有标签");
  assert.match(editPage.text, new RegExp(`<option value="${category.id}" selected`));
});

test("编辑文章时清空分类会解除关联", async () => {
  const { cookie } = await loginAs();
  const slug = unique("clear-cat");
  await createCategory(cookie, { name: unique("待清空分类"), slug });
  const category = findCategory(slug);

  const { row } = await createPost(cookie, {
    status: "published",
    categoryId: String(category.id),
    tags: "保留标签",
  });

  const response = await request(app)
    .post(`/admin/posts/${row.id}`)
    .set("Cookie", cookie)
    .type("form")
    .send({ ...postPayload({ title: row.title, status: "published", categoryId: "", tags: "保留标签" }) });

  assert.equal(response.status, 303);
  assert.equal(categoryLinkOf(row.id), undefined, "清空分类后关联应被删除");
  assert.deepEqual(tagNamesOf(row.id), ["保留标签"]);
});

test("标签数量超过上限返回 400 且不写库", async () => {
  const { cookie } = await loginAs();
  const title = unique("超限标签");
  const tags = Array.from({ length: MAX_TAGS + 1 }, (_, index) => `t${index}`).join(",");

  const response = await request(app)
    .post("/admin/posts")
    .set("Cookie", cookie)
    .type("form")
    .send(postPayload({ title, tags }));

  assert.equal(response.status, 400);
  assert.match(response.text, new RegExp(`最多设置 ${MAX_TAGS} 个标签`));
  assert.equal(findPost(title), undefined, "校验失败不应写入文章");
  assert.equal(findTag("t0"), undefined, "校验失败不应顺手创建标签");
});

test("草稿的分类不计入前台分类页与计数", async () => {
  const { cookie } = await loginAs();
  const slug = unique("draft-only-cat");
  await createCategory(cookie, { name: unique("草稿分类"), slug });
  const category = findCategory(slug);

  const { row } = await createPost(cookie, { status: "draft", categoryId: String(category.id) });
  assert.equal(categoryLinkOf(row.id).category_id, category.id);

  const page = await request(app).get(`/categories/${slug}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /共 0 篇已发布文章/);
  assert.doesNotMatch(page.text, new RegExp(row.title));

  const overview = await request(app).get("/categories");
  assert.match(overview.text, />0 篇<\/span>/, "草稿不应计入前台分类计数");
});

test("后台分类标签页展示使用计数与前台链接", async () => {
  const { cookie } = await loginAs();
  const res = await request(app).get("/admin/taxonomy").set("Cookie", cookie);

  assert.equal(res.status, 200);
  assert.match(res.text, /分类与标签/);
  assert.match(res.text, /daily-iteration/);
  assert.match(res.text, /篇文章/);
  assert.match(res.text, /href="\/categories\/daily-iteration"/);
});
