import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { client } from "../app/runtime";
import type { BacklinkItem, RelatedFeedItem } from "../api/client";

/**
 * 文章详情页底部的「反向链接 + 相关文章」区块。
 * - 反向链接：GET /api/backlinks/:id（双向链接/图谱，服务端按 title/alias/slug 反查）
 * - 相关文章：GET /api/taxonomy/related/:id（按共享标签数排序，仅已发布）
 * 两者并行拉取；任一出错仅静默隐藏该区块，不影响正文。
 */
export function BacklinksSection({ id }: { id: number | string }) {
  const { t } = useTranslation();
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [related, setRelated] = useState<RelatedFeedItem[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.feed.backlinks(id).catch(() => undefined),
      client.feed.relatedFeeds(id).catch(() => undefined),
    ]).then(([b, r]) => {
      if (cancelled) return;
      if (b && !b.error && b.data) setBacklinks(b.data);
      if (r && !r.error && r.data) setRelated(r.data);
      if ((b && b.error) || (r && r.error)) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (failed) return null;
  if (!backlinks.length && !related.length) return null;

  const renderList = (title: string, items: Array<{ id: number; title: string }>) => (
    <section className="rin-links-group my-4">
      <h2 className="text-base font-bold mb-2 text-theme">{title}</h2>
      <ul className="list-disc pl-5 space-y-1">
        {items.map((it) => (
          <li key={it.id}>
            <Link href={`/feed/${it.id}`} className="hover:underline text-theme">
              {it.title || t("article.untitled")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="rin-links mt-6 border-t border-black/10 pt-4 dark:border-white/10">
      {backlinks.length > 0 && renderList(t("article.backlinks.title"), backlinks)}
      {related.length > 0 && renderList(t("article.related.title"), related)}
    </div>
  );
}
