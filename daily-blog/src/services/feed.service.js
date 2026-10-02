import { postsService } from "./posts.service.js";
import { archiveService } from "./archive.service.js";
import { taxonomyService } from "./taxonomy.service.js";
import { joinUrl } from "../lib/base-url.js";
import { escapeXml, toIso8601, toRfc822 } from "../lib/xml.js";

/**
 * RSS / sitemap / robots.txt 的生成。
 *
 * 三者都是按请求实时生成的：文章状态一变（发布、转草稿、删除）下一次抓取就是新的，
 * 不需要额外的构建步骤或定时任务。
 * RSS 与 sitemap 的 XML 手写拼装（结构各自只有二十来行），不为此引入依赖。
 *
 * 一致性原则：只有**已发布**文章进入订阅源与站点地图，
 * 草稿与未过审内容绝不外泄——与首页、搜索、归档保持同一口径。
 */

/** RSS 里每篇文章的分类维度：分类与标签都写成 <category>，订阅阅读器据此归类。 */
function categoriesOf(post) {
  const names = [];
  if (post.category?.name) {
    names.push(post.category.name);
  }
  for (const tag of post.tags ?? []) {
    names.push(tag.name);
  }
  return names;
}

function latestPublishedAt(posts) {
  return posts[0]?.publishedAt ?? null;
}

export const feedService = {
  /** 最近 N 篇已发布文章（N 来自站点配置，已在配置层做过 1-100 校验）。 */
  listFeedPosts(limit) {
    return postsService.listPublished({
      page: 1,
      pageSize: limit,
      decorateOptions: { withContent: true },
    }).items;
  },

  /** RSS 2.0 订阅源。 */
  buildRss({ site, baseUrl }) {
    const posts = this.listFeedPosts(site.feedSize);
    const channelLink = joinUrl(baseUrl, "/");
    const feedLink = joinUrl(baseUrl, "/feed.xml");
    const buildDate = toRfc822(latestPublishedAt(posts) ?? new Date().toISOString());

    const items = posts.map((post) => {
      const link = joinUrl(baseUrl, `/posts/${encodeURIComponent(post.slug)}`);
      // 全文模式把渲染后的 HTML 转义后放进 description，阅读器会还原成排版后的正文；
      // 摘要模式只放纯文本摘要，订阅源体积更小。
      const description =
        site.feedMode === "full" ? escapeXml(post.contentHtml ?? "") : escapeXml(post.summary);

      const categories = categoriesOf(post)
        .map((name) => `      <category>${escapeXml(name)}</category>`)
        .join("\n");

      return [
        "    <item>",
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        // guid 用规范链接：只要不改 slug 就保持稳定，不会在阅读器里重复出现。
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <pubDate>${toRfc822(post.publishedAt)}</pubDate>`,
        `      <dc:creator>${escapeXml(post.author)}</dc:creator>`,
        categories,
        `      <description>${description}</description>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    });

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
      "  <channel>",
      `    <title>${escapeXml(site.title)}</title>`,
      `    <link>${escapeXml(channelLink)}</link>`,
      `    <description>${escapeXml(site.description)}</description>`,
      "    <language>zh-CN</language>",
      `    <lastBuildDate>${buildDate}</lastBuildDate>`,
      "    <generator>daily-blog</generator>",
      `    <atom:link href="${escapeXml(feedLink)}" rel="self" type="application/rss+xml" />`,
      ...items,
      "  </channel>",
      "</rss>",
      "",
    ].join("\n");
  },

  /**
   * sitemap.xml。
   * 只输出 <loc> 与 <lastmod>：changefreq / priority 已被主流搜索引擎明确忽略，
   * 写出来只会让文件变大、并给人「改了会有用」的错觉。
   */
  buildSitemap({ baseUrl }) {
    const archive = archiveService.getOverview();
    const posts = postsService.listPublishedRefs();
    const fallback = toIso8601(posts[0]?.publishedAt ?? new Date().toISOString());

    const entries = [
      { path: "/", lastmod: fallback },
      { path: "/archive", lastmod: fallback },
    ];

    for (const group of archive.years) {
      entries.push({
        path: `/archive/${group.year}`,
        lastmod: toIso8601(group.months[0]?.posts[0]?.publishedAt ?? fallback),
      });
    }

    for (const category of taxonomyService.listCategories({ publishedOnly: true })) {
      entries.push({ path: `/categories/${encodeURIComponent(category.slug)}`, lastmod: fallback });
    }

    for (const tag of taxonomyService.listTags({ publishedOnly: true })) {
      entries.push({ path: `/tags/${encodeURIComponent(tag.slug)}`, lastmod: fallback });
    }

    for (const post of posts) {
      entries.push({
        path: `/posts/${encodeURIComponent(post.slug)}`,
        lastmod: toIso8601(post.publishedAt),
      });
    }

    // 分类/标签总览页也要能被发现，否则爬虫只能从文章里反向找到它们。
    entries.push({ path: "/categories", lastmod: fallback });
    entries.push({ path: "/tags", lastmod: fallback });

    const urls = entries.map(
      (entry) =>
        "  <url>\n" +
        `    <loc>${escapeXml(joinUrl(baseUrl, entry.path))}</loc>\n` +
        `    <lastmod>${entry.lastmod}</lastmod>\n` +
        "  </url>",
    );

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls,
      "</urlset>",
      "",
    ].join("\n");
  },

  /** robots.txt：屏蔽后台与搜索结果页，并给出 sitemap 地址。 */
  buildRobots({ site, baseUrl }) {
    const lines = ["User-agent: *"];
    if (site.robotsNoindex) {
      // 站点还没准备好被收录时，整站屏蔽比逐页 noindex 更可靠。
      lines.push("Disallow: /");
    } else {
      lines.push("Allow: /");
      lines.push("Disallow: /admin");
      lines.push("Disallow: /search");
    }
    lines.push("");
    lines.push(`Sitemap: ${joinUrl(baseUrl, "/sitemap.xml")}`);
    return `${lines.join("\n")}\n`;
  },
};
