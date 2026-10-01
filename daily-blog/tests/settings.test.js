import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app, loginAs } from "./helpers/app.js";

/** 后台用例统一走登录后的会话 Cookie。 */
async function adminCookie() {
  const { cookie } = await loginAs();
  return cookie;
}

/** 恢复默认配置，保证用例之间互不干扰（同一个测试库是共享的）。 */
async function resetSettings(cookie) {
  await request(app).post("/admin/settings/reset").set("Cookie", cookie);
}

test("未登录访问站点配置页会跳转登录页", async () => {
  const res = await request(app).get("/admin/settings");
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/admin\/login\?next=%2Fadmin%2Fsettings/);
});

test("站点配置页渲染当前生效值", async () => {
  const cookie = await adminCookie();
  const res = await request(app).get("/admin/settings").set("Cookie", cookie);
  assert.equal(res.status, 200);
  assert.match(res.text, /name="siteTitle"[^>]*value="每日迭代博客"/);
  assert.match(res.text, /name="siteAuthor"[^>]*value="admin"/);
  // 测试环境的每页条数通过环境变量固定为 2，页面应展示生效值而不是硬编码默认 10。
  assert.match(res.text, /name="pageSize"[^>]*value="2"/);
  assert.match(res.text, /name="feedMode"[\s\S]*?value="summary"[^>]*selected/);
  assert.match(res.text, /当前有 0 项已被自定义/);
});

test("保存的站点配置立即生效，无需重启", async () => {
  const cookie = await adminCookie();

  const saved = await request(app).post("/admin/settings").set("Cookie", cookie).type("form").send({
    siteTitle: "迭代中的博客",
    siteDescription: "每天一个小目标",
    siteAuthor: "zjkl",
    siteUrl: "",
    pageSize: "1",
    feedSize: "5",
    feedMode: "full",
    robotsNoindex: "on",
  });
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.location, "/admin/settings?flash=settings-saved");

  const home = await request(app).get("/");
  assert.match(home.text, /<title>首页 · 迭代中的博客<\/title>/);
  assert.match(home.text, /<meta name="robots" content="noindex, nofollow" \/>/);
  // 每页条数改成 1 之后，首页只应渲染一篇文章卡片。
  assert.equal((home.text.match(/class="post-card"/g) ?? []).length, 1);

  const feed = await request(app).get("/feed.xml");
  assert.match(feed.text, /<title>迭代中的博客<\/title>/);
  // 全文模式：渲染后的正文 HTML 被转义后放进 description。
  assert.match(feed.text, /&lt;h2&gt;/);

  const robots = await request(app).get("/robots.txt");
  assert.match(robots.text, /Disallow: \/\n/);
  assert.doesNotMatch(robots.text, /Disallow: \/admin/);

  await resetSettings(cookie);

  const restored = await request(app).get("/");
  assert.match(restored.text, /<title>首页 · 每日迭代博客<\/title>/);
  assert.match(restored.text, /<meta name="robots" content="index, follow" \/>/);
});

test("配置站点地址后 canonical 与其保持一致", async () => {
  const cookie = await adminCookie();

  await request(app).post("/admin/settings").set("Cookie", cookie).type("form").send({
    siteTitle: "每日迭代博客",
    siteDescription: "",
    siteAuthor: "admin",
    siteUrl: "https://blog.example.com",
    pageSize: "2",
    feedSize: "20",
    feedMode: "summary",
  });

  const home = await request(app).get("/");
  assert.match(home.text, /<link rel="canonical" href="https:\/\/blog.example.com\/" \/>/);

  const feed = await request(app).get("/feed.xml");
  assert.match(feed.text, /<link>https:\/\/blog\.example\.com\/<\/link>/);

  const sitemap = await request(app).get("/sitemap.xml");
  assert.match(sitemap.text, /<loc>https:\/\/blog\.example\.com\/<\/loc>/);

  await resetSettings(cookie);
});

test("站点标题为空时返回 400 并保留其它输入", async () => {
  const cookie = await adminCookie();
  const res = await request(app).post("/admin/settings").set("Cookie", cookie).type("form").send({
    siteTitle: "",
    siteDescription: "描述还在",
    siteAuthor: "admin",
    siteUrl: "",
    pageSize: "2",
    feedSize: "20",
    feedMode: "summary",
  });

  assert.equal(res.status, 400);
  assert.match(res.text, /站点标题不能为空/);
  assert.match(res.text, /描述还在/, "校验失败时应保留用户已填写的内容");
  await resetSettings(cookie);
});

test("超出范围的每页条数与非法站点地址都会被拒绝", async () => {
  const cookie = await adminCookie();

  const badPageSize = await request(app)
    .post("/admin/settings")
    .set("Cookie", cookie)
    .type("form")
    .send({
      siteTitle: "每日迭代博客",
      siteDescription: "",
      siteAuthor: "admin",
      siteUrl: "",
      pageSize: "0",
      feedSize: "20",
      feedMode: "summary",
    });
  assert.equal(badPageSize.status, 400);
  assert.match(badPageSize.text, /每页文章数必须在 1-100 之间/);

  const badUrl = await request(app)
    .post("/admin/settings")
    .set("Cookie", cookie)
    .type("form")
    .send({
      siteTitle: "每日迭代博客",
      siteDescription: "",
      siteAuthor: "admin",
      siteUrl: "example.com",
      pageSize: "2",
      feedSize: "20",
      feedMode: "summary",
    });
  assert.equal(badUrl.status, 400);
  assert.match(badUrl.text, /站点地址必须是 http\(s\):\/\/ 开头的地址/);

  await resetSettings(cookie);
});

test("恢复默认配置会清空全部自定义项", async () => {
  const cookie = await adminCookie();

  await request(app).post("/admin/settings").set("Cookie", cookie).type("form").send({
    siteTitle: "临时标题",
    siteDescription: "",
    siteAuthor: "admin",
    siteUrl: "",
    pageSize: "2",
    feedSize: "20",
    feedMode: "summary",
  });

  const before = await request(app).get("/admin/settings").set("Cookie", cookie);
  assert.match(before.text, /当前有 8 项已被自定义/);

  const reset = await request(app).post("/admin/settings/reset").set("Cookie", cookie);
  assert.equal(reset.status, 303);
  assert.equal(reset.headers.location, "/admin/settings?flash=settings-reset");

  const after = await request(app).get("/admin/settings").set("Cookie", cookie);
  assert.match(after.text, /当前有 0 项已被自定义/);
  assert.match(after.text, /name="siteTitle"[^>]*value="每日迭代博客"/);
});
