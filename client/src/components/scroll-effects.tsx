import { useEffect } from "react";

/**
 * 滚动增强（美化清单④）：全局观察 .rin-reveal（淡入）与 .rin-parallax（视差）。
 * - IntersectionObserver 触发淡入，MutationObserver 覆盖 SPA 路由切换后新挂载的节点；
 * - 不支持 IO 或用户偏好 reduced-motion 时直接全部显示，绝不隐藏内容。
 */
export function ScrollEffects() {
  useEffect(() => {
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const revealEls = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".rin-reveal"));
    const parallaxEls = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".rin-parallax"));

    if (reduce || typeof IntersectionObserver === "undefined") {
      revealEls().forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );

    const observed = new WeakSet<Element>();
    const scanReveals = () => {
      for (const el of revealEls()) {
        if (!observed.has(el)) {
          observed.add(el);
          io.observe(el);
        }
      }
    };
    scanReveals();
    const moReveal = new MutationObserver(scanReveals);
    moReveal.observe(document.body, { childList: true, subtree: true });

    // 视差：随滚动对 .rin-parallax 做轻微反向位移
    const parallaxSet = new Set<HTMLElement>();
    const scanParallax = () => {
      for (const el of parallaxEls()) parallaxSet.add(el);
    };
    scanParallax();
    const moParallax = new MutationObserver(scanParallax);
    moParallax.observe(document.body, { childList: true, subtree: true });

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const vh = window.innerHeight;
        for (const el of parallaxSet) {
          const rect = el.getBoundingClientRect();
          const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
          const speed = Number(el.dataset.parallax ?? "0.12");
          el.style.transform = `translateY(${(-progress * speed * 120).toFixed(2)}px)`;
        }
      });
    };
    if (parallaxSet.size > 0) {
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
    }

    return () => {
      io.disconnect();
      moReveal.disconnect();
      moParallax.disconnect();
      if (parallaxSet.size > 0) {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        if (raf) cancelAnimationFrame(raf);
      }
    };
  }, []);

  return null;
}
