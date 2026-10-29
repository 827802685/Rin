import { useContext, useEffect, useRef } from "react";
import { ClientConfigContext } from "../../state/config";
import { useColorMode } from "../../utils/darkModeUtils";

type NestPoint = { x: number; y: number; vx: number; vy: number };

const NEST_COUNT = 60;
const NEST_LINK_DIST = 120;

function nestColor(colorMode: "light" | "dark"): string {
  return colorMode === "dark" ? "168,224,245" : "47,111,146";
}

export function RibbonBackground() {
  const config = useContext(ClientConfigContext);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enabled = config.getBoolean("widget.ribbon.enabled");
  const mode = String(config.get("widget.ribbon.mode") ?? "nest");
  const colorMode = useColorMode();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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

    let raf = 0;
    let running = true;
    let tick = 0;
    let points: NestPoint[] = [];

    const resize = () => {
      canvas.width = document.documentElement.clientWidth;
      canvas.height = document.documentElement.clientHeight;
      if (mode === "nest") {
        points = [];
        for (let i = 0; i < NEST_COUNT; i += 1) {
          points.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
          });
        }
      }
    };

    const loop = () => {
      if (!running) {
        return;
      }
      tick += 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (mode === "ribbon") {
        // 三条正弦彩带，随 tick 流动
        const rgb = nestColor(colorMode);
        for (let r = 0; r < 3; r += 1) {
          const baseY = canvas.height * (0.25 + r * 0.25);
          const amp = 40 + r * 18;
          const freq = 0.004 + r * 0.001;
          const speed = tick * (0.6 + r * 0.25);
          ctx.beginPath();
          for (let x = 0; x <= canvas.width; x += 8) {
            const y = baseY + Math.sin(x * freq + speed) * amp;
            if (x === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.strokeStyle = `rgba(${rgb},${0.22 - r * 0.05})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        // canvas_nest 风格：漂浮点 + 近距连线
        const rgb = nestColor(colorMode);
        for (const p of points) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
          if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        }
        for (let i = 0; i < points.length; i += 1) {
          for (let j = i + 1; j < points.length; j += 1) {
            const dx = points[i].x - points[j].x;
            const dy = points[i].y - points[j].y;
            const dist = Math.hypot(dx, dy);
            if (dist < NEST_LINK_DIST) {
              ctx.strokeStyle = `rgba(${rgb},${0.35 * (1 - dist / NEST_LINK_DIST)})`;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(points[i].x, points[i].y);
              ctx.lineTo(points[j].x, points[j].y);
              ctx.stroke();
            }
          }
        }
        ctx.fillStyle = `rgba(${rgb},0.6)`;
        for (const p of points) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [enabled, mode, colorMode]);

  if (!enabled) {
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

export default RibbonBackground;
