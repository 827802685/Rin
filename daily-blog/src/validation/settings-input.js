import { z } from "zod";

/**
 * 站点配置表单校验（后台「站点配置」页）。
 *
 * 与文章表单一样返回 { ok, data, values, errors }，失败时 values 原样回填，
 * 避免用户改了 8 个字段只因为一个填错就要全部重填。
 *
 * 这里只做「值与范围」的校验，不做「默认值」的处理：
 * 默认值由服务层从 config.js 兜底，校验层保持无状态。
 */

/** 表单项顺序即页面顺序，页面渲染与校验共用同一份定义，避免两处漂移。 */
export const SETTINGS_FIELDS = Object.freeze([
  Object.freeze({ key: "siteTitle", label: "站点标题", kind: "text", required: true }),
  Object.freeze({ key: "siteDescription", label: "站点描述", kind: "textarea" }),
  Object.freeze({ key: "siteAuthor", label: "默认作者", kind: "text" }),
  Object.freeze({ key: "siteUrl", label: "站点地址", kind: "url" }),
  Object.freeze({ key: "pageSize", label: "每页文章数", kind: "number" }),
  Object.freeze({ key: "feedSize", label: "RSS 输出条数", kind: "number" }),
  Object.freeze({ key: "feedMode", label: "RSS 正文", kind: "select" }),
  Object.freeze({ key: "robotsNoindex", label: "禁止搜索引擎收录", kind: "checkbox" }),
]);

export const SETTINGS_KEYS = Object.freeze(SETTINGS_FIELDS.map((field) => field.key));

export const FEED_MODES = Object.freeze(["summary", "full"]);

/** 站点地址：留空表示「按请求推断」，非空则必须是 http(s) 绝对地址且不带结尾斜杠。 */
const URL_PATTERN = /^https?:\/\/[^\s/]+(:\d+)?$/;

function asString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

/** 整数字段：空串、非整数、越界分别给出明确提示，而不是笼统的「类型错误」。 */
function intField({ label, min, max }) {
  return z.string().trim().superRefine((value, ctx) => {
    const fail = (message) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value === "") {
      fail(`${label}不能为空`);
      return;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      fail(`${label}必须是整数`);
      return;
    }
    if (parsed < min || parsed > max) {
      fail(`${label}必须在 ${min}-${max} 之间`);
    }
  });
}

const settingsSchema = z.object({
  siteTitle: z.string().trim().min(1, "站点标题不能为空").max(80, "站点标题最长 80 个字符"),
  siteDescription: z.string().trim().max(200, "站点描述最长 200 个字符"),
  siteAuthor: z.string().trim().max(40, "默认作者最长 40 个字符"),
  siteUrl: z
    .string()
    .trim()
    .max(200, "站点地址最长 200 个字符")
    .refine(
      (value) => value === "" || URL_PATTERN.test(value),
      "站点地址必须是 http(s):// 开头的地址，且不要以 / 结尾",
    ),
  pageSize: intField({ label: "每页文章数", min: 1, max: 100 }),
  feedSize: intField({ label: "RSS 输出条数", min: 1, max: 100 }),
  feedMode: z.enum(FEED_MODES, { errorMap: () => ({ message: "RSS 正文只能是 摘要 / 全文" }) }),
  // 复选框未勾选时浏览器不会提交该字段；约定只有显式的 on/true/1 才算开启。
  robotsNoindex: z
    .string()
    .trim()
    .transform((value) => ["on", "true", "1"].includes(value.toLowerCase())),
});

/** 解析后台站点配置表单。 */
export function parseSettingsInput(body = {}) {
  const values = {
    siteTitle: asString(body.siteTitle),
    siteDescription: asString(body.siteDescription),
    siteAuthor: asString(body.siteAuthor),
    siteUrl: asString(body.siteUrl),
    pageSize: asString(body.pageSize),
    feedSize: asString(body.feedSize),
    feedMode: asString(body.feedMode) || "summary",
    robotsNoindex: asString(body.robotsNoindex),
  };

  const result = settingsSchema.safeParse(values);
  if (!result.success) {
    const errors = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (field && !(field in errors)) {
        errors[field] = issue.message;
      }
    }
    return { ok: false, data: null, values, errors };
  }

  // 整数与布尔在这里转成真正的类型，服务层拿到的是可直接落库/直接使用的结构。
  const data = {
    ...result.data,
    pageSize: Number.parseInt(values.pageSize, 10),
    feedSize: Number.parseInt(values.feedSize, 10),
  };
  return { ok: true, data, values, errors: {} };
}
