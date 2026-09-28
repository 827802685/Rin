import { z } from "zod";

/**
 * 分类 / 标签表单校验。
 * 允许 slug 里出现中文（前台 URL 会被浏览器编码），因此不使用文章 slug 的纯 ASCII 规则，
 * 但仍拒绝空格、斜杠等在 URL 中需要额外转义的字符。
 */

const SLUG_PATTERN = /^[\p{Script=Han}\p{L}\p{N}][\p{Script=Han}\p{L}\p{N}_-]*$/u;

function asString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

function buildSchema(label, { withDescription }) {
  const shape = {
    name: z
      .string()
      .trim()
      .min(1, `${label}名称不能为空`)
      .max(40, `${label}名称最长 40 个字符`),
    slug: z
      .string()
      .trim()
      .max(60, `${label} slug 最长 60 个字符`)
      .refine(
        (value) => value === "" || SLUG_PATTERN.test(value),
        `${label} slug 只能是中文、字母、数字、下划线与连字符`,
      ),
  };

  if (withDescription) {
    shape.description = z.string().trim().max(200, `${label}描述最长 200 个字符`);
  }

  return z.object(shape);
}

function parse(schema, body, hasDescription) {
  const values = {
    name: asString(body.name),
    slug: asString(body.slug),
  };
  if (hasDescription) {
    values.description = asString(body.description);
  }

  const result = schema.safeParse(values);
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

const categorySchema = buildSchema("分类", { withDescription: true });
const tagSchema = buildSchema("标签", { withDescription: false });

export function parseCategoryInput(body = {}) {
  return parse(categorySchema, body, true);
}

export function parseTagInput(body = {}) {
  return parse(tagSchema, body, false);
}
