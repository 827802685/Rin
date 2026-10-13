import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useSiteConfig } from "../../hooks/useSiteConfig";

export function ProfileCard() {
  const siteConfig = useSiteConfig();
  const { t } = useTranslation();

  return (
    <div className="border-card items-center text-center">
      {siteConfig.avatar ? (
        <img
          src={siteConfig.avatar}
          alt={siteConfig.name}
          className="h-20 w-20 rounded-full object-cover shadow-lg shadow-light"
        />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-theme text-2xl font-bold text-white">
          {siteConfig.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <p className="mt-2 text-lg font-bold t-primary">{siteConfig.name}</p>
      {siteConfig.description && <p className="text-sm t-secondary">{siteConfig.description}</p>}
      <div className="mt-2 flex w-full flex-row justify-center gap-4 text-sm">
        <Link href="/hashtags" className="text-theme hover:underline">
          {t("sidebar.view_tags")}
        </Link>
        <Link href="/timeline" className="text-theme hover:underline">
          {t("sidebar.view_timeline")}
        </Link>
      </div>
    </div>
  );
}
