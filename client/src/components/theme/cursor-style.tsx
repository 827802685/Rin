import { useContext } from "react";
import { ClientConfigContext } from "../../state/config";

function cursorRules(enabled: boolean, defaultCursor: string, pointerCursor: string, textCursor: string) {
  if (!enabled) {
    return "";
  }
  const hotspot = "2 2";
  return `
    html, body, *, *::before, *::after {
      cursor: url("${defaultCursor}") ${hotspot}, auto;
    }
    a, button, [role="button"], select, summary, label, input[type="button"], input[type="submit"], input[type="reset"], .link-line a, .cursor-pointer {
      cursor: url("${pointerCursor}") ${hotspot}, pointer;
    }
    input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="number"], input[type="password"], textarea {
      cursor: url("${textCursor}") ${hotspot}, text;
    }
  `;
}

export function CursorStyle() {
  const config = useContext(ClientConfigContext);
  const enabled = config.getBoolean("widget.cursor.enabled");
  const defaultCursor = String(config.get("widget.cursor.default") ?? "");
  const pointerCursor = String(config.get("widget.cursor.pointer") ?? "");
  const textCursor = String(config.get("widget.cursor.text") ?? "");

  if (!enabled) {
    return null;
  }

  return <style>{cursorRules(true, defaultCursor, pointerCursor, textCursor)}</style>;
}
