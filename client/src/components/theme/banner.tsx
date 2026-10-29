import { useContext, useEffect, useRef, useState } from "react";
import { ClientConfigContext } from "../../state/config";

function parseBanner(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((u): u is string => typeof u === "string" && u.length > 0);
  } catch {
    return [];
  }
}

/**
 * 站点 Banner（美化清单⑧）：读 config.get("appearance.banner")（图片 URL 的 JSON 数组）。
 * 未配置时返回 null（零侵入）。配置了多张则自动轮播（淡入）+ 滚动视差。
 * 在首页 feeds.tsx 顶部以正常文档流挂载。
 */
export function Banner() {
  const config = useContext(ClientConfigContext);
  const urls = parseBanner(config.get("appearance.banner"));
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (urls.length <= 1) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % urls.length),
      5000,
    );
    return () => window.clearInterval(id);
  }, [urls.length]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY || 0;
        el.style.transform = `translateY(${Math.min(y * 0.4, 220).toFixed(1)}px)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  if (urls.length === 0) return null;

  return (
    <div className="relative h-44 w-full overflow-hidden md:h-60" aria-hidden="true">
      <div
        ref={trackRef}
        className="rin-parallax absolute inset-x-0 -top-16 h-[calc(100%+4rem)] will-change-transform"
        data-parallax="0.18"
      >
        {urls.map((u, i) => (
          <img
            key={`${u}-${i}`}
            src={u}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
              i === index ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-[var(--surface-page)]" />
    </div>
  );
}
