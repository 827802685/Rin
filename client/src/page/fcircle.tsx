import { SiteMeta } from "../components/site-meta";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Waiting } from "../components/loading";
import { client } from "../app/runtime";
import type { FriendCircleSite, FriendCircleItem } from "@rin/api";

type CircleEntry = {
    site: FriendCircleSite;
    item: FriendCircleItem;
};

export function FriendCirclePage() {
    const { t, i18n } = useTranslation();
    const [sites, setSites] = useState<FriendCircleSite[] | null>(null);
    const [updatedAt, setUpdatedAt] = useState<string | null>(null);
    const ref = useRef(false);

    useEffect(() => {
        if (ref.current) return;
        ref.current = true;
        client.friend.circle().then(({ data }) => {
            if (data) {
                setSites(data.sites || []);
                setUpdatedAt(data.updated_at || null);
            } else {
                setSites([]);
            }
        }).catch(() => setSites([]));
    }, []);

    // 展平为统一时间线流（朋友圈风格），按发布时间倒序
    const entries: CircleEntry[] = (sites || [])
        .flatMap((site) => site.items.map((item) => ({ site, item })))
        .sort((a, b) => {
            const ta = a.item.date ? Date.parse(a.item.date) : 0;
            const tb = b.item.date ? Date.parse(b.item.date) : 0;
            return tb - ta;
        });

    const activeSiteCount = (sites || []).filter((s) => s.items.length > 0).length;
    const dateFormatter = new Intl.DateTimeFormat(i18n.language || "zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });

    return (<SiteMeta title={t('circle.title')}>
        <Waiting for={sites !== null}>
            <main className="w-full flex flex-col justify-center items-center mb-8 t-primary ani-show">
                <div className="wauto text-start py-4 flex flex-row items-end justify-between flex-wrap gap-2">
                    <div>
                        <p className="text-2xl font-bold">{t('circle.title')}</p>
                        <p className="text-sm mt-1 text-neutral-500 font-normal">
                            {sites !== null && t('circle.subtitle', { sites: activeSiteCount, articles: entries.length })}
                            {updatedAt && ` · ${t('circle.updated')} ${dateFormatter.format(new Date(updatedAt))}`}
                        </p>
                    </div>
                    <a href="/friends" className="text-sm text-theme hover:underline">
                        {t('circle.back_to_friends')}
                    </a>
                </div>

                {entries.length === 0 && sites !== null && (
                    <div className="wauto bg-w rounded-xl p-8 text-center mt-4">
                        <i className="ri-rss-line text-4xl text-neutral-400"></i>
                        <p className="text-base mt-3">{t('circle.empty')}</p>
                        <p className="text-sm mt-1 text-neutral-500">{t('circle.empty_hint')}</p>
                    </div>
                )}

                <div className="wauto flex flex-col gap-3 mt-2">
                    {entries.map(({ site, item }, index) => (
                        <a
                            key={`${site.id}-${index}`}
                            href={item.link || site.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-button bg-w rounded-xl px-5 py-4 flex items-center gap-4 hover:scale-[1.01] transition-transform"
                        >
                            <img className="w-10 h-10 rounded-full flex-shrink-0" src={site.avatar} alt={site.name} loading="lazy" />
                            <div className="flex flex-col min-w-0 flex-1 text-start">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm text-neutral-500 font-medium">{site.name}</span>
                                    {item.date && <span className="text-xs text-neutral-400">{dateFormatter.format(new Date(item.date))}</span>}
                                </div>
                                <p className="text-base truncate mt-0.5">{item.title || item.link}</p>
                            </div>
                            <i className="ri-arrow-right-up-line text-neutral-400 flex-shrink-0"></i>
                        </a>
                    ))}
                </div>
            </main>
        </Waiting>
    </SiteMeta>)
}
