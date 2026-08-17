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

export function Live2DWidget() {
  const config = useContext(ClientConfigContext);
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const position = String(config.get("widget.live2d.position") ?? "right");
  const modelUrl = String(config.get("widget.live2d.model") ?? "");
  const scaleValue = Number(config.get("widget.live2d.scale") ?? 1);

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
        appInstance.stage.addChild(model);

        const targetHeight = 280 * scaleValue;
        const aspect = model.width / model.height;
        const targetWidth = targetHeight * aspect;
        model.scale.set(targetWidth / model.width);
        container.style.width = `${Math.round(targetWidth)}px`;
        container.style.height = `${Math.round(targetHeight)}px`;
        appInstance.start();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (app) {
        try {
          app.destroy(true);
        } catch {
          // ignore teardown errors
        }
      }
    };
  }, [modelUrl, scaleValue]);

  const style = position === "left" ? { left: "1rem" } : { right: "1rem" };

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="fixed bottom-4 z-40 rounded-full bg-theme px-3 py-2 text-white shadow-lg transition hover:bg-theme-hover"
        style={style}
        aria-label={t("theme.live2d.show")}
      >
        <i className="ri-magic-line" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-2 z-40" style={style}>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="rounded-full bg-w p-1 text-xs shadow t-primary transition hover:opacity-70"
          aria-label={t("theme.live2d.hide")}
        >
          <i className="ri-close-line" />
        </button>
      </div>
      {error ? (
        <p className="max-w-44 text-xs text-red-500">{error}</p>
      ) : (
        <div ref={containerRef} className="relative">
          <canvas ref={canvasRef} style={{ display: "block" }} />
        </div>
      )}
    </div>
  );
}
