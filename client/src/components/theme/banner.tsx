import { useContext, useEffect, useRef, useState } from "react";
import { ClientConfigContext } from "../../state/config";

function parseBanner(raw: unknown): string[] {
  // 兼容两种存储形态：JSON 字符串 / 已解析的数组
  const parsed = (() => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== "string") return [];
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  })();
  return parsed.filter((u): u is string => typeof u === "string" && u.length > 0);
}

/**
 * 站点 Banner（美化清单⑧）：读 config.get("appearance.banner")（图片 URL 的 JSON 数组）。
 * 兼容别名键 "bannerImages"（部分后台/文档用这个名字）。两者都未配置时返回 null（零侵入）。
 * 配置了多张则自动轮播（淡入）+ 滚动视差。
 * 在首页 feeds.tsx 顶部以正常文档流挂载。
 */
export function Banner() {
  const config = useContext(ClientConfigContext);
  const urls =
    parseBanner(config.get("appearance.banner")).length > 0
      ? parseBanner(config.get("appearance.banner"))
      : parseBanner(config.get("bannerImages"));
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
