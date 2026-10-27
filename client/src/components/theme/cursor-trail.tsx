import { useContext, useEffect, useRef } from "react";
import { ClientConfigContext } from "../../state/config";
import { useColorMode } from "../../utils/darkModeUtils";

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
  const colorMode = useColorMode();
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
      canvas.width = document.documentElement.clientWidth;
      canvas.height = document.documentElement.clientHeight;
    };

    // 光点取主题强调色，但浅色页面要压暗、深色页面要提亮，
    // 否则浅色主题（如樱粉、暖砂）的光点会和页面背景糊成一片。
    const themeRgb = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-rgb")
        .trim();
      const parts = raw.split(/\s+/).map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        return "90 176 216";
      }
      const factor = colorMode === "light" ? 0.62 : 1.2;
      const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v * factor)));
      return `${clamp(parts[0])} ${clamp(parts[1])} ${clamp(parts[2])}`;
    };

    const loop = () => {
      if (!running) {
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      points = points.filter((p) => p.life < FADE_TICKS);
      const rgb = themeRgb();
      ctx.shadowColor = `rgb(${rgb})`;
      ctx.shadowBlur = 10;
      points.forEach((p, index) => {
        p.life += 1;
        const alpha = Math.max(0, 1 - p.life / FADE_TICKS) * (index / MAX_POINTS) * 2;
        ctx.globalAlpha = Math.min(alpha, 0.72);
        ctx.fillStyle = `rgb(${rgb})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.4 * Math.max(alpha, 0.12) + 0.6, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;
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
  }, [active, colorMode]);

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
