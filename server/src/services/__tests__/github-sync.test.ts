import { afterEach, describe, expect, it } from 'bun:test';

import {
    GITHUB_MAX_FILE_BYTES,
    GITHUB_MIRRORED_IMAGES_KEY,
    GITHUB_SYNCED_MEDIA_KEY,
    GITHUB_SYNCED_HASHES_KEY,
    GITHUB_SYNC_TIMING_KEY,
    GitHubClient,
    parseMirrorableImageSource,
    REMOTE_IMAGE_TOO_LARGE,
    type GitHubSettings,
} from '../github';
import { githubSyncCrontab, runGitHubSync } from '../github-sync';

const settings: GitHubSettings = {
    enabled: true,
    owner: 'some-user',
    repo: 'blog-content',
    branch: 'main',
    token: 'tok',
};

/**
 * 假 R2 绑定。storage 层在 env.R2_BUCKET 存在时直接走 `bucket.get()`，
 * 所以控制「哪些 key 存在」不需要 mock 模块 —— 模块级 mock 在 bun 里会跨测试
 * 文件残留，同进程的 rss / storage / cache 用例会被一起打坏。
 */
function makeEnv(availableKeys: string[]): Env {
    const bytes = new Uint8Array([1, 2, 3]);
    return {
        R2_BUCKET: {
            async get(key: string) {
                if (!availableKeys.includes(key)) return null;
                return {
                    body: bytes,
                    size: bytes.byteLength,
                    httpEtag: '"etag"',
                    uploaded: new Date('2026-10-01T00:00:00Z'),
                    writeHttpMetadata(headers: Headers) {
                        headers.set('Content-Type', 'image/png');
                    },
                };
            },
        },
    } as unknown as Env;
}

function fakeConfig(initial: Record<string, unknown> = {}) {
    const store = new Map<string, unknown>(Object.entries(initial));
    // 真实 CacheImpl.set 会把本 type 的每个键各写一次 D1（线上 14 键实测约 1.5 秒），
    // 同步循环只能用 setQuick；这里的计数就是防止有人改回去。
    const writes = { full: 0, quick: 0 };
    return {
        store,
        writes,
        async get(key: string) {
            return store.get(key);
        },
        async set(key: string, value: unknown) {
            writes.full++;
            store.set(key, value);
        },
        async setQuick(key: string, value: unknown) {
            writes.quick++;
            store.set(key, value);
        },
    } as any;
}

function makeDb(feedContent: string, feedCount = 1) {
    return {
        query: {
            feeds: {
                findMany: async () =>
                    Array.from({ length: feedCount }, (_, i) => ({
                        id: i + 1,
                        title: 't',
                        content: feedContent,
                        summary: '',
                        alias: null,
                        createdAt: '2026-10-01T00:00:00.000Z',
                    })),
            },
            moments: { findMany: async () => [] },
        },
    } as any;
}

/** 记录所有被上传的仓库路径 */
function recordingClient(): { client: GitHubClient; uploaded: string[] } {
    const uploaded: string[] = [];
    const client = new GitHubClient(settings);
    (client as any).uploadFile = async (meta: { path: string }) => {
        uploaded.push(meta.path);
        return true;
    };
    return { client, uploaded };
}

/** 上传一律失败，用来区分「进仓了」和「被拒绝了」 */
function failingClient(): { client: GitHubClient } {
    const client = new GitHubClient(settings);
    (client as any).uploadFile = async () => false;
    return { client };
}

describe('GitHubClient.uploadFile size limit', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function capturePut() {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init: init ?? {} });
            if (init?.method === 'PUT') {
                return new Response(JSON.stringify({ commit: { sha: 'abc1234567890', html_url: '' } }), { status: 201 });
            }
            return new Response(JSON.stringify({ sha: 'oldsha' }), { status: 200 });
        }) as typeof fetch;
        return calls;
    }

    it('skips oversized markdown text instead of sending a request GitHub will reject', async () => {
        const calls = capturePut();
        const client = new GitHubClient(settings);

        const ok = await client.uploadFile({
            path: 'posts/2026/10/huge.md',
            content: 'a'.repeat(GITHUB_MAX_FILE_BYTES + 1),
            message: 'sync: post 1',
        });

        expect(ok).toBe(false);
        expect(calls.some((c) => c.init.method === 'PUT')).toBe(false);
    });

    it('still uploads text that fits, so the limit is not a blanket block', async () => {
        const calls = capturePut();
        const client = new GitHubClient(settings);

        const ok = await client.uploadFile({
            path: 'posts/2026/10/ok.md',
            content: 'a'.repeat(GITHUB_MAX_FILE_BYTES),
            message: 'sync: post 1',
        });

        expect(ok).toBe(true);
        expect(calls.some((c) => c.init.method === 'PUT')).toBe(true);
    });

    it('counts multibyte text by UTF-8 bytes, not UTF-16 code units', async () => {
        const calls = capturePut();
        const client = new GitHubClient(settings);

        // 350000 个中文 = 1050000 字节 > 1MiB，但 UTF-16 code unit 只有 350000
        const ok = await client.uploadFile({
            path: 'posts/2026/10/cjk.md',
            content: '中'.repeat(350_000),
            message: 'sync: post 1',
        });

        expect(ok).toBe(false);
        expect(calls.some((c) => c.init.method === 'PUT')).toBe(false);
    });
});

describe('runGitHubSync media key safety', () => {
    it('never uploads a traversal media key referenced from an article', async () => {
        const { client, uploaded } = recordingClient();

        // 对象必须真的存在：取不到会走「对象不存在」分支 skipped，
        // 跟「被安全过滤挡下」的计数一样，那样这条用例就守不住过滤了。
        const stats = await runGitHubSync(
            client,
            makeDb('![x](/blob/../../evil)'),
            makeEnv(['../../evil']),
        );

        expect(stats.media.total).toBe(1);
        expect(stats.media.skipped).toBe(1);
        expect(stats.media.success).toBe(0);
        expect(uploaded.some((p) => p.includes('..'))).toBe(false);
    });

    it('still uploads well-formed media keys', async () => {
        const { client, uploaded } = recordingClient();

        const stats = await runGitHubSync(
            client,
            makeDb('![x](/blob/images/a.png)'),
            makeEnv(['images/a.png']),
        );

        expect(stats.media.success).toBe(1);
        expect(uploaded).toContain('media/images/a.png');
    });

    it('仓库里已经有的媒体不再重复下载和推送', async () => {
        // 线上实测：手动同步每次都把站内媒体重推一遍，20 秒预算正是被这段吃光的
        const { client, uploaded } = recordingClient();
        const config = fakeConfig({
            [GITHUB_SYNCED_MEDIA_KEY]: JSON.stringify(['images/a.png']),
        });

        const stats = await runGitHubSync(
            client,
            makeDb('![a](/blob/images/a.png) ![b](/blob/images/b.png)'),
            makeEnv(['images/a.png', 'images/b.png']),
            config,
        );

        expect(uploaded).not.toContain('media/images/a.png');
        expect(uploaded).toContain('media/images/b.png');
        expect(stats.media.alreadyPresent).toBe(1);
        expect(stats.media.success).toBe(1);
        // 跳过的那把 key 仍留在清单里，正文的 CDN 重写口径不能倒退
        expect(new Set(JSON.parse(String(config.store.get(GITHUB_SYNCED_MEDIA_KEY)))))
            .toEqual(new Set(['images/a.png', 'images/b.png']));
    });

    it('超过 1 MiB 的站内媒体不下载，直接留给 Actions', async () => {
        const { client, uploaded } = recordingClient();
        // body 故意给很小的：只按声明体积判定就不该碰它
        const env = {
            R2_BUCKET: {
                async get() {
                    return {
                        body: new Uint8Array(64),
                        size: GITHUB_MAX_FILE_BYTES + 1,
                        httpEtag: '"etag"',
                        uploaded: new Date('2026-10-01T00:00:00Z'),
                        writeHttpMetadata(headers: Headers) {
                            headers.set('Content-Type', 'image/png');
                        },
                    };
                },
            },
        } as unknown as Env;

        const stats = await runGitHubSync(client, makeDb('![big](/blob/big.png)'), env);

        expect(stats.media.deferredToActions).toBe(1);
        expect(uploaded).not.toContain('media/big.png');
    });
});

describe('runGitHubSync synced-media bookkeeping', () => {
    it('records only the media that actually landed in the repo', async () => {
        const { client } = recordingClient();
        const config = fakeConfig();

        // 两张图都被引用，但只有 a.png 在对象存储里，b.png 取不到 -> skipped
        await runGitHubSync(
            client,
            makeDb('![a](/blob/images/a.png) ![b](/blob/images/b.png)'),
            makeEnv(['images/a.png']),
            config,
        );

        expect(new Set(JSON.parse(String(config.store.get(GITHUB_SYNCED_MEDIA_KEY)))))
            .toEqual(new Set(['images/a.png']));
    });

    it('omits skipped keys even when the upload itself fails', async () => {
        const { client } = failingClient();
        const config = fakeConfig();

        await runGitHubSync(
            client,
            makeDb('![a](/blob/images/a.png)'),
            makeEnv(['images/a.png']),
            config,
        );

        // 上传失败 = 仓库里没有这个文件，绝不能记进去给 CDN 重写放行
        expect(JSON.parse(String(config.store.get(GITHUB_SYNCED_MEDIA_KEY)))).toEqual([]);
    });

    it('leaves the config untouched when no serverConfig is provided', async () => {
        const { client } = recordingClient();

        const stats = await runGitHubSync(
            client,
            makeDb('![a](/blob/images/a.png)'),
            makeEnv(['images/a.png']),
        );

        expect(stats.media.success).toBe(1);
    });
});

describe('runGitHubSync 内容指纹', () => {
    it('正文没变的文章第二轮一个请求都不发，改一个字就重推', async () => {
        // 线上实测：每篇文章都要 GET sha + PUT 两次 GitHub 往返，5 篇就把手动同步拖过了切断线
        const { client, uploaded } = recordingClient();
        const config = fakeConfig();

        const first = await runGitHubSync(client, makeDb('正文'), makeEnv([]), config);
        expect(first.feeds.success).toBe(1);
        expect(uploaded.length).toBe(1);

        uploaded.length = 0;
        const second = await runGitHubSync(client, makeDb('正文'), makeEnv([]), config);
        expect(uploaded).toEqual([]);
        expect(second.feeds.unchanged).toBe(1);
        expect(second.feeds.success).toBe(0);

        uploaded.length = 0;
        const third = await runGitHubSync(client, makeDb('正文改'), makeEnv([]), config);
        expect(third.feeds.success).toBe(1);
        expect(uploaded.length).toBe(1);
    });

    it('推失败的文件不写指纹，免得以后被当成已同步跳过', async () => {
        const config = fakeConfig();
        const { client } = recordingClient();
        (client as any).uploadFile = async () => {
            throw new Error('push interrupted');
        };

        const stats = await runGitHubSync(client, makeDb('正文'), makeEnv([]), config);

        expect(stats.feeds.failed).toBe(1);
        // 仓库里没这个文件，指纹表必须保持空
        expect(config.store.get(GITHUB_SYNCED_HASHES_KEY)).toBeUndefined();
    });
});

describe('runGitHubSync 单条超时', () => {
    it('GitHub 请求挂起时按超时记账，整轮照常收尾', async () => {
        // 线上实测：手动同步每轮都停在「推文章」，页面只收到 524。挂住的那条必须自己认输，
        // 否则一次网络抖动就能让清单、指纹、计时全部写不进去。
        const config = fakeConfig();
        const client = new GitHubClient(settings);
        (client as any).uploadFile = () => new Promise(() => {});
        (client as any).remoteFileExists = async () => false;
        (client as any).fetchRemoteImage = async () => null;

        const stats = await runGitHubSync(
            client,
            makeDb('正文'),
            makeEnv([]),
            config,
            { itemBudgetMs: 20 },
        );

        expect(stats.feeds.failed).toBe(1);
        const timing = JSON.parse(String(config.store.get(GITHUB_SYNC_TIMING_KEY)));
        expect(timing.running).toBe('done');
        expect(String(timing.errors)).toContain('推送文章 1 超时');
    });
});

describe('runGitHubSync 配置写入方式', () => {
    it('整轮只用单行 upsert 写配置，不触发全表重刷', async () => {
        // 线上实测：CacheImpl.set 会为本 type 每个键各发一次 D1 写（14 个键约 1.5 秒），
        // 逐条计时/指纹那些高频写入把整轮预算吃光，才是手动同步一直 524 的直接原因。
        const config = fakeConfig();
        const { client } = recordingClient();

        const stats = await runGitHubSync(
            client,
            makeDb('![a](/blob/images/a.png)'),
            makeEnv(['images/a.png']),
            config,
        );

        expect(stats.feeds.success).toBe(1);
        expect(config.writes.full).toBe(0);
        expect(config.writes.quick).toBeGreaterThan(0);
    });
});

describe('runGitHubSync 外链图片镜像', () => {
    const IMG = 'https://raw.githubusercontent.com/some-user/image/refs/heads/main/a.png';
    const mediaPath = parseMirrorableImageSource(IMG, 'some-user')!.mediaPath;

    /** 可控外链镜像：remoteFileExists 决定是否已在仓，fetchRemoteImage 决定字节大小 */
    function mirrorClient(opts: { existsInRepo?: boolean; bytes?: number | null }) {
        const uploaded: string[] = [];
        const client = new GitHubClient(settings);
        (client as any).uploadFile = async (meta: { path: string }) => {
            uploaded.push(meta.path);
            return true;
        };
        (client as any).remoteFileExists = async () => opts.existsInRepo ?? false;
        (client as any).fetchRemoteImage = async () =>
            opts.bytes === null ? null : new Uint8Array(opts.bytes ?? 100).buffer;
        return { client, uploaded };
    }

    it('小图（≤1MiB）由 Worker 下载并推进仓库，记入镜像清单', async () => {
        const { client, uploaded } = mirrorClient({ bytes: 200 * 1024 });
        const config = fakeConfig();

        const stats = await runGitHubSync(client, makeDb(`![a](${IMG})`), makeEnv([]), config);

        expect(stats.images.total).toBe(1);
        expect(stats.images.success).toBe(1);
        expect(uploaded).toContain(mediaPath);
        expect(new Set(JSON.parse(String(config.store.get(GITHUB_MIRRORED_IMAGES_KEY)))))
            .toEqual(new Set([`${'some-user'}/image/refs/heads/main/a.png`]));
    });

    it('大图（>1MiB）不硬推，标记为交给 Actions，且不进镜像清单', async () => {
        const { client, uploaded } = mirrorClient({ bytes: GITHUB_MAX_FILE_BYTES + 1 });
        const config = fakeConfig();

        const stats = await runGitHubSync(client, makeDb(`![a](${IMG})`), makeEnv([]), config);

        expect(stats.images.deferredToActions).toBe(1);
        expect(stats.images.success).toBe(0);
        expect(uploaded).not.toContain(mediaPath);
        expect(JSON.parse(String(config.store.get(GITHUB_MIRRORED_IMAGES_KEY)))).toEqual([]);
    });

    it('大图只按响应头判定就交给 Actions，不占时间预算', async () => {
        const { client, uploaded } = mirrorClient({ bytes: null });
        (client as any).fetchRemoteImage = async () => REMOTE_IMAGE_TOO_LARGE;

        const stats = await runGitHubSync(client, makeDb(`![a](${IMG})`), makeEnv([]), fakeConfig());

        expect(stats.images.deferredToActions).toBe(1);
        expect(stats.images.success).toBe(0);
        expect(uploaded).not.toContain(mediaPath); // 只推了 markdown，没推这张大图
    });

    it('仓库里已存在（Actions 提交过）则认领、不重复下载', async () => {
        const { client, uploaded } = mirrorClient({ existsInRepo: true, bytes: null });
        const config = fakeConfig();

        const stats = await runGitHubSync(client, makeDb(`![a](${IMG})`), makeEnv([]), config);

        expect(stats.images.alreadyPresent).toBe(1);
        expect(uploaded).not.toContain(mediaPath); // 没有重复上传媒体，只认领
        expect(new Set(JSON.parse(String(config.store.get(GITHUB_MIRRORED_IMAGES_KEY)))).size).toBe(1);
    });

    it('第三方图片不被提取，images.total 为 0', async () => {
        const { client } = mirrorClient({ bytes: 100 });
        const stats = await runGitHubSync(
            client,
            makeDb('![x](https://camo.githubusercontent.com/abc/def.png)'),
            makeEnv([]),
            fakeConfig(),
        );
        expect(stats.images.total).toBe(0);
    });

    it('时间预算用尽时留到下一轮，并标记 partial', async () => {
        const IMG2 = 'https://raw.githubusercontent.com/some-user/image/refs/heads/main/b.png';
        const IMG3 = 'https://raw.githubusercontent.com/some-user/image/refs/heads/main/c.png';
        const { client } = mirrorClient({ bytes: 100 });
        const exists = (client as any).remoteFileExists;
        (client as any).remoteFileExists = async (path: string) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return exists(path);
        };

        // 1ms 预算：只断言「有图被预算挡下 + 标记未完成」，不赌具体第几张
        const stats = await runGitHubSync(
            client,
            makeDb(`![a](${IMG})\n![b](${IMG2})\n![c](${IMG3})`),
            makeEnv([]),
            fakeConfig(),
            { budgetMs: 1 },
        );

        expect(stats.images.total).toBe(3);
        expect(stats.images.deferredByTime).toBeGreaterThanOrEqual(1);
        expect(stats.images.deferredByTime + stats.images.success + stats.images.alreadyPresent).toBe(3);
        expect(stats.partial).toBe(true);
    });

    it('镜像清单当场落盘，后续步骤崩了也不丢进度', async () => {
        // 线上实测：手动同步跑到一半被 Cloudflare 524 切断，文件已进仓但清单没写，
        // 于是正文永远切不到 CDN。所以每进一张就存一次。
        const client = new GitHubClient(settings);
        (client as any).uploadFile = async (meta: { path: string }) => {
            if (meta.path === mediaPath) return true;
            throw new Error('push interrupted');
        };
        (client as any).remoteFileExists = async () => false;
        (client as any).fetchRemoteImage = async () => new Uint8Array(100).buffer;
        const config = fakeConfig();

        // 单条推送抛错不能把整轮带崩：已进仓的图片必须留在清单里，失败只记账。
        const stats = await runGitHubSync(client, makeDb(`![a](${IMG})`), makeEnv([]), config);

        expect(new Set(JSON.parse(String(config.store.get(GITHUB_MIRRORED_IMAGES_KEY)))))
            .toEqual(new Set(['some-user/image/refs/heads/main/a.png']));
        expect(stats.images.success).toBe(1);
        expect(stats.feeds.total).toBe(1);
        expect(stats.feeds.failed).toBe(1);
    });
});

describe('githubSyncCrontab retry bookkeeping', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function stubFetch(putStatus: number) {
        globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
            if (init?.method === 'PUT') {
                return new Response(JSON.stringify({ commit: { sha: 'abc1234567890' } }), { status: putStatus });
            }
            return new Response(JSON.stringify({ sha: 'oldsha' }), { status: 200 });
        }) as typeof fetch;
    }

    const configured = {
        'github.enabled': true,
        'github.repo_owner': 'o',
        'github.repo_name': 'r',
        'github.pat': 'tok',
    };

    it('全部失败时不记今天，下一 tick 继续重试', async () => {
        stubFetch(500);
        const config = fakeConfig(configured);

        await githubSyncCrontab(makeEnv([]), makeDb('x', 2), config);

        expect(config.store.get('github.last_sync_date')).toBeUndefined();
    });

    it('至少推成一个就记今天', async () => {
        stubFetch(201);
        const config = fakeConfig(configured);

        await githubSyncCrontab(makeEnv([]), makeDb('x', 2), config);

        expect(config.store.get('github.last_sync_date')).toBe(
            new Date().toISOString().slice(0, 10),
        );
    });

    it('没有内容要同步时也记今天', async () => {
        stubFetch(201);
        const config = fakeConfig(configured);

        await githubSyncCrontab(makeEnv([]), makeDb('x', 0), config);

        expect(config.store.get('github.last_sync_date')).toBe(
            new Date().toISOString().slice(0, 10),
        );
    });

    it('整轮全是「未变动」也算成功，否则日频闸门形同虚设', async () => {
        // 指纹让同一天的第二次扫描一个 GitHub 请求都不发；这种轮次必须记今天，
        // 不然每 20 分钟的 tick 都会重扫一遍，等于永远不收敛。
        stubFetch(201);
        const today = new Date().toISOString().slice(0, 10);
        const config = fakeConfig(configured);

        await githubSyncCrontab(makeEnv([]), makeDb('x', 2), config);
        const first = config.store.get('github.last_sync_date');
        expect(first).toBe(today);

        // 第二次 tick：闸门直接生效，一个 fetch 都不许发
        globalThis.fetch = (async () => {
            throw new Error('daily gate must skip');
        }) as typeof fetch;
        await githubSyncCrontab(makeEnv([]), makeDb('x', 2), config);
        expect(config.store.get('github.last_sync_date')).toBe(today);
    });
});
