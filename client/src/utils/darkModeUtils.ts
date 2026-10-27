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

/**
 * 切深浅档时临时给 html 挂过渡类，让背景/文字/描边交叉淡化。
 * 类只存活一个过渡周期，避免长期给全树挂 transition 影响滚动性能。
 * 不引入 View Transitions：与 Wouter SPA 路由的兼容性风险未知，放弃。
 */
export function setDataColorModeWithFade(mode: "light" | "dark") {
  const root = document.documentElement;
  root.classList.add(FADE_CLASS);
  root.setAttribute("data-color-mode", mode);
  window.setTimeout(() => {
    root.classList.remove(FADE_CLASS);
  }, FADE_MS);
  window.dispatchEvent(new Event("colorSchemeChange"));
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
