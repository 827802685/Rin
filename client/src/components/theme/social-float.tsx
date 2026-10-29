import { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ClientConfigContext } from "../../state/config";

/**
 * 博主社交悬浮挂件（候选清单：侧边 floating 联系卡）。
 * - widget.social.enabled 开关 + widget.social.links 配置：
 *   JSON 数组 [{ "icon": "ri-mail-line", "url": "mailto:...", "title": "邮箱" }, ...]
 * - 无配置不渲染（零侵入）。固定在视口右侧中部，hover 展开标题。
 */

interface SocialLink {
    icon: string;
    url: string;
    title?: string;
}

function parseLinks(raw: unknown): SocialLink[] {
    let parsed: unknown = raw;
    if (typeof raw === "string") {
        try {
            parsed = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    return parsed.filter(
        (item): item is SocialLink =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as SocialLink).url === "string" &&
            (item as SocialLink).url.length > 0 &&
            typeof (item as SocialLink).icon === "string" &&
            (item as SocialLink).icon.length > 0,
    );
}

export function SocialFloat() {
    const config = useContext(ClientConfigContext);
    const { t } = useTranslation();
    const enabled = config.getBoolean("widget.social.enabled");
    const links = useMemo(() => parseLinks(config.get("widget.social.links")), [config]);

    if (!enabled || links.length === 0) {
        return null;
    }

    return (
        <div
            className="fixed end-2 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-2"
            data-rin-widget="social"
            aria-label={t("social.aria_label")}
        >
            {links.map((link, index) => (
                <a
                    key={`${link.url}-${index}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link.title ?? ""}
                    className="group flex h-10 w-10 items-center justify-center rounded-full bg-w text-lg shadow-xl shadow-light t-primary transition hover:scale-110 hover:text-theme"
                >
                    <i className={link.icon} />
                </a>
            ))}
        </div>
    );
}

export default SocialFloat;
