import { afterEach, describe, expect, it } from 'bun:test';

import {
    GITHUB_MAX_FILE_BYTES,
    GitHubClient,
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
    return {
        store,
        async get(key: string) {
            return store.get(key);
        },
        async set(key: string, value: unknown) {
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

        const stats = await runGitHubSync(
            client,
            makeDb('![x](/blob/../../evil)'),
            makeEnv(['../evil']),
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

    it('does not mark today as synced when every file failed', async () => {
        stubFetch(500);
        const config = fakeConfig(configured);

        await githubSyncCrontab(makeEnv([]), makeDb('x', 2), config);

        expect(config.store.get('github.last_sync_date')).toBeUndefined();
    });

    it('records today once at least one file succeeded', async () => {
        stubFetch(201);
        const config = fakeConfig(configured);

        await githubSyncCrontab(makeEnv([]), makeDb('x', 2), config);

        expect(config.store.get('github.last_sync_date')).toBe(
            new Date().toISOString().slice(0, 10),
        );
    });

    it('records today even when there is nothing to sync', async () => {
        stubFetch(201);
        const config = fakeConfig(configured);

        await githubSyncCrontab(makeEnv([]), makeDb('x', 0), config);

        expect(config.store.get('github.last_sync_date')).toBe(
            new Date().toISOString().slice(0, 10),
        );
    });
});
