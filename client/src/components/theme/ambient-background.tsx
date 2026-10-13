import { useContext, useEffect, useRef } from "react";
import { ClientConfigContext } from "../../state/config";

/**
 * 氛围背景：单一 canvas 引擎 + 程序化粒子预设，不加载任何图片素材。
 * 默认关闭、移动端可降级、固定在内容层之下（-z-10），不吃任何点击。
 */

export const AMBIENT_TYPES = ["snow", "sakura", "starry", "bubbles"] as const;

export type AmbientType = (typeof AMBIENT_TYPES)[number];

export function normalizeAmbientType(value: string): AmbientType {
  return AMBIENT_TYPES.includes(value as AmbientType) ? (value as AmbientType) : "snow";
}

type Sprite = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  phase: number;
};

function makeSprite(width: number, height: number, type: AmbientType, fromTop: boolean): Sprite {
  const base = {
    x: Math.random() * width,
    y: fromTop ? -10 : Math.random() * height,
    vx: 0,
    vy: 0,
    size: 0,
    spin: (Math.random() - 0.5) * 0.02,
    angle: Math.random() * Math.PI * 2,
    phase: Math.random() * Math.PI * 2,
  };
  switch (type) {
    case "snow":
      return { ...base, size: 1.5 + Math.random() * 2.5, vy: 0.4 + Math.random() * 0.8, vx: (Math.random() - 0.5) * 0.3 };
    case "sakura":
      return { ...base, size: 4 + Math.random() * 5, vy: 0.5 + Math.random() * 0.9, vx: 0.2 + Math.random() * 0.6, spin: (Math.random() - 0.5) * 0.06 };
    case "starry":
      return { ...base, y: Math.random() * height, size: 0.6 + Math.random() * 1.6, vx: 0, vy: 0 };
    case "bubbles":
      return { ...base, y: fromTop ? height + 10 : Math.random() * height, size: 3 + Math.random() * 8, vx: (Math.random() - 0.5) * 0.2, vy: -(0.3 + Math.random() * 0.7) };
  }
}

export function AmbientBackground() {
  const config = useContext(ClientConfigContext);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enabled = config.getBoolean("widget.ambient.enabled");
  const type = normalizeAmbientType(String(config.get("widget.ambient.type") ?? "snow"));
  const opacity = Math.min(Math.max(Number(config.get("widget.ambient.opacity") ?? 0.6), 0.1), 1);
  const count = Math.min(Math.max(Number(config.get("widget.ambient.count") ?? 40), 5), 120);
  const disableOnMobile = config.getBoolean("widget.ambient.disable_on_mobile");
  const coarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const active = enabled && !(disableOnMobile && coarsePointer);

  useEffect(() => {
    if (!active) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let sprites: Sprite[] = [];
    let raf = 0;
    let running = true;
    let tick = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const seed = () => {
      sprites = [];
      for (let i = 0; i < count; i += 1) {
        // 星夜铺满全屏，其余类型先在屏外候场
        sprites.push(makeSprite(canvas.width, canvas.height, type, type !== "starry"));
      }
    };

    const drawSprite = (s: Sprite) => {
      ctx.save();
      ctx.translate(s.x, s.y);
      switch (type) {
        case "snow":
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(0, 0, s.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "sakura": {
          ctx.rotate(s.angle);
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = "#f6b9c8";
          ctx.beginPath();
          ctx.ellipse(0, 0, s.size, s.size * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "starry": {
          // 亮度随相位闪烁
          const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(tick * 0.02 + s.phase));
          ctx.globalAlpha = twinkle;
          ctx.fillStyle = "#e8ecff";
          ctx.beginPath();
          ctx.arc(0, 0, s.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "bubbles":
          ctx.globalAlpha = 0.5;
          ctx.strokeStyle = "#cfe8ff";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, 0, s.size, 0, Math.PI * 2);
          ctx.stroke();
          break;
      }
      ctx.restore();
    };

    const loop = () => {
      if (!running) {
        return;
      }
      tick += 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of sprites) {
        s.x += s.vx + (type === "snow" || type === "sakura" ? Math.sin(tick * 0.01 + s.phase) * 0.3 : 0);
        s.y += s.vy;
        s.angle += s.spin;
        // 出界回卷
        if (type === "bubbles" ? s.y < -12 : s.y > canvas.height + 12) {
          Object.assign(s, makeSprite(canvas.width, canvas.height, type, true));
        }
        if (s.x > canvas.width + 12) s.x = -10;
        if (s.x < -12) s.x = canvas.width + 10;
        drawSprite(s);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };

    const onResize = () => {
      resize();
      seed();
    };

    resize();
    seed();
    window.addEventListener("resize", onResize);
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [active, type, count]);

  if (!active) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ opacity }}
      aria-hidden="true"
    />
  );
}

export default AmbientBackground;
