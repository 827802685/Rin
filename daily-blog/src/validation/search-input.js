import { z } from "zod";
import { ValidationError } from "../errors.js";

/**
 * 搜索查询参数校验与归一化。
 *
 * 与后台表单不同，查询参数来自 URL，用户可能直接在地址栏里手改，
 * 因此这里采取「宽容输入、严格输出」：非法页码退回第 1 页（与首页、分类页一致），
 * 不认识的值当作空值处理，而不是把 400 摔给只是翻页的用户。
 */

/** 结构层硬上限：远大于可配置的业务上限，只用来挡住明显异常的超长 URL 参数。 */
const MAX_RAW_QUERY_LENGTH = 500;

/** query 参数可能是字符串、数组（?q=a&q=b）甚至对象（?q[x]=1），统一取第一个字符串值。 */
function firstText(value) {
  if (Array.isArray(value)) {
    return firstText(value[0]);
  }
  if (value === undefined || value === null || typeof value === "object") {
    return "";
  }
  return String(value);
}

const searchParamsSchema = z.object({
  q: z
    .string()
    .trim()
    .max(MAX_RAW_QUERY_LENGTH, `搜索关键词过长（最多 ${MAX_RAW_QUERY_LENGTH} 个字符）`),
  category: z.string().trim(),
  tag: z.string().trim(),
  page: z.string().transform((value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  }),
});

/** 解析搜索参数，返回服务层可直接使用的字段名。 */
export function parseSearchParams(query = {}) {
  const result = searchParamsSchema.safeParse({
    q: firstText(query.q),
    category: firstText(query.category),
    tag: firstText(query.tag),
    page: firstText(query.page),
  });

  if (!result.success) {
    throw new ValidationError(result.error.issues[0]?.message ?? "搜索参数不合法");
  }

  return {
    query: result.data.q,
    page: result.data.page,
    categorySlug: result.data.category,
    tagSlug: result.data.tag,
  };
}
