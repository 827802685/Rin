import { useContext, useEffect } from "react";
import { ClientConfigContext } from "../../state/config";

/**
 * 赛博效果：
 * - widget.cyber.title_glitch  → html 挂 .rin-cyber-glitch，品牌标题 RGB 错位故障动画
 * - widget.cyber.grid_background → 渲染固定层网格背景
 */
export function CyberEffects() {
  const config = useContext(ClientConfigContext);
  const glitch = config.getBoolean("widget.cyber.title_glitch");
  const grid = config.getBoolean("widget.cyber.grid_background");

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.classList.toggle("rin-cyber-glitch", glitch);
    return () => document.documentElement.classList.remove("rin-cyber-glitch");
  }, [glitch]);

  if (!glitch && !grid) {
    return null;
  }

  return grid ? <div className="rin-cyber-grid-bg" aria-hidden="true" /> : null;
}

export default CyberEffects;
