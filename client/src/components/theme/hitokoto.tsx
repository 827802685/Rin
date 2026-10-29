import { useContext, useEffect, useRef, useState } from "react";
import { ClientConfigContext } from "../../state/config";

const DEFAULT_QUOTES = [
  "今日もいい日になりますように。",
  "愿你的代码没有 bug。",
  "Wherever you go, the sky is blue.",
  "循序渐进，精益求精。",
];

const TYPE_MS = 90;
const HOLD_MS = 2200;
const ERASE_MS = 40;

/**
 * 页脚一言：打字机轮播引言。
 * 引言来源：config "widget.hitokoto.quotes"（JSON 字符串数组），未配置用内置列表。
 * 开关：widget.hitokoto.enabled。prefers-reduced-motion 时静态展示当前句。
 */
export function Hitokoto() {
  const config = useContext(ClientConfigContext);
  const enabled = config.getBoolean("widget.hitokoto.enabled");
  const [text, setText] = useState("");
  const quotesRef = useRef<string[]>([]);

  const quotesRaw = config.get("widget.hitokoto.quotes");
  let quotes = DEFAULT_QUOTES;
  if (Array.isArray(quotesRaw) && quotesRaw.length > 0 && quotesRaw.every((q) => typeof q === "string")) {
    quotes = quotesRaw as string[];
  }
  quotesRef.current = quotes;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const list = quotesRef.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(list[Math.floor(Math.random() * list.length)] ?? "");
      return;
    }

    let timer = 0;
    let cancelled = false;
    let idx = 0;

    const typePhrase = (phrase: string) => {
      let pos = 0;
      return new Promise<void>((resolve) => {
        const step = () => {
          if (cancelled) {
            return resolve();
          }
          pos += 1;
          setText(phrase.slice(0, pos));
          if (pos < phrase.length) {
            timer = window.setTimeout(step, TYPE_MS);
          } else {
            resolve();
          }
        };
        step();
      });
    };

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });

    (async () => {
      // 打字 → 停留 → 全句擦除 → 下一句
      while (!cancelled) {
        const phrase = list[idx % list.length];
        idx += 1;
        await typePhrase(phrase);
        if (cancelled) return;
        await wait(HOLD_MS);
        if (cancelled) return;
        for (let pos = phrase.length; pos >= 0; pos -= 1) {
          if (cancelled) return;
          setText(phrase.slice(0, pos));
          await wait(ERASE_MS);
        }
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  return (
    <p className="min-h-[1.5em] text-sm text-neutral-500" data-testid="hitokoto">
      <span className="rin-hitokoto-cursor">{text}</span>
    </p>
  );
}
