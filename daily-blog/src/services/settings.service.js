import { config } from "../config.js";
import { settingsRepository } from "../repositories/settings.repository.js";
import { FEED_MODES, SETTINGS_KEYS } from "../validation/settings-input.js";
import { ValidationError } from "../errors.js";

/**
 * 站点配置服务层：环境变量是默认值，数据库里只存「被后台改过的项」。
 *
 * 这样有两个好处：
 * - 改环境变量仍然有效（只要后台没有覆盖同一项），两套配置不会互相打架；
 * - 「恢复默认」不需要写回一份默认快照，删掉记录即可，
 *   也就不存在「默认值改了但库里的旧快照还在」的问题。
 *
 * 每次读取都查库（一张只有几行的表），保证后台保存后下一个请求立即生效，
 * 不必重启进程。
 */

const INT_KEYS = Object.freeze(["pageSize", "feedSize"]);
const BOOL_KEYS = Object.freeze(["robotsNoindex"]);

/** 环境变量提供的默认值，也是「恢复默认」后的取值。 */
function defaults() {
  return {
    siteTitle: config.site.title,
    siteDescription: config.site.description,
    siteAuthor: config.site.author,
    siteUrl: config.site.baseUrl,
    pageSize: config.site.pageSize,
    feedSize: config.site.feedSize,
    feedMode: config.site.feedMode,
    robotsNoindex: config.site.robotsNoindex,
  };
}

/**
 * 解析库里存的字符串。
 * 值在写入时已校验过，但数据库可能被手工改动，因此这里再兜一次底：
 * 解析不出合法取值就回落到默认值，而不是让整站因为一行脏数据打不开。
 */
function parseStored(key, raw, fallback) {
  if (INT_KEYS.includes(key)) {
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
  }
  if (BOOL_KEYS.includes(key)) {
    return ["true", "1", "on"].includes(String(raw).toLowerCase());
  }
  if (key === "feedMode") {
    return FEED_MODES.includes(raw) ? raw : fallback;
  }
  return String(raw ?? "");
}

/** 只接受白名单里的键，避免把任意数据写进配置表。 */
function assertKnownKeys(data) {
  for (const key of Object.keys(data)) {
    if (!SETTINGS_KEYS.includes(key)) {
      throw new ValidationError(`未知的站点配置项：${key}`);
    }
  }
}

export const settingsService = {
  defaults,

  /** 后台保存过的覆盖值（键 → 原始字符串）。 */
  getOverrides() {
    return settingsRepository.findAll();
  },

  /**
   * 当前生效的站点配置。
   * 返回结构与 config.site 对齐（title / description / author / pageSize …），
   * 视图层不需要知道自己拿到的是环境变量还是数据库值。
   */
  getEffective() {
    const base = defaults();
    const overrides = settingsRepository.findAll();
    const merged = { ...base };

    for (const key of SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        merged[key] = parseStored(key, overrides[key], base[key]);
      }
    }

    return {
      title: merged.siteTitle,
      description: merged.siteDescription,
      author: merged.siteAuthor,
      baseUrl: merged.siteUrl,
      pageSize: merged.pageSize,
      feedSize: merged.feedSize,
      feedMode: merged.feedMode,
      robotsNoindex: merged.robotsNoindex,
      // 这两项只由环境变量控制：属于运行期资源约束，不适合在后台随手改动。
      maxTagsPerPost: config.site.maxTagsPerPost,
      searchMaxLength: config.site.searchMaxLength,
    };
  },

  /** 保存配置；返回生效后的完整配置，便于页面直接展示结果。 */
  update(data) {
    assertKnownKeys(data);

    for (const key of SETTINGS_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        continue;
      }
      const value = data[key];
      settingsRepository.upsert(key, BOOL_KEYS.includes(key) ? String(Boolean(value)) : String(value));
    }

    return this.getEffective();
  },

  /** 恢复默认：清空全部覆盖值。 */
  reset() {
    settingsRepository.removeAll();
    return this.getEffective();
  },
};
