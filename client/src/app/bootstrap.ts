import i18n from "i18next";
import Backend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { listenSystemMode } from "../utils/darkModeUtils";

let bootstrapped = false;

// 语言包目录只有这四个。浏览器上报的语言常常是裸 `zh`（手机浏览器尤其常见），
// 而 `zh/translation.json` 并不存在 —— Worker 对未命中的路径会兜底回 index.html，
// HTTP 状态仍是 200，i18next 拿 HTML 去 JSON.parse 失败后整页退化成显示
// `article.title` 这类 key。所以检测到的语言必须先收敛到真实存在的目录。
export const SUPPORTED_LNGS = ["zh-CN", "zh-TW", "en", "ja"];

export function normalizeLng(detected: string): string {
  const s = String(detected || "")
    .toLowerCase()
    .replace(/_/g, "-");
  if (s.startsWith("zh")) {
    // 繁体：地区为 TW/HK/MO，或显式标注 Hant（浏览器常上报 zh-Hant、zh-Hant-TW）。
    const tw = s === "zh-tw" || s === "zh-hk" || s === "zh-mo" || /^zh-hant(?:-|$)/.test(s);
    return tw ? "zh-TW" : "zh-CN";
  }
  if (s.startsWith("ja")) return "ja";
  return "en";
}

/**
 * 把当前语言写回 <html lang>。
 * index.html 里写死的是 `lang="en"`，切换语言后不会跟着变，会导致：
 * 屏幕阅读器按英语音系读中文、Chrome 弹「是否翻译此页面」、搜索引擎语言判定失准。
 * 这里只做属性同步，不参与任何渲染，重复调用幂等。
 */
export function syncDocumentLang(lng: string) {
  if (typeof document === "undefined") return;
  const next = normalizeLng(lng);
  if (document.documentElement.lang !== next) {
    document.documentElement.lang = next;
  }
}

export function bootstrapApp() {
  if (bootstrapped) {
    return;
  }

  listenSystemMode();

  i18n
    .use(Backend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      backend: {
        loadPath: "/locales/{{lng}}/{{ns}}.json",
      },
      fallbackLng: "en",
      supportedLngs: SUPPORTED_LNGS,
      // 默认 "all" 会为 zh-CN 额外请求 zh/，正中上面那个兜底陷阱。
      load: "currentOnly",
      detection: {
        convertDetectedLanguage: normalizeLng,
      },
      interpolation: {
        escapeValue: false,
      },
    })
    .then(() => syncDocumentLang(i18n.resolvedLanguage ?? i18n.language));

  // 手动切换语言时 init 的 promise 早已 settle，必须靠事件再同步一次。
  i18n.on("languageChanged", syncDocumentLang);

  bootstrapped = true;
}
