// Live2D 模型清单的唯一来源（内置模型 + 自定义模型的类型/解析/合并）。
//
// 该模块必须保持"无 DOM、无浏览器 API 依赖"：
//   - live2d-widget.tsx（组件）、settings-theme.tsx（后台设置页）直接引用；
//   - vite.config.ts（Node 构建）也引用 BUILTIN_MODELS 生成打包根的 model_list，
//     因此顶层不能出现 window/document/import.meta.env。
// 新增内置模型时：在 BUILTIN_MODELS 加 id，并在 CHAT_PROMPT_BY_MODEL /
// MODEL_FILES_BY_NAME / EXPECTED_TOTAL_BY_NAME 补对应条目（i18n 的
// theme.live2d.switch.<id> 是展示名）。

// 内置模型 id。furina 走远端 CDN（moc3 约 95MB 超 Cloudflare Pages 25MiB 上限，
// 无法打包）；BCSZ1.1 整模型约 22MB，随博客打包成静态资源（见 vite.config.ts）。
export const BUILTIN_MODELS = ["furina", "BCSZ1.1"] as const;

export type BuiltinModel = (typeof BUILTIN_MODELS)[number];

// 一个自定义模型的配置（设置里"添加模型"生成，存 widget.live2d.customModels JSON 串）
export type CustomModel = {
  // 唯一 id（用于默认模型、循环切换），如 "custom-abc123"
  id: string;
  // 展示名（角色名）
  name: string;
  // 模型清单文件地址（.model3.json 或 index.json），渲染器直接由它加载
  url: string;
};

// 解析自定义模型列表（入参为配置里存的 JSON 字符串或已解析值）。失效返回空数组。
export function parseCustomModels(raw: unknown): CustomModel[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.filter(
      (x): x is CustomModel =>
        !!x &&
        typeof x === "object" &&
        typeof (x as CustomModel).id === "string" &&
        typeof (x as CustomModel).name === "string" &&
        typeof (x as CustomModel).url === "string",
    );
  } catch {
    return [];
  }
}

// 全部可选模型的 id（内置 + 自定义，用于换模型循环与设置页选项）。顺序即循环顺序。
export function allModelIds(custom: CustomModel[] = []): string[] {
  return [...BUILTIN_MODELS, ...custom.map((c) => c.id)];
}

// 默认模型 id：配置值合法（内置 id 或自定义 id）则用之，否则回退 furina。
export function resolveDefaultName(configured: unknown, custom: CustomModel[] = []): string {
  const s = typeof configured === "string" ? configured.trim() : "";
  if ((BUILTIN_MODELS as readonly string[]).includes(s)) return s;
  if (custom.some((c) => c.id === s)) return s;
  return "furina";
}

// 自定义模型的唯一 id（设置页"添加模型"时生成）
export function newCustomModelId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// 各模型的核心大文件（用于预取，加速首次加载）。自定义模型无常量表，走 index.json 全量预缓存。
export const MODEL_FILES_BY_NAME: Record<string, string[]> = {
  furina: ["furina.moc3", "furina.8192/texture_00.png"],
  "BCSZ1.1": ["BCSZ1.1.moc3", "textures/texture_00.png"],
};

// 各模型进度分母（moc3 + 贴图 + 其它核心文件）。仅内置模型有精确值；
// 自定义模型以 0 作为"总字节未知"，进度仅显示已下载量。
export const EXPECTED_TOTAL_BY_NAME: Record<string, number> = {
  furina: 103740290,
  "BCSZ1.1": 22639505,
};

// 内置模型的聊天人设：注入给设置里绑定的 AI（ai_summary 配置）
const FURINA_SYSTEM_PROMPT =
  "你是芙宁娜，这个博客的 Live2D 看板娘。你性格活泼可爱、略带傲娇，说话简短俏皮，" +
  "喜欢用语气词（～、哦、嘛、啦）。请用中文回复，每次回复不超过 80 字，不要使用 Markdown 格式。";

const GENERIC_SYSTEM_PROMPT =
  "你是这个博客的 Live2D 看板娘，性格可爱友善。说话简短俏皮，" +
  "请用中文回复，每次回复不超过 80 字，不要使用 Markdown 格式。";

const CHAT_PROMPT_BY_MODEL: Record<BuiltinModel, string> = {
  furina: FURINA_SYSTEM_PROMPT,
  "BCSZ1.1": GENERIC_SYSTEM_PROMPT,
};

// 取当前模型的聊天人设：内置模型按表；自定义模型用通用模板并带上角色名。
export function chatPromptFor(modelId: string, customModels: CustomModel[] = []): string {
  const builtin = CHAT_PROMPT_BY_MODEL[modelId as BuiltinModel];
  if (builtin) return builtin;
  const custom = customModels.find((c) => c.id === modelId);
  if (custom) {
    return `你是"${custom.name}"，这个博客的 Live2D 看板娘。性格可爱友善，说话简短俏皮，` +
      "请用中文回复，每次回复不超过 80 字，不要使用 Markdown 格式。";
  }
  return GENERIC_SYSTEM_PROMPT;
}
