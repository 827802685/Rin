import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createIsolatedApp } from "./helpers/isolated-app.js";

/**
 * CSRF 防护用例。
 *
 * 这里是唯一让 CSRF 保持**默认开启**的用例文件：
 * Day 1-6 的业务用例都关掉了它（见 tests/helpers/app.js 的说明），
 * 因此「真实环境下写请求到底挡不挡得住」只能由本文件证明。
 */
const { app, db } = await createIsolatedApp({
  tag: "csrf",
  withSeed: true,
  env: { RATE_LIMIT_ENABLED: "false" },
});

const ADMIN = { username: "admin", password: "test-password-123" };

/** 打开一个页面，同时取回令牌 Cookie 与页面里的令牌值。 */
async function openPage(path, cookie = "") {
  const req = request(app).get(path);
  if (cookie) {
    req.set("Cookie", cookie);
  }
  const res = await req;

  const csrfCookie = (res.headers["set-cookie"] ?? [])
    .map((line) => line.split(";")[0])
    .find((line) => line.startsWith("daily_blog_csrf="));
  const meta = /<meta name="csrf-token" content="([^"]*)"/.exec(res.text);

  return {
    res,
    cookie: csrfCookie ?? cookie,
    token: meta ? meta[1] : "",
  };
}

/** 按后台流程登录，返回可直接用于写请求的完整 Cookie。 */
async function login(cookie, token) {
  const res = await request(app)
    .post("/admin/login")
    .set("Cookie", cookie)
    .type("form")
    .send({ ...ADMIN, _csrf: token });
  assert.equal(res.status, 303);

  const session = (res.headers["set-cookie"] ?? [])
    .map((line) => line.split(";")[0])
    .find((line) => line.startsWith("daily_blog_admin="));
  return `${cookie}; ${session}`;
}

function postCount() {
  return db.prepare("SELECT COUNT(*) AS total FROM posts").get().total;
}

test("读请求会下发 HttpOnly 的令牌 Cookie，并在 meta 里给出同一个令牌", async () => {
  const page = await openPage("/");

  assert.equal(page.res.status, 200);
  assert.match(page.cookie, /^daily_blog_csrf=/);
  assert.ok(page.token.length > 0, "页面里应当能取到令牌");

  const setCookie = (page.res.headers["set-cookie"] ?? []).find((line) =>
    line.includes("daily_blog_csrf"),
  );
  assert.match(setCookie, /HttpOnly/, "令牌 Cookie 必须对脚本不可读");
  assert.match(setCookie, /SameSite=Lax/);
});

test("表单里渲染了 _csrf 隐藏字段", async () => {
  const page = await openPage("/admin/login");
  assert.match(page.res.text, /name="_csrf"/);
  assert.match(page.res.text, new RegExp(`value="${page.token}"`));
});

test("缺少令牌的写请求被拒绝，且不落库", async () => {
  const before = postCount();
  const res = await request(app)
    .post("/admin/posts")
    .type("form")
    .send({ title: "跨站提交的文章", content: "正文", status: "draft" });

  assert.equal(res.status, 403);
  assert.match(res.text, /表单已过期或来源不可信/);
  assert.equal(postCount(), before, "被拒绝的提交绝不能写进数据库");
});

test("Cookie 与表单令牌不一致时拒绝", async () => {
  const page = await openPage("/admin/login");
  // 攻击者能拿到自己的令牌，但塞不进受害者的浏览器 Cookie；
  // 这里用「受害者的 Cookie + 攻击者猜的令牌」模拟这个错配。
  const forgedCookie = "daily_blog_csrf=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const res = await request(app)
    .post("/admin/login")
    .set("Cookie", forgedCookie)
    .type("form")
    .send({ ...ADMIN, _csrf: page.token });

  assert.equal(res.status, 403);
});

test("令牌一致时写请求正常放行", async () => {
  const loginPage = await openPage("/admin/login");
  const sessionCookie = await login(loginPage.cookie, loginPage.token);

  const formPage = await openPage("/admin/posts/new", sessionCookie);
  const before = postCount();

  const res = await request(app)
    .post("/admin/posts")
    .set("Cookie", formPage.cookie.includes("daily_blog_csrf") ? formPage.cookie : sessionCookie)
    .type("form")
    .send({
      _csrf: formPage.token,
      title: "CSRF 用例创建的第一篇文章",
      content: "正文内容。",
      status: "draft",
    });

  assert.equal(res.status, 303);
  assert.equal(postCount(), before + 1);
});

test("fetch 可以用 X-CSRF-Token 头代替隐藏字段", async () => {
  const loginPage = await openPage("/admin/login");
  const sessionCookie = await login(loginPage.cookie, loginPage.token);

  const res = await request(app)
    .post("/admin/api/preview")
    .set("Cookie", sessionCookie)
    .set("X-CSRF-Token", loginPage.token)
    .type("form")
    .send({ content: "## 预览标题" });

  assert.equal(res.status, 200);
  assert.match(res.body.html, /<h2[^>]*>预览标题<\/h2>/);
});

test("游客评论表单同样受保护", async () => {
  const post = db.prepare("SELECT slug FROM posts WHERE status = 'published' LIMIT 1").get();
  const page = await openPage(`/posts/${post.slug}`);

  const noToken = await request(app)
    .post(`/posts/${post.slug}/comments`)
    .type("form")
    .send({ authorName: "跨站脚本", content: "这是一条来自跨站表单的评论内容。" });
  assert.equal(noToken.status, 403);

  const withToken = await request(app)
    .post(`/posts/${post.slug}/comments`)
    .set("Cookie", page.cookie)
    .type("form")
    .send({
      _csrf: page.token,
      authorName: "正常访客",
      content: "这是一条带着令牌的合法评论内容。",
    });
  assert.equal(withToken.status, 303);
});

test("读请求不需要令牌", async () => {
  const res = await request(app).get("/archive");
  assert.equal(res.status, 200);
});
