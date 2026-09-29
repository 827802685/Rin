import { config } from "../config.js";
import { ValidationError } from "../errors.js";
import {
  buildMatchExcerpt,
  hasMatch,
  highlightMatches,
  splitSearchTerms,
} from "../lib/highlight.js";
import { postsRepository } from "../repositories/posts.repository.js";
import { paginatePublished } from "./posts.service.js";
import { taxonomyService } from "./taxonomy.service.js";

/** 搜索结果片段长度：太短看不出上下文，太长会把卡片撑得很高。 */
export const SEARCH_EXCERPT_LENGTH = 180;

/**
 * 归一化关键词：压缩空白（多词搜索用空格分隔）并做长度上限校验。
 * 超长关键词直接 400，而不是把一个大 pattern 打进 LIKE 去慢查询。
 */
export function normalizeSearchQuery(raw) {
  const query = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (query.length > config.site.searchMaxLength) {
    throw new ValidationError(`搜索关键词最长 ${config.site.searchMaxLength} 个字符`);
  }
  return query;
}

/** 分类 / 标签筛选：填了就必须真实存在，否则 404（与分类页、标签页行为一致）。 */
function resolveFilters({ categorySlug, tagSlug }) {
  return {
    category: categorySlug ? taxonomyService.getCategoryBySlug(categorySlug) : null,
    tag: tagSlug ? taxonomyService.getTagBySlug(tagSlug) : null,
  };
}

/**
 * 摘要优先、正文兜底：
 * 摘要命中就直接展示摘要；否则从正文纯文本里截取「首次命中位置附近」的片段，
 * 让结果列表能直接看出这篇文章为什么会被搜出来。
 */
function buildResultExcerpt(post, terms) {
  const summary = post.summary ?? "";
  const contentText = post.contentText ?? "";
  const preferSummary = hasMatch(summary, terms) || !hasMatch(contentText, terms);
  const source = preferSummary ? summary : contentText;
  return buildMatchExcerpt({
    text: source || contentText || summary,
    terms,
    maxLength: SEARCH_EXCERPT_LENGTH,
  });
}

function decorateResult(post, terms) {
  return {
    ...post,
    titleHtml: highlightMatches(post.title, terms),
    excerptHtml: buildResultExcerpt(post, terms),
  };
}

/** 复用前台统一分页：空结果同样返回规范的 pagination 结构，模板不必分两套。 */
function emptyResult(page, pageSize) {
  return paginatePublished(page, pageSize, { count: () => 0, fetchPage: () => [] });
}

/**
 * 搜索服务层：只处理「关键词 → 结果」的业务规则，
 * 不依赖 HTTP 请求对象，页面与 JSON 接口共用同一份实现。
 */
export const searchService = {
  /**
   * 关键词搜索：只搜已发布文章（草稿永不出现），支持分类 / 标签筛选与分页。
   * 关键词为空时不做任何查询，直接返回空结果，由页面提示用户先输入关键词。
   */
  search({
    query = "",
    page = 1,
    pageSize = config.site.pageSize,
    categorySlug = null,
    tagSlug = null,
  } = {}) {
    const normalized = normalizeSearchQuery(query);
    const terms = splitSearchTerms(normalized);
    const { category, tag } = resolveFilters({ categorySlug, tagSlug });

    if (terms.length === 0) {
      return {
        query: "",
        submitted: false,
        category,
        tag,
        ...emptyResult(page, pageSize),
      };
    }

    const criteria = {
      terms,
      categorySlug: category?.slug ?? null,
      tagSlug: tag?.slug ?? null,
    };

    const { items, pagination } = paginatePublished(page, pageSize, {
      count: () => postsRepository.countPublishedBySearch(criteria),
      fetchPage: ({ limit, offset }) =>
        postsRepository.findPublishedPageBySearch({ ...criteria, limit, offset }),
      decorateOptions: { withContentText: true },
    });

    return {
      query: normalized,
      submitted: true,
      category,
      tag,
      items: items.map((post) => decorateResult(post, terms)),
      pagination,
    };
  },
};
