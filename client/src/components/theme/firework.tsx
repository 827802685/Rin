import { useContext, useEffect, useRef } from "react";
import { ClientConfigContext } from "../../state/config";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

const PARTICLE_COUNT = 18;
const GRAVITY = 0.06;

function buildParticles(x: number, y: number, themeColor: string): Particle[] {
  const palette = ["#ffffff", themeColor, "#a8e0f5", "#6fc4e8"];
  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 4.5;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,
      life: 0,
      maxLife: 40 + Math.random() * 30,
      size: 1.5 + Math.random() * 2,
      color: palette[Math.floor(Math.random() * palette.length)],
    });
  }
  return particles;
}

export function Firework() {
  const config = useContext(ClientConfigContext);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const enabled = config.getBoolean("widget.firework.enabled");
  const disableOnMobile = config.getBoolean("widget.firework.disable_on_mobile");
  const themeColor = String(config.get("theme.color") ?? "#5ab0d8");

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

    let particles: Particle[] = [];
    let raf = 0;
    let running = true;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const spawn = (x: number, y: number) => {
      particles.push(...buildParticles(x, y, themeColor));
      if (particles.length > 400) {
        particles = particles.slice(particles.length - 400);
      }
    };

    const loop = () => {
      if (!running) {
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles = particles.filter((p) => p.life < p.maxLife);
      for (const p of particles) {
        p.life += 1;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += GRAVITY;
        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };

    const onPointerDown = (event: PointerEvent) => {
      spawn(event.clientX, event.clientY);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointerdown", onPointerDown);
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [enabled, disableOnMobile, themeColor]);

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
