import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientConfigContext } from "../../state/config";

/**
 * Live2D 看板娘组件 —— live2d-widget 插件接入版（复刻 Demo autoload.js）
 *
 * 渲染引擎：stevenjoezhang/live2d-widget（827802685 的 fork，暴露 window.initWidget），
 * 与 Demo（https://827802685.github.io/Live2D/）完全同源。
 *
 * 交互（联动性）说明：
 *   - 鼠标移动：渲染器让模型眼睛/头部跟随光标（onDrag）；
 *   - 悬停身体：渲染器派发 live2d:hoverbody → 插件在 #waifu-tips 显示气泡；
 *   - 点击模型：渲染器播放 TapBody 动作/表情并派发 live2d:tapbody → 插件显示气泡；
 *   - 空闲/复制/切页：插件按 waifu-tips.json 定时显示气泡；
 *   - 投喂/摸一摸按钮：通过合成 pointerdown 触发模型真实动作 + showTips 显示自定义气泡。
 *
 * 与 Demo 的差异（为适配博客）：
 *   - 模型源：优先 github.io 直连（实测最快、同源 CORS），失败自动回退加速代理；
 *   - 隐藏插件自带的 #waifu-tool（工具列）与 #waifu-toggle（开关），交互交给 React 按钮；
 *   - 气泡复用插件的 #waifu-tips，仅重写样式贴合博客主题；
 *   - 不加载 config-panel.js（参数面板），保持博客干净；
 *   - 保留 React 外壳：文件夹拖拽、投喂/摸一摸/隐藏按钮、加载进度、错误提示。
 */

// 插件资源根目录（相对 waifu-tips.js 所在处）
const DIST = "https://827802685.github.io/Live2D/dist/";
const WIDGET_CSS = `${DIST}waifu.css`;
const WIDGET_SCRIPT = `${DIST}waifu-tips.js`;
const WIDGET_JSON = `${DIST}waifu-tips.json`;
const CUBISM2_PATH = `${DIST}live2d.min.js`;
const CUBISM5_PATH = `${DIST}live2dcubismcore.min.js`;

// 模型根地址候选：优先 github.io 直连（实测最快、同源 CORS），失败回退加速代理（Demo 默认）
const CDN_CANDIDATES = [
  "https://827802685.github.io/Live2D/",
  "https://raw-githubusercontent-com-gh.zjkl0330.dpdns.org/827802685/Live2D/refs/heads/master/",
];

// 首次加载模型文件总字节数（moc3 91MB + 4K 贴图 8MB + physics + cdi + idle 动作），作为进度分母
const EXPECTED_TOTAL = 103740290;

// initWidget 的配置结构（对应 stevenjoezhang/live2d-widget 的 dist/autoload.js）
type InitWidgetConfig = {
  waifuPath: string;
  cdnPath?: string;
  cubism2Path?: string;
  cubism5Path?: string;
  tools?: string[];
  modelId?: number;
  logLevel?: string;
  drag?: boolean;
};
type WidgetLoader = (config: InitWidgetConfig) => void;

// 用于标记我们注入的 <link>/<script>，便于卸载时定向清理（尽量不误删页面其它资源）
const CSS_MARK = "rin-live2d-widget--css";
const SCRIPT_MARK = "rin-live2d-widget--script";
const OVERRIDE_STYLE_ID = "rin-live2d-widget--override";

const FOOD_REPLIES = [
  "theme.live2d.feed.yum1",
  "theme.live2d.feed.yum2",
  "theme.live2d.feed.yum3",
];

const POKE_REPLIES = [
  "theme.live2d.talk.poke1",
  "theme.live2d.talk.poke2",
  "theme.live2d.talk.poke3",
];

const FOODS = [
  { key: "cake", icon: "🍰" },
  { key: "donut", icon: "🍩" },
  { key: "fish", icon: "🍣" },
  { key: "dessert", icon: "🍮" },
];

// 复刻 Demo 的工具集。工具列本身会被覆盖样式隐藏（#waifu-tool{display:none}），
// 交互交给 React 外壳；去掉 "quit"（与 React 的 Hide 逻辑冲突）。
const TOOLS = ["hitokoto", "photo", "info"];

// 判重式加载 <link rel="stylesheet">
function loadStylesheet(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLLinkElement>(
      `link[data-rin-live2d-widget="${CSS_MARK}"]`,
    );
    if (existing) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.rinLive2dWidget = CSS_MARK;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load stylesheet ${href}`));
    document.head.appendChild(link);
  });
}

// 判重式加载 <script type="module">（waifu-tips.js 内含 export，必须按 module 注入）
function loadModuleScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-rin-live2d-widget="${SCRIPT_MARK}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
      }
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = src;
    script.dataset.rinLive2dWidget = SCRIPT_MARK;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

// 复刻 Demo：把 window.Image 包一层默认 crossOrigin=anonymous。
// 模型贴图来自跨域 CDN，统一加 crossOrigin 避免纹理因跨域被 Canvas 污染/加载失败。
let originalImage: typeof window.Image | null = null;
function patchGlobalImage() {
  if (typeof window === "undefined" || originalImage) {
    return;
  }
  originalImage = window.Image;
  function PatchedImage(this: unknown, ...args: ConstructorParameters<typeof Image>) {
    const img = new (originalImage as typeof Image)(...args);
    img.crossOrigin = "anonymous";
    return img as typeof img;
  }
  PatchedImage.prototype = (originalImage as typeof Image).prototype;
  (window as unknown as { Image: typeof Image }).Image =
    PatchedImage as unknown as typeof Image;
}
function restoreGlobalImage() {
  if (originalImage) {
    (window as unknown as { Image: typeof Image }).Image = originalImage;
    originalImage = null;
  }
}

type ProgressState = { loaded: number; total: number };

// 全局 fetch 包装：统计 /model/ 请求的下载字节数（复刻 Demo autoload.js 的 installProgressTracker）。
// 必须在 initWidget 之前安装，才能拦到模型下载请求。返回卸载时恢复 window.fetch 的函数。
function installProgressTracker(onProgress: (p: ProgressState) => void): () => void {
  const state: ProgressState = { loaded: 0, total: EXPECTED_TOTAL };
  const origFetch = window.fetch.bind(window);
  let rafPending = false;

  const notify = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      onProgress({ loaded: state.loaded, total: state.total });
    });
  };

  const wrapped: typeof window.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url || "";
    // 只拦截模型文件请求（URL 含 /model/），其余请求原样放行
    if (url.indexOf("/model/") === -1) {
      return origFetch(input, init);
    }
    return origFetch(input, init).then(async (resp) => {
      if (!resp || !resp.body) return resp;
      const reader = resp.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        chunks.push(r.value);
        loaded += r.value.byteLength;
      }
      state.loaded += loaded;
      notify();
      // 重建 Response：去掉压缩相关头，避免与已解码的 Blob 体积不一致
      const headers = new Headers(resp.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      headers.delete("transfer-encoding");
      const body = new Blob(chunks as BlobPart[]);
      return new Response(body, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      });
    });
  };

  window.fetch = wrapped;
  return () => {
    window.fetch = origFetch;
  };
}

// 探测可用的模型源：依次请求 model_list.json，返回第一个能正常返回模型清单的根地址
async function pickCdnRoot(): Promise<string> {
  for (const root of CDN_CANDIDATES) {
    try {
      const res = await fetch(`${root}model_list.json`, { mode: "cors" });
      if (res.ok) {
        const data = (await res.json()) as { models?: unknown[] };
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          return root;
        }
      }
    } catch {
      // 尝试下一个候选
    }
  }
  return CDN_CANDIDATES[0];
}

// 拖动位置持久化 key
const POS_KEY = "rin.live2d.pos";
// 记忆的拖动偏移 {leftPercent, topPx}：水平按百分比锚定，垂直按像素
type SavedPos = { left: number; top: number } | null;

function loadSavedPos(): SavedPos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { left: number; top: number };
    if (typeof parsed.left === "number" && typeof parsed.top === "number") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function Live2DWidget() {
  const config = useContext(ClientConfigContext);
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [feeding, setFeeding] = useState(false);
  const [showFood, setShowFood] = useState(false);
  const modelAreaRef = useRef<HTMLDivElement | null>(null);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const tipsTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);
  const renderedRef = useRef(false);
  const lastProgressAtRef = useRef(Date.now());
  const [pos, setPos] = useState<{ left: number; top: number } | null>(() => loadSavedPos());

  const position = String(config.get("widget.live2d.position") ?? "right");
  // modelUrl 保留读取，兼容既有配置；插件模式下改为 cdnPath + modelId，
  // 因此该 URL 不再被直接使用，为空也不影响渲染
  const modelUrl = String(config.get("widget.live2d.model") ?? "");
  // 显式引用一次，示意这是"按需保留"；插件模式实际用 cdnPath+modelId，此值仅供扩展
  void modelUrl;
  const rawScale = Number(config.get("widget.live2d.scale") ?? 1);
  // 防止配置被误调成超大值导致模型挡住整个页面：限制在安全范围内
  const scaleValue = Number.isFinite(rawScale) ? Math.min(Math.max(rawScale, 0.1), 2) : 1;

  // 模型容器尺寸：与插件 #waifu-canvas 的 300x300 一致，随配置缩放
  const boxW = Math.round(300 * scaleValue);
  const boxH = Math.round(300 * scaleValue);

  const randomKey = (keys: string[]) => keys[Math.floor(Math.random() * keys.length)];

  /**
   * 在插件的 #waifu-tips 气泡里显示一条消息（复刻插件内部 i() 的行为）。
   * 与插件自身的消息共用同一个元素，天然互斥：后显示的覆盖先显示的。
   */
  function showTips(text: string, duration = 4000) {
    const el = document.getElementById("waifu-tips");
    if (!el) {
      return;
    }
    el.innerHTML = text;
    el.classList.add("waifu-tips-active");
    if (tipsTimerRef.current) {
      window.clearTimeout(tipsTimerRef.current);
    }
    tipsTimerRef.current = window.setTimeout(() => {
      el.classList.remove("waifu-tips-active");
      tipsTimerRef.current = null;
    }, duration);
  }

  /**
   * 通过合成 pointerdown 触发渲染器的 onTap，让模型真实播放 TapBody 动作/表情。
   * 渲染器在 document 上监听 pointerdown（冒泡），命中身体会派发 live2d:tapbody，
   * 插件随之显示 tapBody 气泡；调用方随后用 showTips 覆盖成自定义文案。
   */
  function triggerModelTap() {
    const canvas = document.getElementById("live2d");
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    // 取画布中下部（身体区域），命中身体播放 TapBody；命中头部则播放表情
    const x = rect.left + rect.width * 0.5;
    const y = rect.top + rect.height * 0.62;
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
  }

  function feedModel(item?: { key: string; icon: string }) {
    // 先触发模型真实动作（合成点击），再显示自定义投喂文案（覆盖插件的 tapBody 气泡）
    triggerModelTap();
    showTips(t(randomKey(FOOD_REPLIES)), 3600);
    setShowFood(false);
    setFeeding(true);
    window.setTimeout(() => setFeeding(false), 500);
    if (item) {
      window.setTimeout(() => {
        showTips(t(item.key === "cake" ? "theme.live2d.feed.cake" : "theme.live2d.feed.generic"), 2000);
      }, 800);
    }
  }

  function pokeModel() {
    triggerModelTap();
    showTips(t(randomKey(POKE_REPLIES)), 3200);
  }

  /**
   * 插件被加载后同步插入 #waifu（其内含 #waifu-canvas > canvas#live2d、#waifu-tips、#waifu-tool）。
   * 这里把它「请」进 React 的模型容器，使其随文件夹一起定位/缩放；同时隐藏插件自带的
   * #waifu-toggle（显示/隐藏交给 React 的 Hide 按钮）。
   */
  function adoptPluginDom() {
    const cage = modelAreaRef.current;
    const waifu = document.getElementById("waifu");
    if (cage && waifu && waifu.parentElement !== cage) {
      cage.appendChild(waifu);
    }
    const toggle = document.getElementById("waifu-toggle");
    if (toggle && toggle.id) {
      toggle.style.display = "none";
    }
  }

  useEffect(() => {
    let disposed = false;

    // ---- 首次挂载，清掉可能残留的插件会话状态，保证每次挂载都从干净状态开始 ----
    try {
      localStorage.removeItem("waifu-disabled");
      localStorage.removeItem("waifu-display");
      sessionStorage.removeItem("waifu-message-priority");
      // model 总数 = 1（models:[furina]），显式把 modelId 固定为 0，避免历史遗留值越界
      localStorage.setItem("modelId", "0");
    } catch {
      // ignore
    }

    // ---- 注入我们自己的覆盖样式：把插件 #waifu 定位进 React 容器，气泡贴合博客主题 ----
    const overrideStyle = document.createElement("style");
    overrideStyle.id = OVERRIDE_STYLE_ID;
    overrideStyle.textContent = [
      `#${OVERRIDE_STYLE_ID}{}`,
      // 模型容器：占满 React 容器，取消插件默认的 fixed 定位与过渡
      `#waifu{position:absolute !important;top:0;left:0;bottom:auto !important;`,
      `transform:none !important;transition:none !important;z-index:0 !important;`,
      `width:100%;height:100%;margin:0}`,
      `#waifu.waifu-active{bottom:auto !important}`,
      `#waifu:hover{transform:none !important}`,
      `#waifu-canvas{width:100% !important;height:100% !important;margin:0}`,
      `#live2d{width:100% !important;height:100% !important;position:relative;display:block}`,
      // 气泡：浮在模型上方，贴合博客主题（白底/暗色 #333，主题色点缀）
      `#waifu-tips{position:absolute !important;bottom:100% !important;left:50% !important;`,
      `transform:translateX(-50%) !important;margin:0 0 8px !important;`,
      `width:max-content !important;max-width:220px;min-height:0 !important;`,
      `background:#fff;border:1px solid rgba(0,0,0,.1);border-radius:12px;`,
      `box-shadow:0 4px 16px rgba(0,0,0,.12);font-size:12px;line-height:1.5;`,
      `padding:6px 10px;opacity:0;transition:opacity .2s;z-index:20;`,
      `pointer-events:none;text-align:center;animation:none !important;`,
      `overflow:visible !important;text-overflow:clip !important;word-break:normal !important;}`,
      `[data-color-mode="dark"] #waifu-tips{background:#333;border-color:rgba(255,255,255,.12);color:#e5e5e5;}`,
      `#waifu-tips.waifu-tips-active{opacity:1;}`,
      `#waifu-tips span{color:rgb(var(--theme-rgb));}`,
      // 工具列与开关交给 React 按钮
      `#waifu-tool,#waifu-toggle{display:none !important}`,
    ].join("\n");
    document.head.appendChild(overrideStyle);

    // ---- 复刻 Demo：给图片加载统一加 crossOrigin ----
    patchGlobalImage();

    // ---- 下载进度追踪（必须在 initWidget 之前安装）----
    const restoreFetch = installProgressTracker((p) => {
      lastProgressAtRef.current = Date.now();
      if (!disposed) setProgress(p);
    });

    // ---- 渲染门控：live2d:rendered 后放行模型 ----
    const onRendered = () => {
      if (disposed) return;
      renderedRef.current = true;
      setRendered(true);
      setError(null);
    };
    window.addEventListener("live2d:rendered", onRendered);

    // ---- 兜底：下载停滞（连续 2 分钟无进展且未渲染）时提示用户 ----
    const stallTimer = window.setInterval(() => {
      if (disposed) return;
      if (renderedRef.current) {
        window.clearInterval(stallTimer);
        return;
      }
      if (Date.now() - lastProgressAtRef.current > 120000) {
        setError(t("theme.live2d.loading.stalled"));
        window.clearInterval(stallTimer);
      }
    }, 30000);

    (async () => {
      try {
        // 不做 WebGL 前置检查：与 Demo 的 live2d-widget 插件行为一致。
        // 插件在运行时直接创建 WebGL 上下文，若浏览器不支持会自行在控制台报错并降级。

        // 1) 探测可用的模型源（github.io 优先，失败回退代理）
        const cdnRoot = await pickCdnRoot();
        if (disposed) return;

        // 2) 加载样式与插件脚本（均为判重，可安全重复挂载）
        await loadStylesheet(WIDGET_CSS);
        await loadModuleScript(WIDGET_SCRIPT);
        if (disposed) return;

        // 3) 等待 window.initWidget 就绪
        const loader = (window as unknown as { initWidget?: WidgetLoader }).initWidget;
        if (typeof loader !== "function") {
          throw new Error(
            "initWidget is not available. Check that waifu-tips.js was loaded from " + DIST,
          );
        }

        // 4) 复刻 Demo 的调用方式（cdnPath + modelId；毛豆 furina 为 Cubism5 / 使用 cubism5Path）
        loader({
          waifuPath: WIDGET_JSON,
          cdnPath: cdnRoot,
          cubism2Path: CUBISM2_PATH,
          cubism5Path: CUBISM5_PATH,
          tools: TOOLS,
          modelId: 0,
          logLevel: "info",
          // 插件自带拖拽关闭，交给 React 文件夹拖拽统一处理
          drag: false,
        });
        if (disposed) return;

        // 5) initWidget 同步执行到 r() 的第一步（插入 #waifu）后即返回，
        //    因此在调用返回后立刻把 #waifu 放进 React 容器
        adoptPluginDom();
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener("live2d:rendered", onRendered);
      window.clearInterval(stallTimer);
      restoreFetch();
      if (tipsTimerRef.current) {
        window.clearTimeout(tipsTimerRef.current);
      }

      // ---- 卸载时清理插件注入的 DOM / 脚本，尽量不破坏页面其它区域 ----
      // 注：插件会在 window/document 上注册一些监听器与 setInterval，这些全局引用
      // 无法在此移除（插件没有暴露销毁句柄）；已把可移除的 DOM/脚本/样式/图片补丁清理干净。
      document.getElementById("waifu")?.remove();
      document.getElementById("waifu-toggle")?.remove();
      document.getElementById(OVERRIDE_STYLE_ID)?.remove();
      document
        .querySelector(`link[data-rin-live2d-widget="${CSS_MARK}"]`)
        ?.remove();
      document
        .querySelector(`script[data-rin-live2d-widget="${SCRIPT_MARK}"]`)
        ?.remove();
      restoreGlobalImage();
      try {
        localStorage.removeItem("waifu-disabled");
        localStorage.removeItem("waifu-display");
        sessionStorage.removeItem("waifu-message-priority");
      } catch {
        // ignore
      }
    };
    // 仅在挂载时加载一次；组件内部 re-render（隐藏/拖动等）不重载插件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // 忽略合成事件（triggerModelTap 派发的 pointerdown），避免误触发拖拽
    if (!event.isTrusted || event.button !== 0) {
      return;
    }
    const wrapper = outerRef.current;
    if (!wrapper) {
      return;
    }
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origLeft: wrapper.offsetLeft,
      origTop: wrapper.offsetTop,
    };
    setDragging(true);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    document.body.dataset.live2dDragging = "true";
  }

  // window 级指针监听能保证拖动过程中指针移出 DOM 也不丢失
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onMove = (event: PointerEvent) => {
      const state = dragStateRef.current;
      const wrapper = outerRef.current;
      if (!state || !wrapper) {
        return;
      }
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      const nextLeft = state.origLeft + deltaX;
      const nextTop = state.origTop + deltaY;
      // 限位：不超过视口右下，且顶部不高于 0
      const clampedLeft = Math.min(Math.max(nextLeft, 0), window.innerWidth - 20);
      const clampedTop = Math.min(Math.max(nextTop, 0), window.innerHeight - 20);
      setPos({ left: clampedLeft, top: clampedTop });
    };
    const onUp = () => {
      const wrapper = outerRef.current;
      if (wrapper) {
        localStorage.setItem(POS_KEY, JSON.stringify({ left: wrapper.offsetLeft, top: wrapper.offsetTop }));
      }
      dragStateRef.current = null;
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      delete document.body.dataset.live2dDragging;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  const anchorStyle: React.CSSProperties =
    position === "left" ? { left: "1rem" } : { right: "1rem" };

  // 有记忆/拖动坐标时用 left/top，否则回到默认 bottom 锚点
  const positionStyle: React.CSSProperties = pos
    ? { left: `${pos.left}px`, top: `${pos.top}px` }
    : anchorStyle;

  // 加载进度百分比（0-100）
  const pct = progress
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : 0;

  return (
    <>
      {hidden ? (
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="fixed bottom-4 z-40 rounded-full bg-theme px-3 py-2 text-white shadow-lg transition hover:bg-theme-hover"
          style={anchorStyle}
          aria-label={t("theme.live2d.show")}
        >
          <i className="ri-magic-line" />
        </button>
      ) : null}
      <div
        ref={outerRef}
        className="fixed bottom-2 z-40"
        style={{ ...positionStyle, ...(hidden ? { display: "none" } : {}) }}
      >
        <div className={`flex flex-col items-end gap-1 ${dragging ? "pointer-events-none" : ""}`}>
          {error ? (
            <p className="max-w-44 text-xs text-red-500">{error}</p>
          ) : (
            <div
              className="relative"
              style={{ width: boxW, height: boxH }}
            >
              {/* 模型容器：插件生成的 #waifu 会被移入这里。
                  注意：此容器不能有 React 子节点，否则手动 appendChild 的 #waifu 会在 re-render 时被 React 清掉。
                  不能加 overflow-hidden，否则浮在模型上方的 #waifu-tips 气泡会被裁掉。 */}
              <div
                ref={modelAreaRef}
                className="absolute inset-0 cursor-grab touch-none select-none"
                onPointerDown={onPointerDown}
              />
              {/* 加载进度覆盖层：渲染完成前显示（作为兄弟节点，不干扰 #waifu） */}
              {!rendered ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-w/90 text-xs shadow-inner dark:bg-neutral-900/90">
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                    <div
                      className="h-full rounded-full bg-theme transition-[width] duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="t-muted">
                    {progress
                      ? `${t("theme.live2d.loading.downloading")} ${pct}%`
                      : t("theme.live2d.loading.connecting")}
                  </span>
                </div>
              ) : null}
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowFood((value) => !value)}
              className={`rounded-full bg-w p-1.5 text-xs shadow transition ${showFood ? "text-theme" : "t-muted hover:text-theme"}`}
              aria-label={t("theme.live2d.feed.button")}
              title={t("theme.live2d.feed.button")}
            >
              <i className="ri-spoon-line" />
            </button>
            <button
              type="button"
              onClick={pokeModel}
              className="rounded-full bg-w p-1.5 text-xs shadow t-muted transition hover:text-theme"
              aria-label={t("theme.live2d.poke")}
              title={t("theme.live2d.poke")}
            >
              <i className="ri-hand-heart-line" />
            </button>
            <button
              type="button"
              onClick={() => setHidden(true)}
              className="rounded-full bg-w p-1.5 text-xs shadow t-muted transition hover:text-theme"
              aria-label={t("theme.live2d.hide")}
              title={t("theme.live2d.hide")}
            >
              <i className="ri-close-line" />
            </button>
          </div>
          {showFood && !error ? (
            <div className="flex items-center gap-1 rounded-full border border-black/10 bg-w px-2 py-1 shadow dark:border-white/10">
              {FOODS.map((food) => (
                <button
                  key={food.key}
                  type="button"
                  onClick={() => feedModel(food)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-base transition hover:scale-110 hover:bg-neutral-100 dark:hover:bg-white/10"
                  aria-label={t("theme.live2d.feed.food", { food: t(`theme.live2d.feed.name.${food.key}`) })}
                  title={t(`theme.live2d.feed.name.${food.key}`)}
                >
                  {food.icon}
                </button>
              ))}
            </div>
          ) : null}
          {feeding ? (
            <div className="pointer-events-none text-3xl transition-all duration-500">
              <i className="ri-heart-3-fill text-theme" />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
