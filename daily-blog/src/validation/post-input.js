import { z } from "zod";
import { POST_STATUSES } from "../services/posts.service.js";

/**
 * 后台表单输入校验：路由层负责把 HTTP 表单解析成规范结构，
 * 服务层只接收已经过校验的数据，避免业务代码里散落字符串判断。
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const postSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "标题不能为空")
    .max(200, "标题最长 200 个字符"),
  slug: z
    .string()
    .trim()
    .max(120, "slug 最长 120 个字符")
    .refine(
      (value) => value === "" || SLUG_PATTERN.test(value),
      "slug 只能包含小写字母、数字与连字符（例如 day-2-admin）",
    ),
  summary: z.string().trim().max(300, "摘要最长 300 个字符"),
  content: z.string().trim().min(1, "正文不能为空"),
  author: z.string().trim().max(60, "作者最长 60 个字符"),
  status: z.enum(POST_STATUSES, {
    errorMap: () => ({ message: `文章状态只能是 ${POST_STATUSES.join(" / ")}` }),
  }),
});

function asString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

/** 返回 { ok, data, values, errors }；失败时 values 保留用户输入，便于回填表单。 */
export function parsePostInput(body = {}) {
  const values = {
    title: asString(body.title),
    slug: asString(body.slug),
    summary: asString(body.summary),
    content: asString(body.content),
    author: asString(body.author),
    status: asString(body.status) || "draft",
  };

  const result = postSchema.safeParse(values);
  if (result.success) {
    return { ok: true, data: result.data, values: result.data, errors: {} };
  }

  const fieldErrors = result.error.flatten().fieldErrors;
  const errors = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    errors[field] = messages?.[0] ?? "取值不合法";
  }

  return { ok: false, data: null, values, errors };
}
