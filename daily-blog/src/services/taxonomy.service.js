import { config } from "../config.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import { cjkSlug, hasMeaningfulSlug, slugifyText, timestampSlug } from "../lib/slug.js";
import { categoriesRepository } from "../repositories/categories.repository.js";
import { tagsRepository } from "../repositories/tags.repository.js";
import { postsRepository } from "../repositories/posts.repository.js";
import { withTransaction } from "../db/transaction.js";

/**
 * 分类与标签服务层：两者规则高度一致，用同一套实现按 kind 参数化，
 * 差异只在「分类有描述」和「分类被占用时不允许删除」两点。
 */
export const TAXONOMY_KINDS = Object.freeze(["category", "tag"]);

const KIND_META = Object.freeze({
  category: Object.freeze({
    label: "分类",
    urlPrefix: "/categories",
    slugPrefix: "category",
    repo: categoriesRepository,
  }),
  tag: Object.freeze({
    label: "标签",
    urlPrefix: "/tags",
    slugPrefix: "tag",
    repo: tagsRepository,
  }),
});

const NAME_MAX_LENGTH = 40;
const DESCRIPTION_MAX_LENGTH = 200;
const SLUG_MAX_LENGTH = 60;

function metaOf(kind) {
  const meta = KIND_META[kind];
  if (!meta) {
    throw new ValidationError(`未知的分类类型：${kind}`);
  }
  return meta;
}

function normalizeId(id, label) {
  const parsed = Number.parseInt(id, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new NotFoundError(`${label}不存在`);
  }
  return parsed;
}

function toView(row, meta) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? "",
    postCount: row.post_count,
    url: `${meta.urlPrefix}/${encodeURIComponent(row.slug)}`,
  };
}

/**
 * 确定最终 slug：
 * - 用户显式填写：被占用直接 409，不做隐式改名（与文章 slug 策略一致）；
 * - 留空自动生成：优先英文派生，纯中文名称直接用中文（URL 会被编码，但可读），
 *   其余退化为 `category-日期-随机串`；自动生成冲突时追加序号。
 */
function resolveSlug(kind, { slug, name, excludeId = null }) {
  const meta = metaOf(kind);
  const provided = String(slug ?? "").trim();

  if (provided) {
    if (provided.length > SLUG_MAX_LENGTH) {
      throw new ValidationError(`${meta.label} slug 最长 ${SLUG_MAX_LENGTH} 个字符`);
    }
    if (meta.repo.slugExists(provided, excludeId)) {
      throw new ConflictError(`${meta.label} slug 已被占用：${provided}`);
    }
    return provided;
  }

  const derived = slugifyText(name);
  const base =
    (hasMeaningfulSlug(derived) && derived) ||
    cjkSlug(name, SLUG_MAX_LENGTH) ||
    timestampSlug(meta.slugPrefix);

  let resolved = base;
  let attempt = 1;
  while (meta.repo.slugExists(resolved, excludeId)) {
    attempt += 1;
    if (attempt > 50) {
      throw new ConflictError(`自动生成${meta.label} slug 连续冲突，请手动填写 slug`);
    }
    resolved = `${base}-${attempt}`;
  }
  return resolved;
}

function normalizeInput(kind, input = {}) {
  const meta = metaOf(kind);
  const name = String(input.name ?? "").trim();
  if (!name) {
    throw new ValidationError(`${meta.label}名称不能为空`);
  }
  if (name.length > NAME_MAX_LENGTH) {
    throw new ValidationError(`${meta.label}名称最长 ${NAME_MAX_LENGTH} 个字符`);
  }

  const description = String(input.description ?? "").trim();
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    throw new ValidationError(`${meta.label}描述最长 ${DESCRIPTION_MAX_LENGTH} 个字符`);
  }

  return { name, description, slug: String(input.slug ?? "").trim() };
}

function assertNameAvailable(kind, name, excludeId = null) {
  const meta = metaOf(kind);
  const existing = meta.repo.findByName(name);
  if (existing && existing.id !== excludeId) {
    throw new ConflictError(`${meta.label}名称已存在：${name}`);
  }
}

function createEntity(kind, input) {
  const meta = metaOf(kind);
  const data = normalizeInput(kind, input);
  assertNameAvailable(kind, data.name);
  const slug = resolveSlug(kind, { slug: data.slug, name: data.name });

  const id =
    kind === "category"
      ? categoriesRepository.insert({ slug, name: data.name, description: data.description })
      : tagsRepository.insert({ slug, name: data.name });

  return { id, slug };
}

function updateEntity(kind, id, input) {
  const meta = metaOf(kind);
  const entityId = normalizeId(id, meta.label);
  const existing = meta.repo.findById(entityId);
  if (!existing) {
    throw new NotFoundError(`${meta.label}不存在：id=${id}`);
  }

  const data = normalizeInput(kind, input);
  assertNameAvailable(kind, data.name, entityId);
  const slug = resolveSlug(kind, { slug: data.slug, name: data.name, excludeId: entityId });

  if (kind === "category") {
    categoriesRepository.updateById(entityId, {
      slug,
      name: data.name,
      description: data.description,
    });
  } else {
    tagsRepository.updateById(entityId, { slug, name: data.name });
  }

  return { id: entityId, slug };
}

function removeEntity(kind, id) {
  const meta = metaOf(kind);
  const entityId = normalizeId(id, meta.label);
  const existing = meta.repo.findById(entityId);
  if (!existing) {
    throw new NotFoundError(`${meta.label}不存在：id=${id}`);
  }

  const affectedPosts = meta.repo.countPosts(entityId);
  // 分类是文章的组织方式，直接删除会让文章「无处安放」，因此要求先调整文章；
  // 标签只是附加标记，删除时连带解除关联即可（外键 ON DELETE CASCADE）。
  if (kind === "category" && affectedPosts > 0) {
    throw new ConflictError(
      `该分类下还有 ${affectedPosts} 篇文章，请先把这些文章改到其他分类（或清空分类）再删除`,
    );
  }

  meta.repo.deleteById(entityId);
  return { id: entityId, name: existing.name, affectedPosts };
}

/** 按逗号（含中文逗号、顿号）拆标签名，去重且保持输入顺序，超过上限直接报错。 */
export function splitTagNames(raw, maxCount = config.site.maxTagsPerPost) {
  const parts = String(raw ?? "")
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const seen = new Set();
  const names = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(part);
    if (names.length > maxCount) {
      throw new ValidationError(`一篇文章最多设置 ${maxCount} 个标签`);
    }
  }
  return names;
}

/** 取标签 id，不存在则按名称创建（标签是轻量实体，允许在写文章时顺手创建）。 */
function tagIdForName(name) {
  const existing = tagsRepository.findByName(name);
  if (existing) {
    return existing.id;
  }
  const slug = resolveSlug("tag", { slug: "", name });
  return tagsRepository.insert({ slug, name });
}

/** 整体替换一篇文章的标签；调用方负责事务边界。 */
function syncPostTags(postId, names) {
  const tagIds = names.map(tagIdForName);
  postsRepository.clearTags(postId);
  for (const tagId of tagIds) {
    postsRepository.addTag(postId, tagId);
  }
}

export const taxonomyService = {
  listCategories({ publishedOnly = false } = {}) {
    const meta = metaOf("category");
    const rows = categoriesRepository.listWithCounts({
      status: publishedOnly ? "published" : null,
    });
    return rows.map((row) => toView(row, meta));
  },

  listTags({ publishedOnly = false } = {}) {
    const meta = metaOf("tag");
    const rows = tagsRepository.listWithCounts({ status: publishedOnly ? "published" : null });
    return rows.map((row) => toView(row, meta));
  },

  /** 分类详情页用：不存在直接 404，而不是渲染一个空列表。 */
  getCategoryBySlug(slug) {
    if (!slug || typeof slug !== "string") {
      throw new NotFoundError("分类不存在");
    }
    const row = categoriesRepository.findBySlug(slug);
    if (!row) {
      throw new NotFoundError(`分类不存在：${slug}`);
    }
    return toView(
      { ...row, post_count: categoriesRepository.countPosts(row.id) },
      metaOf("category"),
    );
  },

  getTagBySlug(slug) {
    if (!slug || typeof slug !== "string") {
      throw new NotFoundError("标签不存在");
    }
    const row = tagsRepository.findBySlug(slug);
    if (!row) {
      throw new NotFoundError(`标签不存在：${slug}`);
    }
    return toView({ ...row, post_count: tagsRepository.countPosts(row.id) }, metaOf("tag"));
  },

  createCategory(input) {
    return createEntity("category", input);
  },

  updateCategory(id, input) {
    return updateEntity("category", id, input);
  },

  removeCategory(id) {
    return removeEntity("category", id);
  },

  createTag(input) {
    return createEntity("tag", input);
  },

  updateTag(id, input) {
    return updateEntity("tag", id, input);
  },

  removeTag(id) {
    return removeEntity("tag", id);
  },

  /** 解析文章表单里的标签输入，去掉空项与重复项。 */
  parseTagInput(raw) {
    return splitTagNames(raw);
  },

  /**
   * 保存文章的分类与标签（文章主体写入后调用）。
   * 三张表的写入放在同一事务里，避免出现「文章存了但标签丢了」的中间状态。
   */
  savePostTaxonomy(postId, { categoryId = null, tagNames = [] } = {}) {
    return withTransaction(() => {
      let resolvedCategoryId = null;
      if (categoryId !== null && categoryId !== undefined && categoryId !== "") {
        const parsed = normalizeId(categoryId, "分类");
        if (!categoriesRepository.findById(parsed)) {
          throw new NotFoundError(`分类不存在：id=${categoryId}`);
        }
        resolvedCategoryId = parsed;
      }

      postsRepository.setCategory(postId, resolvedCategoryId);
      syncPostTags(postId, tagNames);

      return { categoryId: resolvedCategoryId, tagCount: tagNames.length };
    });
  },
};
