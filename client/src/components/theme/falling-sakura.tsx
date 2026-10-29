import { useContext, useEffect, useRef } from "react";
import { ClientConfigContext } from "../../state/config";
import { useColorMode } from "../../utils/darkModeUtils";

type Petal = {
  x: number;
  y: number;
  size: number;
  speedY: number;
  swayAmp: number;
  swayFreq: number;
  phase: number;
  rot: number;
  rotSpeed: number;
  color: string;
};

const PETAL_COUNT = 26;

// 樱花粉调：浅色底用深一档保对比，深色底用高明度
const SAKURA_PALETTE: Record<"light" | "dark", string[]> = {
  light: ["#f7a8c4", "#f193b5", "#eb7fa8", "#fbc6d8"],
  dark: ["#f7a8c4", "#fbc6d8", "#e879a5", "#ffd3e2"],
};

function makePetal(width: number, height: number, initial: boolean, palette: string[]): Petal {
  return {
    x: Math.random() * width,
    y: initial ? Math.random() * height : -20 - Math.random() * 40,
    size: 5 + Math.random() * 7,
    speedY: 0.6 + Math.random() * 1.4,
    swayAmp: 20 + Math.random() * 40,
    swayFreq: 0.005 + Math.random() * 0.01,
    phase: Math.random() * Math.PI * 2,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.04,
    color: palette[Math.floor(Math.random() * palette.length)],
  };
}

export function FallingSakura() {
  const config = useContext(ClientConfigContext);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enabled = config.getBoolean("widget.sakura.enabled");
  const disableOnMobile = config.getBoolean("widget.sakura.disable_on_mobile");
  const colorMode = useColorMode();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (disableOnMobile && window.matchMedia("(pointer: coarse)").matches) {
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
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const palette = SAKURA_PALETTE[colorMode];
    let petals: Petal[] = [];
    let raf = 0;
    let running = true;
    let tick = 0;

    const resize = () => {
      canvas.width = document.documentElement.clientWidth;
      canvas.height = document.documentElement.clientHeight;
    };

    const loop = () => {
      if (!running) {
        return;
      }
      tick += 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (petals.length < PETAL_COUNT && tick % 6 === 0) {
        petals.push(makePetal(canvas.width, canvas.height, false, palette));
      }
      for (const p of petals) {
        p.y += p.speedY;
        p.rot += p.rotSpeed;
        const x = p.x + Math.sin(tick * p.swayFreq + p.phase) * p.swayAmp;
        if (p.y > canvas.height + 20) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
        }
        ctx.save();
        ctx.translate(x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.75;
        // 花瓣：两段贝塞尔拼出的椭圆瓣形
        ctx.beginPath();
        const s = p.size;
        ctx.moveTo(0, -s / 2);
        ctx.bezierCurveTo(s / 2, -s / 2, s / 2, s / 2, 0, s / 2);
        ctx.bezierCurveTo(-s / 2, s / 2, -s / 2, -s / 2, 0, -s / 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
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
  }, [enabled, disableOnMobile, colorMode]);

  if (!enabled) {
    return null;
  }
  if (disableOnMobile && typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) {
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

export default FallingSakura;
