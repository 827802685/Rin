/**
 * TRUST_PROXY 的取值解析。
 *
 * 解析结果直接喂给 Express 的 `app.set("trust proxy", value)`，
 * 决定 `req.ip` 到底是「连接过来的那一跳」还是「X-Forwarded-For 里的真实客户端」。
 *
 * 四种取值：
 *
 * | 取值 | 含义 | 何时用 |
 * | --- | --- | --- |
 * | 空 / false / off / 0 | 不信任任何代理（默认） | 直接暴露在公网，或本机开发 |
 * | true / on | 信任 X-Forwarded-For 的**最左侧** | 只在你能保证「外部伪造的 XFF 一定会被前置代理覆写」时用 |
 * | 数字 n（≥1） | 信任从本进程往回数 n 跳 | **推荐**：一层 Nginx 就填 1 |
 * | 逗号分隔列表 | 只信任列表里的地址（IP / CIDR / loopback 等） | 代理地址固定时最精确 |
 *
 * 为什么默认关：开着却不在代理后面，任何人都能在请求里塞一个 `X-Forwarded-For: 1.2.3.4`
 * 来随意切换自己的限流身份——限流、评论防灌水会一起失效。
 * 为什么推荐跳数而不是 true：`true` 直接取最左侧，客户端自己加的一段 XFF 就会被当成真实来源。
 */

const OFF_TOKENS = new Set(["", "false", "off", "no", "0"]);
const ALL_TOKENS = new Set(["true", "on", "yes", "all"]);
const ADDRESS_KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const IPV6 = /^[0-9a-fA-F:.]+$/;

function isIpv4(value) {
  const matched = IPV4.exec(value);
  if (!matched) {
    return false;
  }
  return matched.slice(1).every((octet) => Number(octet) <= 255 && String(Number(octet)) === octet);
}

function isIpv4Cidr(value) {
  const matched = IPV4_CIDR.exec(value);
  if (!matched) {
    return false;
  }
  return isIpv4(matched.slice(1, 5).join(".")) && Number(matched[5]) <= 32;
}

function isIpv6(value) {
  return value.includes(":") && IPV6.test(value);
}

function isIpv6Cidr(value) {
  const slash = value.lastIndexOf("/");
  if (slash <= 0) {
    return false;
  }
  const prefix = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > 128) {
    return false;
  }
  // 地址段必须真的带冒号，否则 10.0.0.0/99 会被误判成「合法的 IPv6 CIDR」。
  return isIpv6(value.slice(0, slash));
}

function isValidEntry(entry) {
  const lower = entry.toLowerCase();
  if (ADDRESS_KEYWORDS.has(lower)) {
    return true;
  }
  return isIpv4(entry) || isIpv4Cidr(entry) || isIpv6(entry) || isIpv6Cidr(entry);
}

/**
 * 把环境变量的原始字符串解析成 Express 认识的设置值。
 *
 * 非法取值直接抛错：这类配置写错不会报错、只会「悄悄把所有人当成同一个来源」
 * 或「谁都能伪造来源」，属于必须在启动阶段就挡住的错误。
 */
export function parseTrustProxy(raw) {
  const value = String(raw ?? "").trim();
  const lower = value.toLowerCase();

  if (OFF_TOKENS.has(lower)) {
    return { enabled: false, value: false, mode: "off", label: "off", raw: value };
  }

  if (ALL_TOKENS.has(lower)) {
    return {
      enabled: true,
      value: true,
      mode: "all",
      label: "all（信任 X-Forwarded-For 最左侧）",
      raw: value,
    };
  }

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (!Number.isInteger(hops) || hops < 1 || hops > 32) {
      throw new Error(`配置项 TRUST_PROXY 作为跳数时必须在 1-32 之间，当前值：${value}`);
    }
    return { enabled: true, value: hops, mode: "hops", label: `${hops} 跳`, raw: value };
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error(`配置项 TRUST_PROXY 无法解析，当前值：${raw}`);
  }
  for (const entry of entries) {
    if (!isValidEntry(entry)) {
      throw new Error(
        `配置项 TRUST_PROXY 的 "${entry}" 不是合法的 IP / CIDR / 关键字（loopback、linklocal、uniquelocal），当前值：${raw}`,
      );
    }
  }

  return {
    enabled: true,
    value: entries.length === 1 ? entries[0] : entries,
    mode: "list",
    label: entries.join(", "),
    raw: value,
  };
}
