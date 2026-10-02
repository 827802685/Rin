import { postsRepository } from "../repositories/posts.repository.js";
import { NotFoundError, ValidationError } from "../errors.js";

/**
 * 归档服务层：把已发布文章按「年 → 月」折叠成树形结构。
 *
 * 一次查询 + 内存分组，而不是按年份分别查库：
 * 文章量在几千篇以内时，一次全量取回远快于十几次往返，
 * 而且分组逻辑留在服务层，仓储层仍然只写 SQL。
 *
 * 草稿不进归档：归档是给读者看的「内容地图」，
 * 出现在里面的每一篇都应该是点开就能读的。
 */

const MONTH_LABELS = Object.freeze([
  "1 月", "2 月", "3 月", "4 月", "5 月", "6 月",
  "7 月", "8 月", "9 月", "10 月", "11 月", "12 月",
]);

function toPost(row) {
  const publishedAt = String(row.published_at ?? "");
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    author: row.author,
    publishedAt,
    // 归档页按月分组，同一组内重复展示完整时间戳没有意义，只留日期部分。
    date: publishedAt.slice(0, 10),
    url: `/posts/${encodeURIComponent(row.slug)}`,
  };
}

/** 年/月来自 'YYYY-MM-DD HH:MM:SS' 的前 7 位，不涉及时区换算。 */
function groupByMonth(rows) {
  const months = new Map();

  for (const row of rows) {
    const post = toPost(row);
    const month = post.publishedAt.slice(5, 7) || "01";
    if (!months.has(month)) {
      months.set(month, []);
    }
    months.get(month).push(post);
  }

  return [...months.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([month, posts]) => ({
      month,
      label: MONTH_LABELS[Number.parseInt(month, 10) - 1] ?? `${month} 月`,
      total: posts.length,
      posts,
    }));
}

function groupByYear(rows) {
  const years = new Map();

  for (const row of rows) {
    const year = String(row.published_at ?? "").slice(0, 4) || "1970";
    if (!years.has(year)) {
      years.set(year, []);
    }
    years.get(year).push(row);
  }

  return [...years.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([year, yearRows]) => ({
      year,
      total: yearRows.length,
      months: groupByMonth(yearRows),
      url: `/archive/${year}`,
    }));
}

/** 年份参数必须是 4 位数字且落在合理区间，超出范围直接 400，不拿去查库。 */
function normalizeYear(year) {
  const raw = String(year ?? "").trim();
  if (!/^\d{4}$/.test(raw)) {
    throw new ValidationError("年份必须是 4 位数字，例如 2026");
  }
  const parsed = Number.parseInt(raw, 10);
  const maxYear = new Date().getUTCFullYear() + 1;
  if (parsed < 1970 || parsed > maxYear) {
    throw new ValidationError(`年份必须在 1970-${maxYear} 之间，当前值：${raw}`);
  }
  return raw;
}

export const archiveService = {
  /** 全站归档：按年倒序，每年内按月倒序。 */
  getOverview() {
    const rows = postsRepository.findPublishedArchiveRows();
    return {
      years: groupByYear(rows),
      total: rows.length,
      latestPublishedAt: rows[0]?.published_at ?? null,
    };
  },

  /** 单年归档：年份不存在（没有任何文章）时 404，与分类页/标签页的行为一致。 */
  getYear(year) {
    const normalized = normalizeYear(year);
    const rows = postsRepository
      .findPublishedArchiveRows()
      .filter((row) => String(row.published_at ?? "").slice(0, 4) === normalized);

    if (rows.length === 0) {
      throw new NotFoundError(`${normalized} 年没有已发布的文章`);
    }

    const [grouped] = groupByYear(rows);
    return { year: normalized, ...grouped };
  },
};
