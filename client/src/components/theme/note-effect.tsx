import { useContext, useEffect } from "react";
import { ClientConfigContext } from "../../state/config";

const NOTE_CHARS = ["♪", "♫", "♩", "♬", "♥"];

/**
 * logo 音符触动：点击头部站点 logo/品牌链接（a[aria-label="home"]）时飘出音符。
 * 开关：widget.note_click.enabled。
 */
export function NoteEffect() {
  const config = useContext(ClientConfigContext);
  const enabled = config.getBoolean("widget.note_click.enabled");

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const brand = target.closest('a[aria-label="home"]');
      if (!brand) {
        return;
      }
      const rect = brand.getBoundingClientRect();
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i += 1) {
        const note = document.createElement("span");
        note.textContent = NOTE_CHARS[Math.floor(Math.random() * NOTE_CHARS.length)];
        note.className = "rin-note";
        note.setAttribute("aria-hidden", "true");
        const dx = (Math.random() - 0.5) * 60;
        const dur = 900 + Math.random() * 600;
        note.style.left = `${rect.left + rect.width / 2 + dx}px`;
        note.style.top = `${rect.top}px`;
        note.style.animationDuration = `${dur}ms`;
        document.body.appendChild(note);
        window.setTimeout(() => note.remove(), dur + 100);
      }
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled]);

  return null;
}

export default NoteEffect;
