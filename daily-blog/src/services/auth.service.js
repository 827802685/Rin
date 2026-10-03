import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { UnauthorizedError } from "../errors.js";
import { usersRepository } from "../repositories/users.repository.js";
import { sessionsRepository } from "../repositories/sessions.repository.js";

/** scrypt 参数：~100ms/次，足以抵抗离线爆破，又不至于拖慢启动。 */
const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64, saltBytes: 16 });

/** 密码哈希格式：scrypt$N$r$p$<saltHex>$<hashHex>，参数随哈希一起存储，便于日后升级。 */
export function hashPassword(password) {
  const salt = randomBytes(SCRYPT.saltBytes);
  const derived = scryptSync(String(password), salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/** 恒定时间比较，避免通过响应耗时推断密码是否正确。 */
export function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string") {
    return false;
  }
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, rawN, rawR, rawP, saltHex, hashHex] = parts;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const derived = scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(rawN),
      r: Number(rawR),
      p: Number(rawP),
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** 会话令牌只以 SHA-256 摘要形式落库。 */
function hashSessionToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** 账号不存在时也走一次哈希校验，抹平响应时间差异。 */
let dummyHash = null;
function getDummyHash() {
  if (!dummyHash) {
    dummyHash = hashPassword(randomBytes(16).toString("hex"));
  }
  return dummyHash;
}

export function toPublicUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    lastLoginAt: row.last_login_at ?? null,
  };
}

/**
 * 认证服务：密码校验、会话签发与撤销、管理员引导。
 * 不依赖 HTTP 请求/响应对象，Cookie 读写由中间件负责。
 */
export const authService = {
  /**
   * 按环境变量创建或同步管理员账号。
   * - 未设置 ADMIN_PASSWORD：不创建账号，后台登录关闭；
   * - 已存在且密码一致：跳过（避免每次启动重复做 scrypt）；
   * - 已存在但密码不同：更新哈希，等价于「改密码 = 改 .env 后重启」。
   */
  ensureAdminFromEnv() {
    if (!config.admin.enabled) {
      return { created: false, updated: false, enabled: false };
    }

    const username = config.admin.username;
    // 先看一眼，用来判断「要不要做 scrypt」和「这次算新建还是更新」。
    // 真正的写入交给 upsert：多实例同时启动时，这里的判断可能已经过期。
    const existing = usersRepository.findByUsername(username);

    if (existing && verifyPassword(config.admin.password, existing.password_hash)) {
      return { created: false, updated: false, enabled: true, id: existing.id, username };
    }

    const id = usersRepository.upsert({
      username,
      passwordHash: hashPassword(config.admin.password),
    });
    // 并发启动时 created 可能是乐观的（另一个实例刚插完），只影响这条日志的措辞；
    // 真正要保证的是「账号存在且口令与 .env 一致」，这一点由 upsert 保证。
    return {
      created: !existing,
      updated: Boolean(existing),
      enabled: true,
      id: id ?? existing?.id ?? null,
      username,
    };
  },

  /** 校验用户名密码，失败统一抛 401，不区分「用户不存在」与「密码错误」。 */
  authenticate({ username, password }) {
    const row = usersRepository.findByUsername(String(username ?? ""));
    const storedHash = row?.password_hash ?? getDummyHash();
    const passwordOk = verifyPassword(String(password ?? ""), storedHash);

    if (!row || !passwordOk) {
      throw new UnauthorizedError("用户名或密码不正确");
    }

    return toPublicUser(row);
  },

  /** 签发会话：返回明文令牌（只交给 Cookie）与过期时间。 */
  createSession({ userId, userAgent = "" }) {
    sessionsRepository.deleteExpired();

    const token = randomBytes(32).toString("base64url");
    sessionsRepository.insert({
      id: hashSessionToken(token),
      userId,
      ttlHours: config.session.ttlHours,
      userAgent: String(userAgent).slice(0, 200),
    });
    usersRepository.touchLastLogin(userId);

    const ttlMs = config.session.ttlHours * 60 * 60 * 1000;
    return { token, maxAgeSeconds: Math.floor(ttlMs / 1000) };
  },

  /** 解析会话：令牌不存在或已过期都返回 null，由中间件决定如何处理。 */
  resolveSession(token) {
    if (!token || typeof token !== "string") {
      return null;
    }
    const row = sessionsRepository.findValidById(hashSessionToken(token));
    if (!row) {
      return null;
    }
    return {
      user: { id: row.user_id, username: row.username, lastLoginAt: row.last_login_at ?? null },
      expiresAt: row.session_expires_at,
    };
  },

  /** 登出：删除服务端会话记录，令牌立即失效。 */
  destroySession(token) {
    if (!token || typeof token !== "string") {
      return 0;
    }
    const changes = sessionsRepository.deleteById(hashSessionToken(token));
    if (changes > 0) {
      logger.debug("auth.session.destroyed", {});
    }
    return changes;
  },
};
