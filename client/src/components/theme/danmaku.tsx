import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { client } from "../../app/runtime";
import { ClientConfigContext } from "../../state/config";
import { ProfileContext } from "../../state/profile";

/**
 * 评论弹幕层（候选清单：评论弹幕）。
 * - widget.danmaku.enabled 开关（默认关），仅在文章页挂载；
 * - 拉取该文章的评论，以「从右向左飘过屏幕」的弹幕形式展示；
 * - 底部小输入框：发送内容以「【弹幕】」前缀写入评论体系（登录用户直接发，游客带昵称）；
 * - 尊重 prefers-reduced-motion：静态列出前几条，不播放动画。
 */

interface DanmakuItem {
    key: string;
    text: string;
    delay: number;
    duration: number;
    top: number;
}

const DANMAKU_PREFIX = "【弹幕】";

function toDanmakuTexts(comments: Array<{ content: string; id?: number }>): string[] {
    return comments
        .map((c) => (c.content ?? "").trim())
        .filter((text) => text.length > 0 && text.length <= 140);
}

export function Danmaku({ feedId }: { feedId: number | string }) {
    const config = useContext(ClientConfigContext);
    const profile = useContext(ProfileContext);
    const { t } = useTranslation();
    const enabled = config.getBoolean("widget.danmaku.enabled");
    const [texts, setTexts] = useState<string[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const reloadRef = useRef(0);

    useEffect(() => {
        if (!enabled) return;
        let alive = true;
        const feedIdNum = Number(feedId);
        if (!Number.isInteger(feedIdNum) || feedIdNum <= 0) return;
        client.comment
            .list(feedIdNum)
            .then(({ data }) => {
                if (!alive || !Array.isArray(data)) return;
                setTexts(toDanmakuTexts(data as any).slice(-40));
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [enabled, feedId, reloadRef.current]);

    const items: DanmakuItem[] = useMemo(() => {
        // 错开起始延迟与轨道，避免堆在同一条线上
        return texts.map((text, index) => ({
            key: `${index}-${text.slice(0, 12)}`,
            text,
            delay: index * 2.2,
            duration: 11 + (index % 4) * 2.5,
            top: 8 + (index % 6) * 30,
        }));
    }, [texts]);

    if (!enabled) {
        return null;
    }

    async function send() {
        const content = input.trim();
        const feedIdNum = Number(feedId);
        if (!content || sending || !Number.isInteger(feedIdNum) || feedIdNum <= 0) return;
        setSending(true);
        try {
            const body: Record<string, string> = {
                content: `${DANMAKU_PREFIX}${content}`,
            };
            if (!profile?.id) {
                body.guestName = t("danmaku.guest_name");
            }
            const { error } = await client.comment.create(feedIdNum, body as any);
            if (error) {
                alert(error.value as string);
                return;
            }
            setInput("");
            reloadRef.current += 1;
            setTexts((prev) => [...prev.slice(-39), `${DANMAKU_PREFIX}${content}`]);
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-30" data-rin-widget="danmaku">
            {/* 弹幕轨道 */}
            <div className="relative h-40 w-full overflow-hidden">
                {items.map((item) => (
                    <span
                        key={item.key}
                        className="rin-danmaku absolute whitespace-nowrap rounded-full bg-black/35 px-3 py-1 text-sm text-white backdrop-blur-sm"
                        style={{
                            top: `${item.top}px`,
                            animationDelay: `${item.delay}s`,
                            animationDuration: `${item.duration}s`,
                        }}
                    >
                        {item.text}
                    </span>
                ))}
            </div>
            {/* 发送栏：唯一可交互区域 */}
            <div className="pointer-events-auto mx-auto mt-1 flex w-[min(92vw,26rem)] items-center gap-2 rounded-full bg-w/90 p-1 shadow-lg backdrop-blur">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") void send();
                    }}
                    maxLength={100}
                    placeholder={t("danmaku.placeholder")}
                    aria-label={t("danmaku.placeholder")}
                    className="min-w-0 flex-1 bg-transparent px-3 py-1 text-sm t-primary outline-none"
                />
                <button
                    type="button"
                    onClick={() => void send()}
                    disabled={sending || input.trim().length === 0}
                    className="flex h-7 items-center gap-1 rounded-full bg-theme px-3 text-xs text-white transition hover:bg-theme-hover disabled:opacity-50 rin-glass-accent"
                >
                    <i className="ri-send-plane-fill" />
                    {t("danmaku.send")}
                </button>
            </div>
        </div>
    );
}
