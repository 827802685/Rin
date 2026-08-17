import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientConfigContext } from "../../state/config";

type PixiApp = {
  stage: { addChild(node: unknown): unknown };
  start(): void;
  stop?(): void;
  destroy(removeView?: boolean, stageOptions?: boolean): void;
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

const randomKey = (keys: string[]) => keys[Math.floor(Math.random() * keys.length)];

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
  const modelRef = useRef<PixiModel | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const position = String(config.get("widget.live2d.position") ?? "right");
  const modelUrl = String(config.get("widget.live2d.model") ?? "");
  const scaleValue = Number(config.get("widget.live2d.scale") ?? 1);

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
    const motionPromise = model?.motion ? model.motion("Tap", 0, 3) : undefined;
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

    (async () => {
      try {
        for (const src of LIB_SCRIPTS) {
          await loadScript(src);
        }
        if (cancelled) {
          return;
        }
        const pixi = getPixi();
        if (!pixi) {
          throw new Error("Live2D libraries are not available");
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

        const model = await pixi.live2d.Live2DModel.from(modelUrl, { autoInteract: true });
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
    const container = containerRef.current;
    if (!container) {
      return;
    }
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origX: container.offsetLeft,
      origY: container.offsetTop,
    };
    setDragging(true);
    document.body.style.cursor = "grabbing";
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = dragStateRef.current;
    const container = containerRef.current;
    if (!state || !container) {
      return;
    }
    container.style.left = `${state.origX + (event.clientX - state.startX)}px`;
    container.style.top = `${state.origY + (event.clientY - state.startY)}px`;
    container.style.right = "auto";
  }

  function onPointerUp() {
    dragStateRef.current = null;
    setDragging(false);
    document.body.style.cursor = "";
  }

  const anchorStyle: React.CSSProperties =
    position === "left" ? { left: "1rem" } : { right: "1rem" };

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
    <div className="fixed bottom-2 z-40" style={anchorStyle}>
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
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
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