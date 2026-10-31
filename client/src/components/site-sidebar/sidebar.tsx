import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { client } from "../../app/runtime";
import { ProfileCard } from "./profile-card";
import { TagCloud, type TagItem } from "./tag-cloud";

/**
 * 标签接口结果在模块级缓存：侧栏在桌面 aside 与窄屏折叠面板里各挂载一次，
 * 没有缓存就会重复打同一个接口。带 5 分钟有效期——站点刚发完文章时标签计数
 * 也该跟着变，不能一整个会话都吃老数据。
 */
const TAGS_TTL_MS = 5 * 60 * 1000;
let tagsCache: { list: TagItem[]; at: number } | undefined;

/**
 * 侧栏数据只在挂载后读取；失败时显示重试入口而非谎报为 0。
 *
 * `withTocSlot` 用于同一页面上出现两份侧栏时（桌面 aside + 窄屏折叠面板），
 * 只有一份能持有 `#rin-sidebar-slot`，否则目录传送会取到隐藏的那一份。
 */
export function SiteSidebar({ withTocSlot = true }: { withTocSlot?: boolean } = {}) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<TagItem[] | null | undefined>(tagsCache?.list);

  const fetchTags = (force = false) => {
    if (!force && tagsCache && Date.now() - tagsCache.at < TAGS_TTL_MS) {
      setTags(tagsCache.list);
      return;
    }
    setTags(undefined);
    client.tag
      .list()
      .then(({ data }: { data?: unknown }) => {
        const list = Array.isArray(data) ? (data as TagItem[]) : null;
        if (list) tagsCache = { list, at: Date.now() };
        setTags(list);
      })
      .catch(() => setTags(null));
  };

  useEffect(() => {
    fetchTags();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <ProfileCard />
      {tags === undefined ? (
        <div className="border-card animate-pulse text-sm t-muted">{t("sidebar.loading")}</div>
      ) : tags === null ? (
        <div className="border-card text-sm t-muted">
          {t("sidebar.tags_failed")}
          <button type="button" className="ml-2 text-theme underline" onClick={() => fetchTags(true)}>
            {t("sidebar.retry")}
          </button>
        </div>
      ) : (
        <TagCloud tags={tags} title={t("sidebar.tags_title")} />
      )}
      {/* 文章页目录（侧栏布局时）传送到这里 */}
      {withTocSlot && <div id="rin-sidebar-slot" className="flex flex-col gap-4" />}
    </div>
  );
}
