import { useContext, useEffect, useRef } from "react";
import { ClientConfigContext } from "../../state/config";

type TrailPoint = {
  x: number;
  y: number;
  life: number;
};

const MAX_POINTS = 24;
const FADE_TICKS = 16;

export function CursorTrail() {
  const config = useContext(ClientConfigContext);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trailEnabled = config.getBoolean("widget.cursor.trail_enabled");
  // 触屏设备没有悬停指针，不挂拖尾
  const coarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const active = trailEnabled && !coarsePointer;

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

    let points: TrailPoint[] = [];
    let raf = 0;
    let running = true;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const themeRgb = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-rgb")
        .trim();
      return raw || "120 120 120";
    };

    const loop = () => {
      if (!running) {
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      points = points.filter((p) => p.life < FADE_TICKS);
      const rgb = themeRgb();
      points.forEach((p, index) => {
        p.life += 1;
        const alpha = Math.max(0, 1 - p.life / FADE_TICKS) * (index / MAX_POINTS) * 2;
        ctx.globalAlpha = Math.min(alpha, 0.55);
        ctx.fillStyle = `rgb(${rgb})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * Math.max(alpha, 0.1) + 0.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") {
        return;
      }
      points.push({ x: event.clientX, y: event.clientY, life: 0 });
      if (points.length > MAX_POINTS) {
        points = points.slice(points.length - MAX_POINTS);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [active]);

  if (!active) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-30"
      aria-hidden="true"
    />
  );
}
