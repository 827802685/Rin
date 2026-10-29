import { useContext, useEffect, useRef } from "react";
import { ClientConfigContext } from "../../state/config";

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

const SPARKS_PER_KEY = 5;
const MAX_SPARKS = 240;
const POWER_PALETTE = [
  "#5ab0d8", "#f7a8c4", "#ffd166", "#7ee8a2", "#c792ea", "#ff8a65",
];

function measureCaretX(target: HTMLElement): number {
  // 用 canvas measureText 估算光标横向位置（input 的 selectionStart 即文本长度）
  let offset = 0;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const idx = target.selectionStart ?? target.value.length;
    const probe = document.createElement("canvas").getContext("2d");
    if (probe) {
      const style = window.getComputedStyle(target);
      probe.font = `${style.fontSize} ${style.fontFamily}`;
      offset = probe.measureText(target.value.slice(0, idx)).width;
    }
  }
  return target.getBoundingClientRect().left + parseFloat(window.getComputedStyle(target).paddingLeft || "0") + offset;
}

export function PowerMode() {
  const config = useContext(ClientConfigContext);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enabled = config.getBoolean("widget.power_mode.enabled");

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

    let sparks: Spark[] = [];
    let raf = 0;
    let running = true;

    const resize = () => {
      canvas.width = document.documentElement.clientWidth;
      canvas.height = document.documentElement.clientHeight;
    };

    const spawn = (x: number, y: number) => {
      for (let i = 0; i < SPARKS_PER_KEY; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.8 + Math.random() * 2.6;
        sparks.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.6,
          life: 0,
          maxLife: 22 + Math.random() * 14,
          size: 1 + Math.random() * 2,
          color: POWER_PALETTE[Math.floor(Math.random() * POWER_PALETTE.length)],
        });
      }
      if (sparks.length > MAX_SPARKS) {
        sparks = sparks.slice(sparks.length - MAX_SPARKS);
      }
    };

    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const isTextInput =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
      if (!isTextInput) {
        return;
      }
      const rect = target.getBoundingClientRect();
      const x = Math.min(measureCaretX(target), rect.right - 4);
      const y = rect.top + rect.height / 2;
      spawn(x, y);
      // 抖动：短暂挂类，动画结束自动恢复
      target.classList.add("rin-power-shake");
      window.setTimeout(() => target.classList.remove("rin-power-shake"), 120);
    };

    const loop = () => {
      if (!running) {
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sparks = sparks.filter((s) => s.life < s.maxLife);
      for (const s of sparks) {
        s.life += 1;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.04;
        const alpha = Math.max(0, 1 - s.life / s.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("input", onInput, true);
    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("input", onInput, true);
    };
  }, [enabled]);

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

export default PowerMode;
