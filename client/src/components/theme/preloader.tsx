import { useContext, useEffect, useState } from "react";
import { ClientConfigContext } from "../../state/config";

const SESSION_KEY = "rin-preloader-shown";

/**
 * 网页预加载动画：进站首屏遮罩，window load 后淡出。
 * 开关：widget.preloader.enabled。同一会话只显示一次（sessionStorage）。
 */
export function Preloader() {
  const config = useContext(ClientConfigContext);
  const enabled = config.getBoolean("widget.preloader.enabled");
  const [phase, setPhase] = useState<"hidden" | "showing" | "leaving">("hidden");

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (typeof sessionStorage === "undefined") {
      return;
    }
    if (sessionStorage.getItem(SESSION_KEY)) {
      return;
    }
    sessionStorage.setItem(SESSION_KEY, "1");

    setPhase("showing");
    let timer = 0;
    const leave = () => {
      setPhase((prev) => (prev === "showing" ? "leaving" : prev));
      timer = window.setTimeout(() => setPhase("hidden"), 480);
    };
    if (document.readyState === "complete") {
      timer = window.setTimeout(leave, 500);
    } else {
      window.addEventListener("load", leave, { once: true });
      // 兜底：资源卡住也最多 2.5s 收场
      const fallback = window.setTimeout(leave, 2500);
      return () => {
        window.clearTimeout(timer);
        window.clearTimeout(fallback);
        window.removeEventListener("load", leave);
      };
    }
    return () => window.clearTimeout(timer);
  }, [enabled]);

  if (phase === "hidden") {
    return null;
  }

  return (
    <div
      className={`rin-preloader ${phase === "leaving" ? "rin-preloader-leaving" : ""}`}
      aria-hidden="true"
    >
      <div className="rin-preloader-ring" />
    </div>
  );
}
