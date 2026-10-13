import { normalizeFeedLayout } from "../feed-layout-options";
import type { FeedCardVariant } from "../feed-card-options";

/**
 * 列表容器的版式类，收敛 feeds/search/hashtag 三处曾各自复制的三元判断。
 */
export function getFeedListClass(layout: string, extraClass = ""): string {
  const base = (() => {
    switch (normalizeFeedLayout(layout)) {
      case "masonry":
        return "wauto columns-1 gap-5 md:columns-2";
      case "magazine":
        return "wauto grid grid-cols-1 gap-4 md:grid-cols-2";
      default:
        return "wauto flex flex-col";
    }
  })();

  return extraClass ? `${base} ${extraClass}` : base;
}

/**
 * 杂志网格强制封面卡；其他版式返回 undefined，让卡片沿用自己的配置。
 */
export function getCardVariantForLayout(layout: string): FeedCardVariant | undefined {
  return normalizeFeedLayout(layout) === "magazine" ? "cover" : undefined;
}
