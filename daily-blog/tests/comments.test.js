import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./helpers/app.js";
import { postsService } from "../src/services/posts.service.js";
import { commentsService } from "../src/services/comments.service.js";

const POST_SLUG = "hello-daily-blog";

/** 提交评论：默认一份合法输入，用例只需覆盖要改的字段。 */
function submitComment(slug, fields = {}) {
  return request(app)
    .post(`/posts/${slug}/comments`)
    .type("form")
    .send({ authorName: "测试读者", content: "这是一条用于测试的正经评论内容。", ...fields });
}

/** 取最近一条评论（按 id 倒序），用于审核后回查状态。 */
function latestComment() {
  const { items } = commentsService.listForAdmin({ pageSize: 1 });
  assert.ok(items.length > 0, "评论表里应至少有一条记录");
  return items[0];
}

function postIdBySlug(slug) {
  const { items } = postsService.listPublished({ pageSize: 100 });
  const found = items.find((item) => item.slug === slug);
  assert.ok(found, `示例文章 ${slug} 应存在`);
  return found.id;
}

test("详情页展示已通过评论，待审与已拒绝的不出现", async () => {
  const res = await request(app).get(`/posts/${POST_SLUG}`);

  assert.equal(res.status, 200);
  assert.match(res.text, /id="comments"/);
  assert.match(res.text, /路过的读者/, "已通过评论应展示");
  assert.doesNotMatch(res.text, /请问评论提交之后是立刻可见的吗/, "待审评论不应展示");
  assert.doesNotMatch(res.text, /低价建站推广/, "已拒绝评论不应展示");
});

test("首页与详情页显示已通过评论的条数", async () => {
  const postId = postIdBySlug(POST_SLUG);
  const count = commentsService.countApprovedForPost(postId);

  const detail = await request(app).get(`/posts/${POST_SLUG}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, new RegExp(`<a href="#comments">${count} 条评论</a>`));

  const home = await request(app).get("/");
  assert.equal(home.status, 200);
  assert.match(home.text, new RegExp(`<span>${count} 条评论</span>`));
});

test("游客提交评论后进入待审，前台详情页暂不显示", async () => {
  const before = commentsService.countByStatus().total;

  const res = await submitComment(POST_SLUG, {
    authorName: "待审测试",
    content: "这条评论提交后应该进入待审队列。",
  });

  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/posts/${POST_SLUG}?comment=submitted#comments`);
  assert.equal(commentsService.countByStatus().total, before + 1, "评论应已落库");

  const detail = await request(app).get(`/posts/${POST_SLUG}?comment=submitted`);
  assert.match(detail.text, /评论已提交，通过审核后会显示在这里/);
  assert.doesNotMatch(detail.text, /这条评论提交后应该进入待审队列/, "待审评论不应出现在前台");
});

test("审核通过的评论立即出现在详情页", async () => {
  await submitComment(POST_SLUG, {
    authorName: "通过测试",
    content: "这条评论会被管理员审核通过。",
  });
  const comment = latestComment();
  assert.equal(comment.status, "pending");

  const detailBefore = await request(app).get(`/posts/${POST_SLUG}`);
  assert.doesNotMatch(detailBefore.text, /这条评论会被管理员审核通过/);

  commentsService.moderate(comment.id, "approved", null);

  const detailAfter = await request(app).get(`/posts/${POST_SLUG}`);
  assert.equal(detailAfter.status, 200);
  assert.match(detailAfter.text, /这条评论会被管理员审核通过/);
  assert.match(detailAfter.text, /通过测试/);
});

test("昵称为空返回 400 并在表单上给出提示", async () => {
  const res = await submitComment(POST_SLUG, { authorName: "" });

  assert.equal(res.status, 400);
  assert.match(res.text, /请修正表单中标记的问题后重新提交/);
  assert.match(res.text, /请填写昵称/);
});

test("评论内容过短或过长都返回 400", async () => {
  const tooShort = await submitComment(POST_SLUG, { content: "好" });
  assert.equal(tooShort.status, 400);
  assert.match(tooShort.text, /评论内容至少 2 个字符/);

  const tooLong = await submitComment(POST_SLUG, { content: "长".repeat(1001) });
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.text, /评论内容最长 1000 个字符/);
});

test("邮箱格式不合法返回 400，邮箱可留空", async () => {
  const invalid = await submitComment(POST_SLUG, { authorEmail: "not-an-email" });
  assert.equal(invalid.status, 400);
  assert.match(invalid.text, /邮箱格式不正确/);

  const empty = await submitComment(POST_SLUG, {
    authorEmail: "",
    content: "邮箱留空的这条评论应该能提交成功。",
  });
  assert.equal(empty.status, 303);
});

test("网址缺少 http(s) 前缀返回 400", async () => {
  const res = await submitComment(POST_SLUG, { authorUrl: "example.com" });

  assert.equal(res.status, 400);
  assert.match(res.text, /网址必须以 http:\/\/ 或 https:\/\/ 开头/);
});

test("填写蜜罐字段判定为脚本：对外伪成功但不落库", async () => {
  const before = commentsService.countByStatus().total;

  const res = await submitComment(POST_SLUG, {
    authorName: "spam-bot",
    content: "这条来自脚本的评论不应该被写进数据库。",
    homepage: "http://spam.example.com",
  });

  assert.equal(res.status, 303, "对外伪装成成功，避免脚本据此更换策略");
  assert.equal(
    commentsService.countByStatus().total,
    before,
    "蜜罐命中的提交不应写入数据库",
  );

  const detail = await request(app).get(`/posts/${POST_SLUG}`);
  assert.doesNotMatch(detail.text, /这条来自脚本的评论不应该被写进数据库/);
});

test("窗口期内重复提交相同内容返回 409", async () => {
  const content = "重复内容检测用的评论，两次提交应该被拦下一次。";

  const first = await submitComment(POST_SLUG, { content });
  assert.equal(first.status, 303);

  const second = await submitComment(POST_SLUG, { content });
  assert.equal(second.status, 409);
  assert.match(second.text, /你刚刚已经提交过这条评论了/);
});

test("评论内容里的 HTML 被转义，不会注入页面", async () => {
  await submitComment(POST_SLUG, {
    authorName: "转义测试",
    content: "<script>alert(1)</script> 这条评论用来验证 HTML 转义。",
  });
  commentsService.moderate(latestComment().id, "approved", null);

  const res = await request(app).get(`/posts/${POST_SLUG}`);

  assert.equal(res.status, 200);
  assert.match(res.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
});

test("草稿文章与不存在的文章都不接受评论，返回 404", async () => {
  const draft = postsService.createPost({
    title: "草稿文章不接受评论",
    content: "正文内容，用来验证草稿不接受评论。",
    status: "draft",
  });

  const draftRes = await submitComment(draft.slug);
  assert.equal(draftRes.status, 404);
  assert.match(draftRes.text, /不存在|未发布/);

  const missing = await submitComment("no-such-post-for-comments");
  assert.equal(missing.status, 404);

  postsService.removePost(draft.id);
});
