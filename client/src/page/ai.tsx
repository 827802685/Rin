import { useContext, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import type { AIChatMessage } from "@rin/api";
import { client } from "../app/runtime";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { ClientConfigContext } from "../state/config";
import { siteName } from "../utils/constants";

export function AIPage() {
    const { t } = useTranslation();
    const siteConfig = useSiteConfig();
    const config = useContext(ClientConfigContext);
    const aiEnabled = config.get<boolean>("ai_summary.enabled") === true;

    const [messages, setMessages] = useState<AIChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [messages, loading]);

    async function handleSend() {
        const content = input.trim();
        if (!content || loading) return;

        const nextMessages: AIChatMessage[] = [
            ...messages,
            { role: "user", content },
        ];
        setMessages(nextMessages);
        setInput("");
        setLoading(true);
        setError(null);

        const { data, error } = await client.chat.send(nextMessages);

        if (error) {
            setError(error.value || t("ai.chat.error"));
        } else if (data?.content) {
            setMessages((prev) => [...prev, { role: "assistant", content: data.content }]);
        } else {
            setError(t("ai.chat.error"));
        }
        setLoading(false);
    }

    return (
        <>
            <Helmet>
                <title>{`${t("ai.title")} - ${siteConfig.name}`}</title>
                <meta property="og:site_name" content={siteName} />
                <meta property="og:title" content={t("ai.title")} />
                <meta property="og:image" content={siteConfig.avatar} />
                <meta property="og:type" content="article" />
                <meta property="og:url" content={document.URL} />
            </Helmet>
            <main className="w-full flex flex-col justify-center items-center mb-8 t-primary ani-show">
                <div className="wauto">
                    <div className="flex flex-col overflow-hidden rounded-2xl bg-w shadow-xl shadow-light">
                        <div className="flex flex-row items-center justify-between px-6 py-4">
                            <h1 className="text-xl font-bold">{t("ai.title")}</h1>
                            {messages.length > 0 && (
                                <button
                                    onClick={() => {
                                        setMessages([]);
                                        setError(null);
                                    }}
                                    className="rounded-full px-3 py-1 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-white/5"
                                >
                                    {t("ai.chat.clear")}
                                </button>
                            )}
                        </div>

                        <div ref={scrollRef} className="flex h-[480px] flex-col space-y-4 overflow-y-auto px-6 py-4">
                            {messages.length === 0 && !aiEnabled ? (
                                <div className="flex flex-1 flex-col items-center justify-center space-y-2 text-center">
                                    <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("ai.chat.disabled")}</p>
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="flex flex-1 flex-col items-center justify-center space-y-2 text-center">
                                    <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("ai.chat.empty")}</p>
                                </div>
                            ) : (
                                messages.map((message, index) => (
                                    <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                                        <div
                                            className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm ${
                                                message.role === "user"
                                                    ? "bg-theme text-white"
                                                    : "bg-neutral-100 dark:bg-neutral-800"
                                            }`}
                                        >
                                            {message.content}
                                        </div>
                                    </div>
                                ))
                            )}
                            {loading && (
                                <div className="flex justify-start">
                                    <div className="flex items-center space-x-1 rounded-2xl bg-neutral-100 px-4 py-3 text-sm dark:bg-neutral-800">
                                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" />
                                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:0.15s]" />
                                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:0.3s]" />
                                    </div>
                                </div>
                            )}
                            {error && (
                                <div className="flex justify-center">
                                    <p className="text-sm text-rose-500 dark:text-rose-400">{error}</p>
                                </div>
                            )}
                        </div>

                        <div className="border-t border-black/5 px-6 py-4 dark:border-white/10">
                            <div className="flex flex-row items-center space-x-2">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(event) => setInput(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") handleSend();
                                    }}
                                    disabled={!aiEnabled || loading}
                                    placeholder={t("ai.chat.placeholder")}
                                    className="w-full rounded-full border border-black/10 bg-w px-4 py-2.5 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!aiEnabled || loading || !input.trim()}
                                    className="shrink-0 rounded-full bg-theme px-5 py-2.5 text-sm text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {t("ai.chat.send")}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </>
    );
}