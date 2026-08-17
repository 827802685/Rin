import { useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientConfigContext } from "../../state/config";

type NetworkKey = "weibo" | "qq" | "weixin" | "telegram" | "x" | "facebook" | "qzone" | "copy";

const NETWORK_META: Record<NetworkKey, { icon: string; label: string }> = {
  weibo: { icon: "ri-weibo-line", label: "微博" },
  qq: { icon: "ri-qq-line", label: "QQ" },
  weixin: { icon: "ri-wechat-line", label: "WeChat" },
  telegram: { icon: "ri-telegram-line", label: "Telegram" },
  x: { icon: "ri-twitter-x-line", label: "X" },
  facebook: { icon: "ri-facebook-line", label: "Facebook" },
  qzone: { icon: "ri-qq-line", label: "QQ Zone" },
  copy: { icon: "ri-link", label: "Copy" },
};

function parseNetworks(raw: unknown): NetworkKey[] {
  if (typeof raw !== "string") {
    return [];
  }
  const valid = new Set<NetworkKey>(Object.keys(NETWORK_META) as NetworkKey[]);
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is NetworkKey => valid.has(item as NetworkKey));
}

function shareUrl(network: NetworkKey, url: string, title: string): string | null {
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  switch (network) {
    case "weibo":
      return `https://service.weibo.com/share/share.php?url=${encodedUrl}&title=${encodedTitle}`;
    case "qq":
      return `https://connect.qq.com/widget/shareqq/index.html?url=${encodedUrl}&title=${encodedTitle}`;
    case "qzone":
      return `https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?url=${encodedUrl}&title=${encodedTitle}`;
    case "telegram":
      return `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}`;
    case "x":
      return `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    default:
      return null;
  }
}

export function ShareBar({ title, url }: { title: string; url: string }) {
  const config = useContext(ClientConfigContext);
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const networksRaw = config.get("widget.share.networks");
  const networks = useMemo(() => parseNetworks(networksRaw), [networksRaw]);

  if (!config.getBoolean("widget.share.enabled") || networks.length === 0) {
    return null;
  }

  const handleWeixin = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <i className="ri-share-line text-neutral-400 dark:text-neutral-500" />
        <span className="text-sm text-neutral-500 dark:text-neutral-400">{t("theme.share.title")}</span>
      </div>
      <div className="flex flex-row flex-wrap gap-2">
        {networks.map((network) => {
          const meta = NETWORK_META[network];
          if (network === "weixin") {
            return (
              <button
                key={network}
                type="button"
                onClick={() => void handleWeixin()}
                className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-sm t-primary transition hover:bg-neutral-200 dark:bg-white/10 dark:hover:bg-white/15"
                title={meta.label}
              >
                <i className={meta.icon} />
                <span>{copied ? t("theme.share.copied") : meta.label}</span>
              </button>
            );
          }
          if (network === "copy") {
            return (
              <button
                key={network}
                type="button"
                onClick={() => void handleWeixin()}
                className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-sm t-primary transition hover:bg-neutral-200 dark:bg-white/10 dark:hover:bg-white/15"
                title={meta.label}
              >
                <i className={meta.icon} />
                <span>{copied ? t("theme.share.copied") : meta.label}</span>
              </button>
            );
          }
          const href = shareUrl(network, url, title);
          if (!href) {
            return null;
          }
          return (
            <a
              key={network}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-sm t-primary transition hover:bg-neutral-200 dark:bg-white/10 dark:hover:bg-white/15"
              title={meta.label}
            >
              <i className={meta.icon} />
              <span>{meta.label}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
