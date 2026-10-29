import { useState, useEffect } from "react";

export function listenSystemMode() {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function darkModeHandler() {
    const mode = localStorage.getItem("theme");
    if (mode === null || mode === "system") {
      if (mediaQuery.matches) {
        document.documentElement.setAttribute("data-color-mode", "dark");
      } else {
        document.documentElement.setAttribute("data-color-mode", "light");
      }
      window.dispatchEvent(new Event("colorSchemeChange"));
    }
  }

  // 判断当前模式
  darkModeHandler();
  // 监听模式变化
  mediaQuery.addEventListener("change", darkModeHandler);
}

export function getCurrentColorMode(): "light" | "dark" {
  return (
    (document.documentElement.getAttribute("data-color-mode") as
      | "light"
      | "dark") || "light"
  );
}

const FADE_CLASS = "rin-theme-fade";
const FADE_MS = 320;

// 明暗圆形扩散切换的起点（由 ThemeToggle 点击坐标写入）；无坐标时居中。
let viewTransitionOrigin: { x: number; y: number } | null = null;

/** 记录深浅切换的视觉原点（点击位置），供 View Transition 圆形扩散使用。 */
export function setViewTransitionOrigin(x: number, y: number) {
  viewTransitionOrigin = { x, y };
}

type ViewTransitionFunction = (callback: () => void) => { finished: Promise<void> };

/**
 * 切深浅档时临时给 html 挂过渡类，让背景/文字/描边交叉淡化。
 * 类只存活一个过渡周期，避免长期给全树挂 transition 影响滚动性能。
 *
 * 增强：浏览器支持 View Transitions 时，用圆形 clip 从点击点扩散展开新配色
 * （参考 VitePress）。不支持、或用户偏好 reduced-motion 时回退到原交叉淡化。
 */
export function setDataColorModeWithFade(mode: "light" | "dark") {
  const root = document.documentElement;

  const applyMode = () => {
    root.classList.add(FADE_CLASS);
    root.setAttribute("data-color-mode", mode);
    window.setTimeout(() => root.classList.remove(FADE_CLASS), FADE_MS);
    window.dispatchEvent(new Event("colorSchemeChange"));
  };

  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startVT = (
    document as unknown as { startViewTransition?: ViewTransitionFunction }
  ).startViewTransition;

  if (!startVT || reduce) {
    applyMode();
    return;
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = viewTransitionOrigin?.x ?? vw / 2;
  const y = viewTransitionOrigin?.y ?? vh / 2;
  const r = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y));
  root.style.setProperty("--rin-vt-x", `${x}px`);
  root.style.setProperty("--rin-vt-y", `${y}px`);
  root.style.setProperty("--rin-vt-r", `${r}px`);
  viewTransitionOrigin = null;

  try {
    startVT(() => applyMode());
  } catch {
    applyMode();
  }
}

export function useColorMode() {
  const [colorMode, setColorMode] = useState<"light" | "dark">(
    getCurrentColorMode()
  );

  useEffect(() => {
    const updateColorMode = () => {
      setColorMode(getCurrentColorMode());
    };

    // 初始设置
    updateColorMode();

    // 监听颜色模式变化事件
    window.addEventListener("colorSchemeChange", updateColorMode);

    // 清理函数
    return () => {
      window.removeEventListener("colorSchemeChange", updateColorMode);
    };
  }, []);

  return colorMode;
}

export type ThemeMode = "light" | "dark" | "system";

const THEME_MODE_EVENT = "themeModeChange";

export function getThemeMode(): ThemeMode {
  const stored = localStorage.getItem("theme");
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

/**
 * 写入偏好并立即生效。页头和页脚各有一处切换入口，分发事件让两边的图标保持一致。
 */
export function applyThemeMode(mode: ThemeMode) {
  localStorage.setItem("theme", mode);

  const resolved: "light" | "dark" = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  setDataColorModeWithFade(resolved);
  window.dispatchEvent(new Event(THEME_MODE_EVENT));
}

export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode);

  useEffect(() => {
    const sync = () => setMode(getThemeMode());
    window.addEventListener(THEME_MODE_EVENT, sync);
    return () => window.removeEventListener(THEME_MODE_EVENT, sync);
  }, []);

  return [mode, applyThemeMode];
}
