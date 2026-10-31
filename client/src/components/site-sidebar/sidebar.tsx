import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { client } from "../../app/runtime";
import { ProfileCard } from "./profile-card";
import { TagCloud, type TagItem } from "./tag-cloud";

/**
 * 侧栏数据只在挂载后读取；失败时显示重试入口而非谎报为 0。
 */
export function SiteSidebar() {
  const { t } = useTranslation();
  const [tags, setTags] = useState<TagItem[] | null | undefined>(undefined);

  const fetchTags = () => {
    setTags(undefined);
    client.tag
      .list()
      .then(({ data }: { data?: unknown }) => {
        setTags(Array.isArray(data) ? (data as TagItem[]) : null);
      })
      .catch(() => setTags(null));
  };

  useEffect(fetchTags, []);

  return (
    <div className="flex flex-col gap-4">
      <ProfileCard />
      {tags === undefined ? (
        <div className="border-card animate-pulse text-sm t-muted">{t("sidebar.loading")}</div>
      ) : tags === null ? (
        <div className="border-card text-sm t-muted">
          {t("sidebar.tags_failed")}
          <button type="button" className="ml-2 text-theme underline" onClick={fetchTags}>
            {t("sidebar.retry")}
          </button>
        </div>
      ) : (
        <TagCloud tags={tags} title={t("sidebar.tags_title")} />
      )}
      {/* 文章页目录（侧栏布局时）传送到这里 */}
      <div id="rin-sidebar-slot" className="flex flex-col gap-4" />
    </div>
  );
}
