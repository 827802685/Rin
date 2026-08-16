import { useContext, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { ClientConfigContext } from "../state/config";
import { siteName } from "../utils/constants";
import { parseToolsConfig, type ToolItem } from "../utils/tools";

export function ToolsPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const config = useContext(ClientConfigContext);
  const tools = parseToolsConfig(config.get("tools"));

  return (
    <>
      <Helmet>
        <title>{`${t("tools.title")} - ${siteConfig.name}`}</title>
        <meta property="og:site_name" content={siteName} />
        <meta property="og:title" content={t("tools.title")} />
        <meta property="og:image" content={siteConfig.avatar} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={document.URL} />
      </Helmet>
      <main className="w-full flex flex-col justify-center items-center mb-8 t-primary ani-show">
        <div className="wauto">
          <div className="wauto text-start py-4">
            <p className="text-4xl font-bold">{t("tools.title")}</p>
            <p className="text-sm mt-2 text-neutral-500 dark:text-neutral-400">{t("tools.description")}</p>
          </div>
          {tools.length > 0 ? (
            <div className="wauto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {tools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col wauto rounded-2xl bg-w m-2 p-6 items-center justify-center space-y-2">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("tools.empty")}</p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function ToolCard({ tool }: { tool: ToolItem }) {
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);
  const showIcon = tool.icon.trim().length > 0 && !imageFailed;

  return (
    <a
      title={tool.name}
      href={tool.url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-button w-full bg-w rounded-2xl p-5 flex flex-col items-center justify-center text-center shadow-sm shadow-light border border-black/5 dark:border-white/10 transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl">
        {showIcon ? (
          <img src={tool.icon} alt={tool.name} className="h-full w-full object-cover" onError={() => setImageFailed(true)} />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-2xl bg-theme/10 text-theme">
            <span className="text-xl font-bold">{tool.name.charAt(0).toUpperCase()}</span>
          </div>
        )}
      </div>
      <p className="mt-3 text-base font-semibold leading-tight">{tool.name}</p>
      {tool.description && <p className="mt-1 line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">{tool.description}</p>}
      <span className="mt-3 inline-flex items-center gap-1 text-xs text-theme">
        <i className="ri-external-link-line" aria-hidden="true" />
        {t("tools.open")}
      </span>
    </a>
  );
}