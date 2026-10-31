// Live2D 模型清单的唯一来源（内置模型 + 自定义模型的类型/解析/合并）。
//
// 该模块必须保持"无 DOM、无浏览器 API 依赖"：
//   - live2d-widget.tsx（组件）、settings-theme.tsx（后台设置页）直接引用；
//   - vite.config.ts（Node 构建）也引用 BUILTIN_MODELS 生成打包根的 model_list，
//     因此顶层不能出现 window/document/import.meta.env。
// 新增内置模型时：在 BUILTIN_MODELS 加 id，并在 CHAT_PROMPT_BY_MODEL /
// MODEL_FILES_BY_NAME / EXPECTED_TOTAL_BY_NAME 补对应条目（i18n 的
// theme.live2d.switch.<id> 是展示名）。

// 内置模型 id。furina-mini 是作者自研渲染器（FurinaMini）的芙宁娜精简版：
// 38KB 渲染器 + 1.65MB 量化网格 + 0.69MB WebP 图集 ≈ 2.4MB，走作者仓库远端根
// （与引擎七件套同仓库），不需要 Cubism Core，live2d-widget.tsx 有专门的渲染分支；
// BCSZ1.1 整模型约 22MB，随博客打包成静态资源（见 vite.config.ts）。
// 原 Cubism 版 furina（moc3 约 95MB，只能走远端 CDN）已被 furina-mini 替换并从
// 内置列表移除：同样角色、2.4MB 对 95MB，且 2.4MB 可以放心当默认模型。
export const BUILTIN_MODELS = ["furina-mini", "BCSZ1.1"] as const;

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

// 默认模型 id：配置值合法（内置 id 或自定义 id）则用之，否则回退 furina-mini。
// 回退目标必须是轻模型：furina-mini 全套约 2.4MB（自研渲染器，无需 Cubism Core），
// 未配置的访客也能秒开看板娘；BCSZ1.1 约 22MB 只适合做备选。
export function resolveDefaultName(configured: unknown, custom: CustomModel[] = []): string {
  const s = typeof configured === "string" ? configured.trim() : "";
  if ((BUILTIN_MODELS as readonly string[]).includes(s)) return s;
  if (custom.some((c) => c.id === s)) return s;
  return "furina-mini";
}

// 自定义模型的唯一 id（设置页"添加模型"时生成）
export function newCustomModelId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// 各模型的核心大文件（用于预取 / 预缓存）。均写相对模型目录的文件名，
// 目录由 cache.ts 的 modelAssetBase 统一拼（furina-mini → <root>furina-mini/，
// Cubism → <root>model/<name>/）：这里再带一层目录会拼成双重路径、全部 404。
export const MODEL_FILES_BY_NAME: Record<string, string[]> = {
  // 自研渲染器四件套：脚本本体 + 量化网格 + 人物图集 + 魔杖贴图
  "furina-mini": [
    "furina-mini.js",
    "furina-mesh.bin",
    "furina-atlas.webp",
    "furina-wand.webp",
  ],
  "BCSZ1.1": ["BCSZ1.1.moc3", "textures/texture_00.png"],
};

// 各模型进度分母 = 加载看板娘真正会请求的字节（moc3 + 贴图 + motion/physics 等），
// **不含语音 wav**：插件只在播放语音时才请求它们。旧值把 6.2MB 语音也算进分母，导致
// 进度条最高只能走到约 72%，看着就像"卡在 72% 不动"。
// 自定义模型以 0 表示"总字节未知"，进度只显示已下载量。
//
// 口径必须和分子一致：分子是 fetch 流式读到的**解码后**字节，所以分母取磁盘/源站
// 未压缩大小（传输层的 gzip 不影响）。BCSZ1.1 = models/BCSZ1.1 目录去掉 wav 的字节和
//（含 index.json）；furina = 源站 model/furina 全部文件 + index.json（无语音文件）。
// BCSZ1.1 的贴图已从 8192² 降到 4096²（13.25MB → 3.41MB，无损 RGBA）：桌面帧时与贴图
// 无关（取决于 moc3 的 ArtMesh 数量），但移动端省掉的是带宽和 268MB → 67MB 的纹理显存。
export const EXPECTED_TOTAL_BY_NAME: Record<string, number> = {
  // furina-mini：渲染器 38614 + 量化网格 1654484 + WebP 图集 693444（实测 Content-Length）
  "furina-mini": 2386542,
  "BCSZ1.1": 5911380,
};

// 进度统计的目标（分子按名字过滤、分母按表取字节）。换模型走的是"复用渲染器实例"
// 的快路径（不重挂载加载 effect），只在挂载时算一次会让分母停在上一个模型——实测
// 切到 furina 后显示"100% + 73.8 / 5.6 MB"。首屏与切换都从这里取，口径唯一。
export function progressTargetFor(name: string): { name: string | null; total: number } {
  if (!(BUILTIN_MODELS as readonly string[]).includes(name)) return { name: null, total: 0 };
  return { name, total: EXPECTED_TOTAL_BY_NAME[name] ?? 0 };
}

// 内置模型的聊天人设：注入给设置里绑定的 AI（ai_summary 配置）
const FURINA_SYSTEM_PROMPT =
  "你是芙宁娜，这个博客的 Live2D 看板娘。你性格活泼可爱、略带傲娇，说话简短俏皮，" +
  "喜欢用语气词（～、哦、嘛、啦）。请用中文回复，每次回复不超过 80 字，不要使用 Markdown 格式。";

const GENERIC_SYSTEM_PROMPT =
  "你是这个博客的 Live2D 看板娘，性格可爱友善。说话简短俏皮，" +
  "请用中文回复，每次回复不超过 80 字，不要使用 Markdown 格式。";

const CHAT_PROMPT_BY_MODEL: Record<BuiltinModel, string> = {
  // furina-mini 与原 Cubism furina 是同一个角色（芙宁娜），人设沿用
  "furina-mini": FURINA_SYSTEM_PROMPT,
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
