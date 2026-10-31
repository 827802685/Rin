import type { Feed } from "@rin/api";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ClientConfigContext } from "../state/config";

/**
 * 文章页左侧信息栏。
 *
 * 这里原本是一个 `xl:w-64` 的空占位 div（只为了在三栏布局里撑开左边距），
 * 宽屏下左侧 256px 一直是空白。改成同宽的 sticky 信息栏后主内容宽度不变，
 * 只是把闲置空间用起来：作者、本文标签、分享。
 *
 * 刻意不复刻文章头部已有的信息（发布时间 / 字数 / 阅读时长 / 浏览量），
 * 那些滚走之后才需要，左侧只放"随时想点一下"的入口。
 */
export function ArticleSideRail({ feed }: { feed: Feed }) {
  const { t } = useTranslation();
  const config = useContext(ClientConfigContext);
  const [copied, setCopied] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);

  const author = feed.user;
  const hashtags = feed.hashtags ?? [];
  const siteDescription = String(config.get("site.description") ?? "");

  useEffect(() => {
    // 滚过大半屏才出现：用视口高度做阈值，短文 / 矮屏也不会永远不触发
    const onScroll = () => setShowBackTop(window.scrollY > window.innerHeight * 0.6);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // 非安全上下文（http 且非 localhost）下 Clipboard API 不可用，降级到选中地址栏输入框
      const helper = document.createElement("textarea");
      helper.value = url;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      document.body.removeChild(helper);
      setCopied(true);
    }
  }

  return (
    <aside className="hidden xl:block w-64 shrink-0" aria-label={t("article.sidebar")}>
      <div className="sticky top-[5.5rem] space-y-3 pr-2">
        {/* 作者 */}
        <section className="rounded-2xl bg-w p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] t-muted">
            {t("article.written_by")}
          </p>
          <div className="mt-3 flex items-center gap-3">
            {author?.avatar ? (
              <img
                src={author.avatar}
                alt={author.username}
                className="h-10 w-10 shrink-0 rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary t-muted">
                <i className="ri-user-line" aria-hidden="true" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium t-primary">{author?.username ?? "—"}</p>
            </div>
          </div>
          {siteDescription && (
            <p className="mt-3 text-[12px] leading-relaxed t-muted">{siteDescription}</p>
          )}
        </section>

        {/* 本文标签：没有标签时整块不渲染，避免留一个空壳 */}
        {hashtags.length > 0 && (
          <section className="rounded-2xl bg-w p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] t-muted">
              {t("article.tags")}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hashtags.map((tag) => (
                <Link
                  key={tag.id}
                  href={`/hashtag/${tag.name}`}
                  className="rounded-full bg-secondary px-2 py-1 text-[12px] t-primary transition-colors hover:bg-theme hover:text-white rin-glass-pill"
                >
                  #{tag.name}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 分享 */}
        <section className="rounded-2xl bg-w p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] t-muted">
            {t("article.share")}
          </p>
          <button
            type="button"
            onClick={copyLink}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-[13px] t-primary transition-colors hover:bg-theme hover:text-white"
          >
            <i className={copied ? "ri-check-line" : "ri-link"} aria-hidden="true" />
            <span>{copied ? t("article.link_copied") : t("article.copy_link")}</span>
          </button>
        </section>

        {/* 回到顶部：滚过一屏才出现，避免一进页面就有个没用的按钮 */}
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label={t("article.back_to_top")}
          title={t("article.back_to_top")}
          className={`flex w-full items-center justify-center gap-1.5 rounded-2xl bg-w px-3 py-2 text-[12px] t-muted transition-all duration-300 hover:t-primary ${
            showBackTop ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <i className="ri-arrow-up-line" aria-hidden="true" />
          <span>{t("article.back_to_top")}</span>
        </button>
      </div>
    </aside>
  );
}
