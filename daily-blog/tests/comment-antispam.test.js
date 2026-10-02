import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createIsolatedApp } from "./helpers/isolated-app.js";

/**
 * 防灌水用例：频率限制、重复内容、外链上限都依赖配置项取不同值，
 * 因此用独立进程 + 独立数据库 + 独立环境变量启动一个应用实例。
 * 这里的 COMMENT_RATE_LIMIT=2 与默认 3 不同，正是为了验证配置真的生效。
 */
const { app, db } = await createIsolatedApp({
  tag: "comment-antispam",
  env: {
    COMMENT_RATE_LIMIT: "2",
    COMMENT_RATE_WINDOW_MINUTES: "10",
    COMMENT_MAX_LINKS: "1",
    // Day 7 之后每个写请求都要先取表单令牌。本文件验证的是防灌水规则，
    // 让每个用例都先跑一遍「取令牌」只会把断言主体挤走；CSRF 自身有 tests/csrf.test.js 覆盖。
    CSRF_ENABLED: "false",
  },
});

// 环境变量必须在导入配置模块之后才能安全导入这些模块，因此使用动态 import。
const { postsRepository } = await import("../src/repositories/posts.repository.js");
const { commentsService } = await import("../src/services/comments.service.js");

const POST_A = "antispam-post-a";
const POST_B = "antispam-post-b";

postsRepository.insert({
  slug: POST_A,
  title: "反灌水测试文章 A",
  summary: "",
  contentMd: "正文内容。",
  status: "published",
  author: "admin",
});
postsRepository.insert({
  slug: POST_B,
  title: "反灌水测试文章 B",
  summary: "",
  contentMd: "正文内容。",
  status: "published",
  author: "admin",
});

/** 提交评论：默认一份合法输入。 */
function submit(slug, fields = {}) {
  return request(app)
    .post(`/posts/${slug}/comments`)
    .type("form")
    .send({ authorName: "限流测试", content: "这是一条用于限流测试的评论内容。", ...fields });
}

/** 把已提交的评论挤出时间窗口，让后续用例重新拥有额度（也顺带验证窗口逻辑）。 */
function ageOutComments() {
  db.prepare("UPDATE comments SET created_at = datetime('now', '-60 minutes')").run();
}

test("同一来源在窗口期内超过提交上限返回 429", async () => {
  ageOutComments();

  const first = await submit(POST_A, { content: "限流用例的第一条评论内容。" });
  assert.equal(first.status, 303);

  const second = await submit(POST_A, { content: "限流用例的第二条评论内容。" });
  assert.equal(second.status, 303);

  const third = await submit(POST_A, { content: "限流用例的第三条评论应该被拦下。" });
  assert.equal(third.status, 429);
  assert.match(third.text, /提交过于频繁/);
  assert.match(third.text, /10 分钟内最多提交 2 条评论/);
});

test("窗口外的旧评论不占用额度，限额随时间恢复", async () => {
  // 上一条用例已写满额度，把历史评论挤出窗口后应当可以再次提交。
  ageOutComments();

  const res = await submit(POST_A, { content: "窗口外的评论不占额度，这条应该能提交。" });
  assert.equal(res.status, 303);
  assert.equal(commentsService.countByStatus().total > 0, true);
});

test("窗口期内重复提交相同内容返回 409", async () => {
  ageOutComments();
  const content = "重复内容检测：两次提交同一句话。";

  const first = await submit(POST_A, { content });
  assert.equal(first.status, 303);

  const second = await submit(POST_A, { content });
  assert.equal(second.status, 409);
  assert.match(second.text, /你刚刚已经提交过这条评论了/);
});

test("外链数量超过上限返回 400", async () => {
  ageOutComments();

  const res = await submit(POST_A, {
    content: "推广内容请看 http://a.example.com 与 http://b.example.com",
  });

  assert.equal(res.status, 400);
  assert.match(res.text, /评论内容最多包含 1 条链接，当前 2 条/);
});

test("频率限制跨文章生效，换一篇文章也绕不过", async () => {
  ageOutComments();

  const first = await submit(POST_A, { content: "跨文章限流用例的第一条评论。" });
  assert.equal(first.status, 303);

  const second = await submit(POST_A, { content: "跨文章限流用例的第二条评论。" });
  assert.equal(second.status, 303);

  const onOtherPost = await submit(POST_B, { content: "换一篇文章提交，应该同样被限流。" });
  assert.equal(onOtherPost.status, 429);
  assert.match(onOtherPost.text, /提交过于频繁/);
});
