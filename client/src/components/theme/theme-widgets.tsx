import { lazy, Suspense, useContext } from "react";
import { ClientConfigContext } from "../../state/config";
import { CursorStyle } from "./cursor-style";
import { CursorTrail } from "./cursor-trail";
import { Firework } from "./firework";
import { Live2DWidget } from "./live2d-widget";
import { MusicPlayer } from "./music-player";

// 氛围背景按需加载，不进首屏 chunk（mermaid-render 同款模式）
const AmbientBackground = lazy(() => import("./ambient-background"));

export function ThemeWidgets() {
  const config = useContext(ClientConfigContext);
  const live2dEnabled = config.getBoolean("widget.live2d.enabled");
  const fireworkEnabled = config.getBoolean("widget.firework.enabled");
  const ambientEnabled = config.getBoolean("widget.ambient.enabled");

  return (
    <>
      {ambientEnabled ? (
        <Suspense fallback={null}>
          <AmbientBackground />
        </Suspense>
      ) : null}
      <CursorStyle />
      <CursorTrail />
      {fireworkEnabled ? <Firework /> : null}
      {live2dEnabled ? <Live2DWidget /> : null}
      <MusicPlayer />
    </>
  );
}
