import { useContext } from "react";
import { ClientConfigContext } from "../../state/config";
import { useColorMode } from "../../utils/darkModeUtils";

/**
 * 波浪页脚：footer 顶部的双层 SVG 波浪，CSS 动画横向漂移。
 * 开关：widget.wave_footer.enabled。prefers-reduced-motion 时静止。
 */
export function WaveFooter() {
  const config = useContext(ClientConfigContext);
  const enabled = config.getBoolean("widget.wave_footer.enabled");
  const colorMode = useColorMode();

  if (!enabled) {
    return null;
  }

  const fill = colorMode === "dark" ? "rgba(168,224,245,0.10)" : "rgba(47,111,146,0.10)";
  const fillBack = colorMode === "dark" ? "rgba(168,224,245,0.06)" : "rgba(47,111,146,0.06)";

  const wavePath =
    "M0,64 C240,96 480,32 720,64 C960,96 1200,32 1440,64 L1440,120 L0,120 Z";

  return (
    <div className="rin-wave pointer-events-none relative h-[80px] w-full overflow-hidden" aria-hidden="true">
      <svg
        className="rin-wave-back absolute bottom-0 left-0 h-full w-[200%]"
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
      >
        <path d={wavePath} fill={fillBack} />
      </svg>
      <svg
        className="rin-wave-front absolute bottom-0 left-0 h-full w-[200%]"
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
      >
        <path d={wavePath} fill={fill} />
      </svg>
    </div>
  );
}
