import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  app,
  loginAs,
  cookieHeaderFrom,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
} from "./helpers/app.js";

test("未登录访问后台会跳转到登录页并带上 next", async () => {
  const res = await request(app).get("/admin?status=draft");
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/admin\/login\?next=/);
  assert.match(decodeURIComponent(res.headers.location), /next=\/admin\?status=draft/);
});

test("未登录调用后台接口返回 401 JSON", async () => {
  const res = await request(app)
    .post("/admin/api/preview")
    .type("form")
    .send({ content: "## hi" });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, "unauthorized");
});

test("缺少用户名或密码时返回 400 并提示", async () => {
  const res = await request(app)
    .post("/admin/login")
    .type("form")
    .send({ username: ADMIN_USERNAME, password: "" });
  assert.equal(res.status, 400);
  assert.match(res.text, /请填写用户名和密码/);
});

test("密码错误返回 401 且不回显密码", async () => {
  const res = await request(app)
    .post("/admin/login")
    .type("form")
    .send({ username: ADMIN_USERNAME, password: "wrong-password" });
  assert.equal(res.status, 401);
  assert.match(res.text, /用户名或密码不正确/);
  assert.doesNotMatch(res.text, /wrong-password/);
});

test("用户名不存在时与密码错误返回同样的提示", async () => {
  const res = await request(app)
    .post("/admin/login")
    .type("form")
    .send({ username: "nobody", password: ADMIN_PASSWORD });
  assert.equal(res.status, 401);
  assert.match(res.text, /用户名或密码不正确/);
});

test("登录成功写入 HttpOnly 会话 Cookie 并跳转到 next", async () => {
  const res = await request(app)
    .post("/admin/login")
    .type("form")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, next: "/admin?status=draft" });

  assert.equal(res.status, 303);
  assert.equal(res.headers.location, "/admin?status=draft");

  const setCookie = (res.headers["set-cookie"] ?? []).join(";");
  assert.match(setCookie, /daily_blog_admin=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
});

test("登录后可访问后台首页并在站点头部显示退出入口", async () => {
  const { cookie } = await loginAs();
  const res = await request(app).get("/admin").set("Cookie", cookie);

  assert.equal(res.status, 200);
  assert.match(res.text, /后台管理/);
  assert.match(res.text, /新建文章/);
  assert.match(res.text, /退出（admin）/);
});

test("已登录访问登录页直接回到后台", async () => {
  const { cookie } = await loginAs();
  const res = await request(app).get("/admin/login").set("Cookie", cookie);

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/admin");
});

test("next 参数只接受站内路径，避免开放重定向", async () => {
  const res = await request(app)
    .post("/admin/login")
    .type("form")
    .send({
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      next: "https://example.com/steal",
    });

  assert.equal(res.status, 303);
  assert.equal(res.headers.location, "/admin");
});

test("登出后会话失效，Cookie 被清除", async () => {
  const { cookie } = await loginAs();
  const before = await request(app).get("/admin").set("Cookie", cookie);
  assert.equal(before.status, 200);

  const logout = await request(app).post("/admin/logout").set("Cookie", cookie);
  assert.equal(logout.status, 303);
  assert.match((logout.headers["set-cookie"] ?? []).join(";"), /Max-Age=0/);

  const after = await request(app).get("/admin").set("Cookie", cookie);
  assert.equal(after.status, 302);
  assert.match(after.headers.location, /\/admin\/login/);
});

test("伪造的会话令牌不会被接受", async () => {
  const res = await request(app)
    .get("/admin")
    .set("Cookie", "daily_blog_admin=not-a-real-token");
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /\/admin\/login/);
  assert.equal(cookieHeaderFrom(res), "");
});
