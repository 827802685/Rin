import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientConfigContext } from "../../state/config";

type PixiApp = {
  stage: { addChild(node: unknown): unknown };
  start(): void;
  stop?(): void;
  destroy(removeView?: boolean, stageOptions?: boolean): void;
  renderer?: { gl?: WebGLRenderingContext };
};

type PixiModel = {
  width: number;
  height: number;
  scale: { set(x: number, y?: number): void };
  motion(group?: string, index?: number, priority?: number): Promise<unknown> | undefined;
};

type PixiNamespace = {
  Application: new (options: Record<string, unknown>) => PixiApp;
  live2d: {
    Live2DModel: {
      from(url: string, options?: Record<string, unknown>): Promise<PixiModel>;
    };
  };
  Texture: {
    from(source: HTMLCanvasElement | string): unknown;
  };
  utils: {
    TextureCache: Record<string, unknown>;
  };
};

const LIB_SCRIPTS = [
  "/libs/pixi.min.js",
  "/libs/live2dcubismcore.min.js",
  "/libs/live2d-cubism4.min.js",
];

const GREETINGS = [
  "theme.live2d.talk.idle1",
  "theme.live2d.talk.idle2",
  "theme.live2d.talk.poke1",
  "theme.live2d.talk.poke2",
];

const FOOD_REPLIES = [
  "theme.live2d.feed.yum1",
  "theme.live2d.feed.yum2",
  "theme.live2d.feed.yum3",
];

const FOODS = [
  { key: "cake", icon: "🍰" },
  { key: "donut", icon: "🍩" },
  { key: "fish", icon: "🍣" },
  { key: "dessert", icon: "🍮" },
];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-live2d-src="${src}"]`);
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
    script.src = src;
    script.dataset.live2dSrc = src;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function getPixi(): PixiNamespace | null {
  const globalPixi = (window as unknown as { PIXI?: PixiNamespace }).PIXI;
  return globalPixi && globalPixi.Application && globalPixi.live2d?.Live2DModel ? globalPixi : null;
}

// registerWebGPU 供部分 Live2D 运行时使用，缺失时安全忽略
function ensureWebGPURegistration() {
  const anyGlobal = window as unknown as { live2dcubismcore?: { Live2D_WebGL?: { registerWebGPU?: () => boolean } } };
  try {
    anyGlobal.live2dcubismcore?.Live2D_WebGL?.registerWebGPU?.();
  } catch {
    // ignore
  }
}

// 检测当前浏览器是否支持 WebGL（Live2D 渲染依赖 WebGL）。
// 用独立的测试 canvas，避免影响主渲染 canvas。
function isWebGLSupported(): boolean {
  try {
    const testCanvas = document.createElement("canvas");
    return !!(
      testCanvas.getContext("webgl") ||
      testCanvas.getContext("experimental-webgl") ||
      testCanvas.getContext("webgl2")
    );
  } catch {
    return false;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image ${url}`));
    img.src = url;
  });
}

// 将超大贴图（如 8192 分辨率）缩小到安全尺寸，避免纹理过大导致渲染失败。
// 缩小后的纹理缓存到 PIXI.TextureCache，Live2D 库加载时会命中缓存，不再重复下载。
async function preloadScaledTextures(
  model3Url: string,
  pixi: PixiNamespace,
  maxTextureSize: number,
): Promise<void> {
  const base = model3Url.substring(0, model3Url.lastIndexOf("/") + 1);
  type ModelSettings = { FileReferences?: { Textures?: string[] } };
  let settings: ModelSettings | null = null;
  try {
    const res = await fetch(model3Url, { mode: "cors" });
    if (!res.ok) {
      return;
    }
    settings = (await res.json()) as ModelSettings;
  } catch {
    return;
  }
  const textures = settings?.FileReferences?.Textures ?? [];
  if (textures.length === 0) {
    return;
  }
  // 安全上限：即使 GPU 支持 8192，超大纹理也会耗尽显存导致渲染失败。
  // 取 GPU 上限与 2048 的较小值（2048 是此前能正常渲染的尺寸）。
  const safeLimit = Math.min(maxTextureSize, 2048);
  await Promise.all(
    textures.map(async (texUrl) => {
      const fullUrl = texUrl.startsWith("http") ? texUrl : `${base}${texUrl}`;
      if (pixi.utils?.TextureCache?.[fullUrl]) {
        return;
      }
      try {
        const img = await loadImage(fullUrl);
        const maxDim = Math.max(img.width, img.height);
        if (maxDim <= safeLimit) {
          return; // 纹理没超限，让 Live2D 库自己加载
        }
        const scale = safeLimit / maxDim;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // PIXI v6 没有 Texture.fromCanvas，用 Texture.from(canvas) 创建纹理
        const texture = pixi.Texture.from(canvas);
        pixi.utils.TextureCache[fullUrl] = texture;
      } catch (err) {
        // 缩小失败不影响后续加载，但记录日志便于排查
        console.warn("[live2d] texture downscale failed:", err);
      }
    }),
  );
}

// 预取模型及其大资源（moc3 / 贴图）。模型文件很大（动辄数十 MB），
// 在加载 model3.json 后立即并行预取 moc3/贴图/物理/动作，避免逐项串行等待。
function prefetchModelAssets(model3Url: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const base = model3Url.substring(0, model3Url.lastIndexOf("/") + 1);

  const addPreload = (relUrl: string | undefined, important: boolean) => {
    if (!relUrl) {
      return;
    }
    const href = relUrl.startsWith("http") ? relUrl : `${base}${relUrl}`;
    const id = `rin-live2d-preload-${idForUrl(href)}`;
    if (document.getElementById(id)) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = important ? "fetch" : "fetch";
    link.href = href;
    link.crossOrigin = "anonymous";
    link.id = id;
    link.fetchPriority = important ? "high" : "low";
    document.head.appendChild(link);
  };

  // 先从 model3.json 解析出引用，以便尽早并行预取大文件
  fetch(model3Url, { mode: "cors" })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`model3 fetch ${res.status}`))))
    .then((settings: {
      FileReferences?: {
        Moc?: string;
        Textures?: string[];
        Physics?: string;
        DisplayInfo?: string;
        Motions?: Record<string, Array<{ File?: string }>>;
      };
    }) => {
      const refs = settings.FileReferences;
      if (!refs) {
        return;
      }
      // moc3 与贴图最大，给 high 优先级；其余 low
      addPreload(refs.Moc, true);
      refs.Textures?.forEach((tex) => addPreload(tex, true));
      addPreload(refs.Physics, false);
      addPreload(refs.DisplayInfo, false);
      const motions = refs.Motions;
      if (motions) {
        Object.values(motions).forEach((group) => {
          group?.forEach((m) => addPreload(m.File, false));
        });
      }
    })
    .catch(() => {
      // 预取失败不影响后续正式加载
    });
}

function idForUrl(url: string): string {
  return url.split("/").pop() || url;
}

const randomKey = (keys: string[]) => keys[Math.floor(Math.random() * keys.length)];

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
  const [dragging, setDragging] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [feeding, setFeeding] = useState(false);
  const [showFood, setShowFood] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<PixiModel | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(() => loadSavedPos());

  const position = String(config.get("widget.live2d.position") ?? "right");
  const modelUrl = String(config.get("widget.live2d.model") ?? "");
  const rawScale = Number(config.get("widget.live2d.scale") ?? 1);
  // 防止配置被误调成超大值导致模型挡住整个页面：限制在安全范围内
  const scaleValue = Number.isFinite(rawScale) ? Math.min(Math.max(rawScale, 0.1), 2) : 1;

  function say(message: string, duration = 4000) {
    setBubble(message);
    if (bubbleTimerRef.current) {
      window.clearTimeout(bubbleTimerRef.current);
    }
    bubbleTimerRef.current = window.setTimeout(() => setBubble(null), duration);
  }

  const greetRandomly = (pool: string[] = GREETINGS) => say(t(randomKey(pool)));

  function feedModel(item?: { key: string; icon: string }) {
    const model = modelRef.current;
    // trigger a motion if available, then speak a happy reply
    // Live2D 仓库的芙宁娜模型使用 "TapBody" 动画分组（tap.motion3.json），没有 "Tap" 分组。
    // 用实际存在的分组，确保喂食时播放动画。
    const motionPromise = model?.motion ? model.motion("TapBody", 0, 3) : undefined;
    if (motionPromise && typeof (motionPromise as Promise<unknown>).then === "function") {
      void motionPromise.catch(() => undefined);
    }
    say(t(randomKey(FOOD_REPLIES)), 3600);
    setShowFood(false);
    setFeeding(true);
    window.setTimeout(() => setFeeding(false), 500);
    if (item) {
      // brief floating feedback with the selected food icon
      window.setTimeout(() => {
        say(t(item.key === "cake" ? "theme.live2d.feed.cake" : "theme.live2d.feed.generic"), 2000);
      }, 800);
    }
  }

  useEffect(() => {
    if (!modelUrl) {
      return;
    }
    let cancelled = false;
    let app: PixiApp | null = null;

    // 尽早开始预取大资源（moc3 / 贴图），与库脚本加载并行。
    // 仅在 WebGL 可用时预取，避免不支持 WebGL 的环境白白下载大文件。
    if (isWebGLSupported()) {
      prefetchModelAssets(modelUrl);
    }

    (async () => {
      try {
        for (const src of LIB_SCRIPTS) {
          await loadScript(src);
        }
        if (cancelled) {
          return;
        }
        ensureWebGPURegistration();
        const pixi = getPixi();
        if (!pixi) {
          throw new Error("Live2D libraries are not available");
        }
        // WebGL 不可用时给出友好提示，避免 PIXI 抛出难懂的错误
        if (!isWebGLSupported()) {
          throw new Error(t("theme.live2d.error.webgl"));
        }
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
          return;
        }

        const appInstance = new pixi.Application({
          view: canvas,
          backgroundAlpha: 0,
          autoStart: true,
          antialias: true,
          resizeTo: container,
          resolution: window.devicePixelRatio || 1,
        });
        app = appInstance;

        // 获取 GPU 最大纹理尺寸，把超大贴图（如 8192）缩小到可渲染范围，
        // 避免纹理过大导致 Live2D 模型渲染失败。
        const gl = appInstance.renderer?.gl;
        const maxTexSize = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
        await preloadScaledTextures(modelUrl, pixi, maxTexSize);

        // 模型加载失败时重试一次（网络抖动/资源未就绪）
        let model: PixiModel;
        try {
          model = await pixi.live2d.Live2DModel.from(modelUrl, { autoInteract: true });
        } catch (loadErr) {
          if (cancelled) {
            return;
          }
          model = await pixi.live2d.Live2DModel.from(modelUrl, { autoInteract: true });
        }
        if (cancelled) {
          return;
        }
        modelRef.current = model;
        appInstance.stage.addChild(model);

        const targetHeight = 280 * scaleValue;
        const aspect = model.width / model.height;
        const targetWidth = targetHeight * aspect;
        model.scale.set(targetWidth / model.width);
        container.style.width = `${Math.round(targetWidth)}px`;
        container.style.height = `${Math.round(targetHeight)}px`;
        appInstance.start();

        // 载入完成后随机说一句话
        window.setTimeout(() => greetRandomly(), 600);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      modelRef.current = null;
      if (bubbleTimerRef.current) {
        window.clearTimeout(bubbleTimerRef.current);
      }
      if (app) {
        try {
          app.destroy(true);
        } catch {
          // ignore teardown errors
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, scaleValue]);

  // When the live2d toggle is turned off, this component unmounts (parent guards it).
  // The "cannot collapse" bug was that hovering/drag state or error block kept it visible;
  // here we always clear bubble + drag on position/model change and unmount cleanly.

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
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

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="fixed bottom-4 z-40 rounded-full bg-theme px-3 py-2 text-white shadow-lg transition hover:bg-theme-hover"
        style={anchorStyle}
        aria-label={t("theme.live2d.show")}
      >
        <i className="ri-magic-line" />
      </button>
    );
  }

  return (
    <div ref={outerRef} className="fixed bottom-2 z-40" style={positionStyle}>
      <div className={`flex flex-col items-end gap-1 ${dragging ? "pointer-events-none" : ""}`}>
        {bubble ? (
          <div className="relative max-w-44 rounded-2xl rounded-br-sm bg-w px-3 py-2 text-xs shadow t-secondary dark:bg-neutral-800">
            {bubble}
          </div>
        ) : null}
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
            onClick={() => greetRandomly(["theme.live2d.talk.poke1", "theme.live2d.talk.poke2", "theme.live2d.talk.poke3"])}
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
          <div className="pointer-events-none fixed bottom-3 z-50 text-3xl transition-all duration-500">
            <i className="ri-heart-3-fill text-theme" />
          </div>
        ) : null}
        {error ? (
          <p className="max-w-44 text-xs text-red-500">{error}</p>
        ) : (
          <div
            ref={containerRef}
            className={`relative cursor-grab touch-none select-none ${dragging ? "cursor-grabbing" : ""}`}
            style={{ width: 256 * scaleValue, height: 280 * scaleValue }}
            onPointerDown={onPointerDown}
            onClick={() => {
              if (!dragStateRef.current) {
                greetRandomly();
              }
            }}
          >
            <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
          </div>
        )}
      </div>
    </div>
  );
}