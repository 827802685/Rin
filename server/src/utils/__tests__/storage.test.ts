import { describe, it, expect } from 'bun:test';
import {
  deleteStorageObjectAtKey,
  getStoragePublicUrl,
  isObjectStorageConfigured,
  resolveStorageTarget,
} from '../storage';

/**
 * `getStoragePublicUrl` 有两条分支：直连 S3_ACCESS_HOST，或回落到本站
 * `/api/blob/<key>` 代理。这两条分支历史上只有后者按段编码，前者原样拼 key，
 * 于是含空格 / `#` / `?` / 非 ASCII 的 key 在生产分支上会生成打不开的 URL。
 * 本文件的核心断言是「两条分支解码后必须回到同一个 key」。
 */

function envWith(overrides: Record<string, unknown>): Env {
  return {
    S3_ACCESS_HOST: undefined,
    S3_ENDPOINT: undefined,
    S3_BUCKET: undefined,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined,
    S3_FOLDER: undefined,
    R2_BUCKET: undefined,
    ...overrides,
  } as unknown as Env;
}

/** 从任意分支产出的 URL 里取回 path 部分并解码，用于对称性断言 */
function keyOf(url: string): string {
  const withoutOrigin = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/blob/, '');
  return decodeURIComponent(withoutOrigin.replace(/^\//, ''));
}

describe('getStoragePublicUrl > S3_ACCESS_HOST 分支', () => {
  const env = envWith({ S3_ACCESS_HOST: 'https://images.example.com' });

  it('普通 key 原样拼在 host 后面', () => {
    expect(getStoragePublicUrl(env, 'favicon.webp')).toBe(
      'https://images.example.com/favicon.webp',
    );
  });

  it('保留子目录层级', () => {
    expect(getStoragePublicUrl(env, 'rin/origin/favicon.png')).toBe(
      'https://images.example.com/rin/origin/favicon.png',
    );
  });

  it('host 结尾的斜杠会被去掉，不产生双斜杠', () => {
    const withSlash = envWith({ S3_ACCESS_HOST: 'https://images.example.com/' });
    expect(getStoragePublicUrl(withSlash, 'favicon.webp')).toBe(
      'https://images.example.com/favicon.webp',
    );
  });

  it('key 开头的斜杠会被吃掉，不产生双斜杠', () => {
    expect(getStoragePublicUrl(env, '/favicon.webp')).toBe(
      'https://images.example.com/favicon.webp',
    );
  });

  it('空格按段编码（否则 URL 在传输层就被截断）', () => {
    expect(getStoragePublicUrl(env, 'my folder/a b.png')).toBe(
      'https://images.example.com/my%20folder/a%20b.png',
    );
  });

  it('井号编码，不会被当成 fragment 丢掉后半段', () => {
    expect(getStoragePublicUrl(env, 'a#1.png')).toBe(
      'https://images.example.com/a%231.png',
    );
  });

  it('问号编码，不会被当成 query 丢掉后半段', () => {
    expect(getStoragePublicUrl(env, 'a?b=1.png')).toBe(
      `https://images.example.com/${encodeURIComponent('a?b=1.png')}`,
    );
    expect(getStoragePublicUrl(env, 'a?b=1.png')).not.toContain('?');
  });

  it('非 ASCII 文件名按 UTF-8 百分号编码', () => {
    expect(getStoragePublicUrl(env, '封面/截图.png')).toBe(
      `https://images.example.com/${encodeURIComponent('封面')}/${encodeURIComponent('截图.png')}`,
    );
  });

  it('连续的空段被折叠，不产生空目录', () => {
    expect(getStoragePublicUrl(env, 'a//b.png')).toBe(
      'https://images.example.com/a/b.png',
    );
  });
});

describe('getStoragePublicUrl > /api/blob 代理分支', () => {
  const env = envWith({
    R2_BUCKET: {} as unknown as R2Bucket,
    S3_ENDPOINT: 'https://s3.example.com',
  });

  it('没有 baseUrl 时返回站内相对路径', () => {
    expect(getStoragePublicUrl(env, 'favicon.webp')).toBe(
      '/api/blob/favicon.webp',
    );
  });

  it('带 baseUrl 时拼成绝对地址，并去掉 baseUrl 结尾斜杠', () => {
    expect(getStoragePublicUrl(env, 'favicon.webp', 'https://blog.example.com/')).toBe(
      'https://blog.example.com/api/blob/favicon.webp',
    );
  });

  it('同样按段编码特殊字符', () => {
    expect(getStoragePublicUrl(env, 'a b#1.png')).toBe(
      '/api/blob/a%20b%231.png',
    );
  });
});

describe('getStoragePublicUrl > 两条分支的编码必须对称', () => {
  const tricky = [
    'favicon.webp',
    'my folder/a b.png',
    'a#1.png',
    'a?b=1.png',
    '封面/截图.png',
    '100%.png',
  ];

  const direct = envWith({ S3_ACCESS_HOST: 'https://images.example.com' });
  const proxied = envWith({ R2_BUCKET: {} as unknown as R2Bucket });

  for (const key of tricky) {
    it(`"${key}" 在两条分支下解码后都回到同一个 key`, () => {
      const fromDirect = keyOf(getStoragePublicUrl(direct, key, 'https://images.example.com'));
      const fromProxy = keyOf(getStoragePublicUrl(proxied, key));

      expect(fromDirect).toBe(key);
      expect(fromProxy).toBe(key);
      expect(fromDirect).toBe(fromProxy);
    });
  }
});

describe('resolveStorageTarget', () => {
  it('配了 R2_BUCKET 就走 r2，并带上 folder 与 publicBaseUrl', () => {
    const target = resolveStorageTarget(
      envWith({
        R2_BUCKET: {} as unknown as R2Bucket,
        S3_FOLDER: 'rin/',
        S3_ACCESS_HOST: 'https://images.example.com/',
      }),
    );

    expect(target.type).toBe('r2');
    expect(target.folder).toBe('rin/');
    expect(target.publicBaseUrl).toBe('https://images.example.com');
  });

  it('没有 S3_ACCESS_HOST 时 publicBaseUrl 回落 S3_ENDPOINT', () => {
    const target = resolveStorageTarget(
      envWith({
        S3_ENDPOINT: 'https://s3.example.com/',
        S3_BUCKET: 'rin',
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: 'secret',
      }),
    );

    expect(target.publicBaseUrl).toBe('https://s3.example.com');
  });

  it('S3 变量齐全时走 s3', () => {
    const target = resolveStorageTarget(
      envWith({
        S3_ENDPOINT: 'https://s3.example.com',
        S3_BUCKET: 'rin',
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: 'secret',
      }),
    );

    expect(target.type).toBe('s3');
  });

  it('缺少 S3_ENDPOINT 时抛出', () => {
    expect(() => resolveStorageTarget(envWith({}))).toThrow('S3_ENDPOINT is not defined');
  });

  it('缺少 S3_BUCKET 时抛出', () => {
    expect(() =>
      resolveStorageTarget(
        envWith({
          S3_ENDPOINT: 'https://s3.example.com',
          S3_ACCESS_KEY_ID: 'id',
          S3_SECRET_ACCESS_KEY: 'secret',
        }),
      ),
    ).toThrow('S3_BUCKET is not defined');
  });
});

describe('deleteStorageObjectAtKey', () => {
  const s3Env = envWith({
    S3_ENDPOINT: 'https://s3.example.com',
    S3_BUCKET: 'rin',
    S3_ACCESS_KEY_ID: 'id',
    S3_SECRET_ACCESS_KEY: 'secret',
  });

  it('R2 分支走 bucket.delete，key 原样透传', async () => {
    const deleted: string[] = [];
    const env = envWith({
      R2_BUCKET: {
        delete: async (key: string) => {
          deleted.push(key);
        },
      } as unknown as R2Bucket,
    });

    await deleteStorageObjectAtKey(env, 'rin/originFavicon.jpg');

    expect(deleted).toEqual(['rin/originFavicon.jpg']);
  });

  it('S3 分支发出 DELETE，打到该 key 对应的对象 URL', async () => {
    const seen: { url: string; method: string }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const isRequest = input instanceof Request;
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      seen.push({ url: url.split('?')[0], method: init?.method ?? (isRequest ? input.method : 'GET') });
      return new Response(null, { status: 204 });
    };

    try {
      await deleteStorageObjectAtKey(s3Env, 'rin/originFavicon.jpg');
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(seen.length).toBe(1);
    expect(seen[0].method).toBe('DELETE');
    expect(keyOf(seen[0].url)).toBe('rin/originFavicon.jpg');
  });
});

describe('isObjectStorageConfigured', () => {
  it('有 R2_BUCKET 就算已配置', () => {
    expect(isObjectStorageConfigured(envWith({ R2_BUCKET: {} as unknown as R2Bucket }))).toBe(true);
  });

  it('S3 四项齐全才算已配置', () => {
    expect(
      isObjectStorageConfigured(
        envWith({
          S3_ENDPOINT: 'https://s3.example.com',
          S3_BUCKET: 'rin',
          S3_ACCESS_KEY_ID: 'id',
          S3_SECRET_ACCESS_KEY: 'secret',
        }),
      ),
    ).toBe(true);
  });

  it('缺任意一项就是未配置（可优雅降级的调用方依赖这个判断）', () => {
    const full = {
      S3_ENDPOINT: 'https://s3.example.com',
      S3_BUCKET: 'rin',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
    };

    for (const missing of Object.keys(full)) {
      const partial: Record<string, unknown> = { ...full };
      delete partial[missing];

      expect(isObjectStorageConfigured(envWith(partial))).toBe(false);
    }
  });
});
