import { useContext } from "react";
import { ClientConfigContext } from "../../state/config";
import { CursorStyle } from "./cursor-style";
import { Firework } from "./firework";
import { Live2DWidget } from "./live2d-widget";
import { MusicPlayer } from "./music-player";

export function ThemeWidgets() {
  const config = useContext(ClientConfigContext);
  const live2dEnabled = config.getBoolean("widget.live2d.enabled");
  const fireworkEnabled = config.getBoolean("widget.firework.enabled");

  return (
    <>
      <CursorStyle />
      {fireworkEnabled ? <Firework /> : null}
      {live2dEnabled ? <Live2DWidget /> : null}
      <MusicPlayer />
    </>
  );
}
