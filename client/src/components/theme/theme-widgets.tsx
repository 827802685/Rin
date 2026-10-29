import { lazy, Suspense, useContext } from "react";
import { ClientConfigContext } from "../../state/config";
import { CursorStyle } from "./cursor-style";
import { CursorTrail } from "./cursor-trail";
import { Firework } from "./firework";
import { Live2DWidget } from "./live2d-widget";
import { MusicPlayer } from "./music-player";
// 预加载遮罩要尽早出现：静态导入（lazy 会等 chunk 回来才渲染，错过首屏就失去意义）
import { Preloader } from "./preloader";

// 氛围背景按需加载，不进首屏 chunk（mermaid-render 同款模式）
const AmbientBackground = lazy(() => import("./ambient-background"));
// 二次元特效批次同样按需加载
const FallingSakura = lazy(() => import("./falling-sakura"));
const RibbonBackground = lazy(() => import("./ribbon-background"));
const PowerMode = lazy(() => import("./power-mode"));
const NoteEffect = lazy(() => import("./note-effect"));
const CyberEffects = lazy(() => import("./cyber-effects"));
const SocialFloat = lazy(() => import("./social-float"));

export function ThemeWidgets() {
  const config = useContext(ClientConfigContext);
  const live2dEnabled = config.getBoolean("widget.live2d.enabled");
  const fireworkEnabled = config.getBoolean("widget.firework.enabled");
  const ambientEnabled = config.getBoolean("widget.ambient.enabled");
  const sakuraEnabled = config.getBoolean("widget.sakura.enabled");
  const ribbonEnabled = config.getBoolean("widget.ribbon.enabled");
  const powerModeEnabled = config.getBoolean("widget.power_mode.enabled");
  const noteEnabled = config.getBoolean("widget.note_click.enabled");
  const preloaderEnabled = config.getBoolean("widget.preloader.enabled");
  const cyberEnabled =
    config.getBoolean("widget.cyber.title_glitch") || config.getBoolean("widget.cyber.grid_background");
  const socialEnabled = config.getBoolean("widget.social.enabled");

  return (
    <>
      {preloaderEnabled ? <Preloader /> : null}
      {ambientEnabled ? (
        <Suspense fallback={null}>
          <AmbientBackground />
        </Suspense>
      ) : null}
      {sakuraEnabled ? (
        <Suspense fallback={null}>
          <FallingSakura />
        </Suspense>
      ) : null}
      {ribbonEnabled ? (
        <Suspense fallback={null}>
          <RibbonBackground />
        </Suspense>
      ) : null}
      <CursorStyle />
      <CursorTrail />
      {fireworkEnabled ? <Firework /> : null}
      {live2dEnabled ? <Live2DWidget /> : null}
      <MusicPlayer />
      {powerModeEnabled ? (
        <Suspense fallback={null}>
          <PowerMode />
        </Suspense>
      ) : null}
      {noteEnabled ? (
        <Suspense fallback={null}>
          <NoteEffect />
        </Suspense>
      ) : null}
      {cyberEnabled ? (
        <Suspense fallback={null}>
          <CyberEffects />
        </Suspense>
      ) : null}
      {socialEnabled ? (
        <Suspense fallback={null}>
          <SocialFloat />
        </Suspense>
      ) : null}
    </>
  );
}
