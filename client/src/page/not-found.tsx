import { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/button";
import { SiteMeta } from "../components/site-meta";
import { ClientConfigContext } from "../state/config";

/**
 * 404 动漫插画页（候选清单：404 插画 + 精美加载）。
 * - 默认内置樱花 + 鸟居风格的 SVG 插画（零外部资源，主题色跟随 currentColor）；
 * - 后台配置 appearance.notfound_image（图片 URL）时优先使用自定义插画；
 * - 仅替换兜底路由（error.not_found），其它业务错误仍走 ErrorPage。
 */

function SakuraShrineIllustration() {
    return (
        <svg viewBox="0 0 320 200" className="h-44 w-auto" role="img" aria-hidden="true">
            {/* 夜空渐隐 */}
            <defs>
                <linearGradient id="rin-404-sky" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--theme, #5ab0d8)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="var(--theme, #5ab0d8)" stopOpacity="0" />
                </linearGradient>
            </defs>
            <rect x="0" y="0" width="320" height="200" fill="url(#rin-404-sky)" />
            {/* 月亮 */}
            <circle cx="262" cy="44" r="20" fill="var(--theme, #5ab0d8)" opacity="0.5" />
            {/* 鸟居 */}
            <g stroke="currentColor" strokeWidth="7" strokeLinecap="round" fill="none">
                <path d="M96 60 H 224" />
                <path d="M104 78 H 216" strokeWidth="5" />
                <path d="M120 78 V 168" />
                <path d="M200 78 V 168" />
                <path d="M132 96 H 188" strokeWidth="4" />
            </g>
            {/* 樱花枝 */}
            <g fill="currentColor" opacity="0.85">
                <path d="M40 40 q 30 -18 62 -6 q -34 4 -54 20 z" />
                <circle cx="46" cy="36" r="7" />
                <circle cx="62" cy="28" r="6" />
                <circle cx="78" cy="26" r="5" />
                <circle cx="94" cy="30" r="4" />
            </g>
            {/* 飘落花瓣 */}
            <g fill="currentColor" opacity="0.55">
                <ellipse cx="70" cy="90" rx="5" ry="3" transform="rotate(30 70 90)" />
                <ellipse cx="130" cy="120" rx="5" ry="3" transform="rotate(-20 130 120)" />
                <ellipse cx="220" cy="100" rx="5" ry="3" transform="rotate(45 220 100)" />
                <ellipse cx="270" cy="140" rx="5" ry="3" transform="rotate(-35 270 140)" />
                <ellipse cx="180" cy="70" rx="4" ry="2.5" transform="rotate(15 180 70)" />
            </g>
            {/* 石阶 */}
            <g stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.7">
                <path d="M100 168 H 220" />
                <path d="M88 184 H 232" />
            </g>
        </svg>
    );
}

export function NotFoundPage() {
    const { t } = useTranslation();
    const config = useContext(ClientConfigContext);
    const customImage = useMemo(() => {
        const raw = config.get<string | undefined>("appearance.notfound_image");
        return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
    }, [config]);

    return (
        <SiteMeta title={t("error.title")}>
            <div className="ani-show flex w-full flex-row justify-center">
                <div className="m-2 flex wauto flex-col items-center justify-center space-y-4 rounded-2xl bg-w p-8">
                    {customImage ? (
                        <img src={customImage} alt="" className="h-44 w-auto rounded-xl object-contain" />
                    ) : (
                        <div className="t-primary">
                            <SakuraShrineIllustration />
                        </div>
                    )}
                    <p className="font-bold t-primary" aria-hidden="true">
                        <span className="align-top text-2xl">✿ </span>
                        <span className="text-6xl tracking-widest">4</span>
                        <span className="mx-1 inline-block rotate-12 text-5xl">🌸</span>
                        <span className="text-6xl tracking-widest">4</span>
                    </p>
                    <h1 className="text-lg font-bold t-primary">{t("error.not_found")}</h1>
                    <Button
                        title={t("index.back")}
                        onClick={() => (window.location.href = "/")}
                    />
                </div>
            </div>
        </SiteMeta>
    );
}
