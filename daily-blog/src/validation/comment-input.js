import { z } from "zod";
import { config } from "../config.js";

/**
 * 评论表单校验：路由层把 HTTP 表单解析成规范结构，服务层只接收已校验的数据。
 * 服务层会用同样规则再兜一次（服务层可能被接口或其他入口直接调用），
 * 这里的价值是把错误映射到具体表单项，便于页面逐项提示并回填用户输入。
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const commentSchema = z.object({
  authorName: z
    .string()
    .trim()
    .min(1, "请填写昵称")
    .max(40, "昵称最长 40 个字符"),
  authorEmail: z
    .string()
    .trim()
    .max(120, "邮箱最长 120 个字符")
    .refine((value) => value === "" || EMAIL_PATTERN.test(value), "邮箱格式不正确"),
  authorUrl: z
    .string()
    .trim()
    .max(200, "网址最长 200 个字符")
    .refine(
      (value) => value === "" || /^https?:\/\//i.test(value),
      "网址必须以 http:// 或 https:// 开头",
    ),
  content: z
    .string()
    .trim()
    .min(config.comments.minLength, `评论内容至少 ${config.comments.minLength} 个字符`)
    .max(config.comments.maxLength, `评论内容最长 ${config.comments.maxLength} 个字符`),
  // 蜜罐字段：真人看不见，因此不做任何长度校验，填了即判定为脚本。
  homepage: z.string().trim(),
});

function asString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

/** 返回 { ok, data, values, errors }；失败时 values 保留用户输入，便于回填表单。 */
export function parseCommentInput(body = {}) {
  const values = {
    authorName: asString(body.authorName),
    authorEmail: asString(body.authorEmail),
    authorUrl: asString(body.authorUrl),
    content: asString(body.content),
    homepage: asString(body.homepage),
  };

  const result = commentSchema.safeParse(values);
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
