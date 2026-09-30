import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app, loginAs } from "./helpers/app.js";
import { commentsService } from "../src/services/comments.service.js";

const POST_SLUG = "hello-daily-blog";

function submitComment(fields = {}) {
  return request(app)
    .post(`/posts/${POST_SLUG}/comments`)
    .type("form")
    .send({ authorName: "审核流程测试", content: "这条评论会走一遍完整的审核流程。", ...fields });
}

/** 后台列表里按内容定位一条评论，避免依赖自增 id。 */
function findCommentByContent(content, status = null) {
  const { items } = commentsService.listForAdmin({ pageSize: 200, status });
  const found = items.find((item) => item.content === content);
  assert.ok(found, `后台列表里应能找到评论：${content}`);
  return found;
}

test("未登录访问评论审核页会跳转登录页并带上回跳地址", async () => {
  const res = await request(app).get("/admin/comments");

  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/admin\/login\?next=/);
  assert.match(res.headers.location, /comments/);
});

test("登录后可查看审核列表，待审评论排在最前", async () => {
  const { cookie } = await loginAs();

  const res = await request(app).get("/admin/comments").set("Cookie", cookie);

  assert.equal(res.status, 200);
  assert.match(res.text, /评论审核/);
  assert.match(res.text, /待审 1/, "示例数据里应有 1 条待审评论");
  assert.match(res.text, /小明/);
  assert.match(res.text, /badge--comment-pending/);
  assert.match(res.text, /通过/);
  assert.match(res.text, /拒绝/);
});

test("按状态筛选只显示对应状态的评论", async () => {
  const { cookie } = await loginAs();

  const pending = await request(app).get("/admin/comments?status=pending").set("Cookie", cookie);
  assert.equal(pending.status, 200);
  assert.match(pending.text, /小明/);
  assert.doesNotMatch(pending.text, /低价建站推广/, "已拒绝的评论不应出现在待审筛选里");

  const rejected = await request(app).get("/admin/comments?status=rejected").set("Cookie", cookie);
  assert.equal(rejected.status, 200);
  assert.match(rejected.text, /低价建站推广/);
  assert.doesNotMatch(rejected.text, /小明/);
});

test("审核通过后评论出现在前台，后台给出提示", async () => {
  const { cookie } = await loginAs();
  const content = "通过审核之后这条评论应该立刻在前台可见。";
  await submitComment({ content });
  const comment = findCommentByContent(content, "pending");

  const res = await request(app)
    .post(`/admin/comments/${comment.id}/status`)
    .set("Cookie", cookie)
    .type("form")
    .send({ status: "approved" });

  assert.equal(res.status, 303);
  assert.equal(res.headers.location, "/admin/comments?flash=comment-approved");

  const list = await request(app)
    .get("/admin/comments?flash=comment-approved")
    .set("Cookie", cookie);
  assert.match(list.text, /评论已通过/);

  const detail = await request(app).get(`/posts/${POST_SLUG}`);
  assert.match(detail.text, /通过审核之后这条评论应该立刻在前台可见/);

  assert.equal(commentsService.countByStatus().approved > 0, true);
});

test("拒绝后评论不会出现在前台", async () => {
  const { cookie } = await loginAs();
  const content = "这条评论会被管理员拒绝，前台不应看到。";
  await submitComment({ content });
  const comment = findCommentByContent(content, "pending");

  const res = await request(app)
    .post(`/admin/comments/${comment.id}/status`)
    .set("Cookie", cookie)
    .type("form")
    .send({ status: "rejected" });

  assert.equal(res.status, 303);
  assert.equal(res.headers.location, "/admin/comments?flash=comment-rejected");

  const detail = await request(app).get(`/posts/${POST_SLUG}`);
  assert.doesNotMatch(detail.text, /这条评论会被管理员拒绝，前台不应看到/);

  const rejected = findCommentByContent(content, "rejected");
  assert.equal(rejected.status, "rejected");
});

test("审核记录审核人与审核时间", async () => {
  const { cookie } = await loginAs();
  const content = "这条评论用来验证审核人会记在评论上。";
  await submitComment({ content });
  const comment = findCommentByContent(content, "pending");

  await request(app)
    .post(`/admin/comments/${comment.id}/status`)
    .set("Cookie", cookie)
    .type("form")
    .send({ status: "approved" });

  const { items } = commentsService.listForAdmin({ pageSize: 200 });
  const moderated = items.find((item) => item.id === comment.id);
  assert.equal(moderated.status, "approved");
  assert.equal(moderated.moderator, "admin", "审核人应记录为当前登录管理员");
  assert.ok(moderated.moderatedAt, "应写入审核时间");
});

test("删除评论后从审核列表消失", async () => {
  const { cookie } = await loginAs();
  const content = "这条评论随后会被删除。";
  await submitComment({ content });
  const comment = findCommentByContent(content, "pending");

  const res = await request(app)
    .post(`/admin/comments/${comment.id}/delete`)
    .set("Cookie", cookie)
    .type("form")
    .send({});

  assert.equal(res.status, 303);
  assert.equal(res.headers.location, "/admin/comments?flash=comment-deleted");

  const { items } = commentsService.listForAdmin({ pageSize: 200 });
  assert.equal(
    items.some((item) => item.id === comment.id),
    false,
  );
});

test("审核为非法状态或改回待审都返回 400", async () => {
  const { cookie } = await loginAs();
  const content = "这条评论用来验证非法审核状态会被拦下。";
  await submitComment({ content });
  const comment = findCommentByContent(content, "pending");

  const invalid = await request(app)
    .post(`/admin/comments/${comment.id}/status`)
    .set("Cookie", cookie)
    .type("form")
    .send({ status: "whatever" });
  assert.equal(invalid.status, 400);
  assert.match(invalid.text, /评论状态只能是/);

  const backToPending = await request(app)
    .post(`/admin/comments/${comment.id}/status`)
    .set("Cookie", cookie)
    .type("form")
    .send({ status: "pending" });
  assert.equal(backToPending.status, 400);
  assert.match(backToPending.text, /审核结果只能是 通过 或 拒绝/);
});

test("审核不存在的评论返回 404", async () => {
  const { cookie } = await loginAs();

  const res = await request(app)
    .post("/admin/comments/999999/status")
    .set("Cookie", cookie)
    .type("form")
    .send({ status: "approved" });

  assert.equal(res.status, 404);
  assert.match(res.text, /评论不存在/);
});

test("后台首页显示待审评论数量的入口角标", async () => {
  const { cookie } = await loginAs();

  const res = await request(app).get("/admin").set("Cookie", cookie);

  assert.equal(res.status, 200);
  assert.match(res.text, /href="\/admin\/comments"/);
  assert.match(res.text, /评论审核（\d+ 待审）/, "有待审评论时入口应带数量角标");
});
