import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Hono } from 'hono';

import type { Variables } from '../../core/hono-types';
import {
    buildGitHubExport,
    buildPostMarkdown,
    GitHubService,
    GITHUB_MAX_FILE_BYTES,
    GITHUB_SYNCED_MEDIA_KEY,
    GitHubClient,
    getGitHubPath,
    getGitHubSettings,
    getSyncedMediaKeys,
    isSafeMediaKey,
    markMediaSynced,
    saveSyncedMediaKeys,
    type GitHubSettings,
} from '../github';

const settings: GitHubSettings = {
    enabled: true,
    owner: 'some-user',
    repo: 'blog-content',
    branch: 'main',
    token: 'tok',
};

function fakeConfig(values: Record<string, unknown>) {
    return {
        async get(key: string) {
            return values[key];
        },
    } as any;
}

describe('getGitHubPath', () => {
    const date = new Date('2026-10-13T08:00:00Z');

    it('classifies posts by year/month with slugified title', () => {
        expect(getGitHubPath('post', { id: 7, title: 'Hello World!!', date }))
            .toBe('posts/2026/10/hello-world.md');
    });

    it('keeps Chinese titles', () => {
        expect(getGitHubPath('post', { id: 7, title: '边缘计算实践', date }))
            .toBe('posts/2026/10/边缘计算实践.md');
    });

    it('falls back to id when no title', () => {
        expect(getGitHubPath('post', { id: 7, date })).toBe('posts/2026/10/post-7.md');
    });

    it('stores moments and media in dedicated folders', () => {
        expect(getGitHubPath('moment', { id: 3, date })).toBe('moments/2026/10/moment-3.md');
        expect(getGitHubPath('media', { filename: 'images/a.png' })).toBe('media/images/a.png');
        expect(getGitHubPath('about', { filename: 'intro' })).toBe('about/intro.md');
    });
});

describe('getGitHubSettings', () => {
    const env = {
        GITHUB_REPO_OWNER: 'env-user',
        GITHUB_REPO_NAME: 'env-repo',
        GITHUB_PAT: 'env-tok',
    } as unknown as Env;

    it('returns null when disabled', async () => {
        expect(await getGitHubSettings(fakeConfig({}), env)).toBeNull();
    });

    it('prefers settings-page values over env vars', async () => {
        const result = await getGitHubSettings(fakeConfig({
            'github.enabled': true,
            'github.repo_owner': 'ui-user',
            'github.repo_name': 'ui-repo',
            'github.pat': 'ui-tok',
            'github.cdn_base_url': 'https://cdn.example.com/gh/',
        }), env);

        expect(result).toEqual({
            enabled: true,
            owner: 'ui-user',
            repo: 'ui-repo',
            branch: 'main',
            token: 'ui-tok',
            cdnBaseUrl: 'https://cdn.example.com/gh/',
        });
    });

    it('falls back to env vars when enabled via settings page', async () => {
        const result = await getGitHubSettings(fakeConfig({ 'github.enabled': true }), env);
        expect(result?.owner).toBe('env-user');
        expect(result?.repo).toBe('env-repo');
        expect(result?.token).toBe('env-tok');
    });

    it('returns null when enabled but repo incomplete', async () => {
        const result = await getGitHubSettings(fakeConfig({
            'github.enabled': true,
            'github.repo_owner': 'x',
        }), {} as Env);
        expect(result).toBeNull();
    });
});

describe('GitHubClient.rewriteMediaToCdn', () => {
    const client = new GitHubClient(settings);
    const hosts = ['https://img.example.com'];
    const synced = new Set(['images/a.png']);

    it('rewrites internal /blob/ references to the CDN media folder', () => {
        const out = client.rewriteMediaToCdn('![p](/blob/images/a.png)', hosts, synced);
        expect(out).toBe('![p](https://cdn.jsdelivr.net/gh/some-user/blog-content@main/media/images/a.png)');
    });

    it('rewrites same-site storage URLs', () => {
        const out = client.rewriteMediaToCdn('![p](https://img.example.com/images/a.png)', hosts, synced);
        expect(out).toContain('/media/images/a.png');
    });

    it('leaves external and already-absolute unknown URLs untouched', () => {
        const external = '![p](https://other.site/a.png)';
        expect(client.rewriteMediaToCdn(external, hosts, synced)).toBe(external);
    });

    it('honors custom cdnBaseUrl', () => {
        const custom = new GitHubClient({ ...settings, cdnBaseUrl: 'https://my.cdn/' });
        const out = custom.rewriteMediaToCdn('![p](/blob/a.png)', [], new Set(['a.png']));
        expect(out).toBe('![p](https://my.cdn/media/a.png)');
    });

    // 回归：同步是每天一次，未入库的媒体被无条件改写会让图片直接裂开
    it('does NOT rewrite media that was never synced into the repo', () => {
        const src = '![p](/blob/images/new.png)';
        expect(client.rewriteMediaToCdn(src, hosts, synced)).toBe(src);
    });

    it('rewrites nothing when the synced list is empty', () => {
        const src = '![p](/blob/images/a.png)';
        expect(client.rewriteMediaToCdn(src, hosts, new Set())).toBe(src);
    });

    it('only rewrites the synced image when a post mixes both', () => {
        const src = '![a](/blob/images/a.png) ![b](/blob/images/missing.png)';
        const out = client.rewriteMediaToCdn(src, hosts, synced);
        expect(out).toContain('/media/images/a.png');
        expect(out).toContain('/blob/images/missing.png');
        expect(out).not.toContain('/media/images/missing.png');
    });

    it('matches percent-encoded URLs against decoded synced keys', () => {
        const out = client.rewriteMediaToCdn('![p](/blob/images/a%20b.png)', hosts, new Set(['images/a b.png']));
        expect(out).toContain('/media/images/a%20b.png');
    });
});

describe('synced media key bookkeeping', () => {
    function makeConfig(initial: unknown = undefined) {
        const store = new Map<string, unknown>();
        if (initial !== undefined) {
            store.set(GITHUB_SYNCED_MEDIA_KEY, initial);
        }
        return {
            store,
            async get(key: string) {
                return store.get(key) ?? null;
            },
            async set(key: string, value: unknown) {
                store.set(key, value);
            },
        } as any;
    }

    it('returns an empty set when nothing was recorded', async () => {
        expect(await getSyncedMediaKeys(makeConfig())).toEqual(new Set());
    });

    it('returns an empty set when there is no config at all', async () => {
        expect(await getSyncedMediaKeys(undefined)).toEqual(new Set());
    });

    it('treats a corrupted list as empty instead of rewriting everything', async () => {
        expect(await getSyncedMediaKeys(makeConfig('{not json'))).toEqual(new Set());
    });

    it('round-trips the keys it saved', async () => {
        const config = makeConfig();
        await saveSyncedMediaKeys(config, ['a.png', 'b.png']);
        expect(await getSyncedMediaKeys(config)).toEqual(new Set(['a.png', 'b.png']));
    });

    it('replaces rather than accumulates, so stale keys cannot point at a dead repo', async () => {
        const config = makeConfig();
        await saveSyncedMediaKeys(config, ['old.png']);
        await saveSyncedMediaKeys(config, ['new.png']);
        expect(await getSyncedMediaKeys(config)).toEqual(new Set(['new.png']));
    });

    it('markMediaSynced adds a key without dropping the existing ones', async () => {
        const config = makeConfig();
        await saveSyncedMediaKeys(config, ['a.png']);
        await markMediaSynced(config, 'b.png');
        await markMediaSynced(config, 'b.png');
        expect(await getSyncedMediaKeys(config)).toEqual(new Set(['a.png', 'b.png']));
    });
});

describe('GitHubClient.uploadFile', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function capturePut() {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init: init ?? {} });
            if (init?.method === 'PUT') {
                return new Response(JSON.stringify({ commit: { sha: 'abcdef1234567890', html_url: '' } }), { status: 201 });
            }
            return new Response(JSON.stringify({ sha: 'oldsha' }), { status: 200 });
        }) as typeof fetch;
        return calls;
    }

    it('encodes UTF-8 markdown as base64 without Buffer', async () => {
        const calls = capturePut();
        const client = new GitHubClient(settings);

        const ok = await client.uploadFile({
            path: 'posts/2026/10/测试.md',
            content: '---\ntitle: "你好"\n---\n正文',
            message: 'sync: test',
        });

        expect(ok).toBe(true);
        const put = calls.find((c) => c.init.method === 'PUT');
        const body = JSON.parse(String(put!.init.body));
        const decoded = new TextDecoder().decode(
            Uint8Array.from(atob(body.content), (ch) => ch.charCodeAt(0)),
        );
        expect(decoded).toContain('正文');
        expect(body.sha).toBe('oldsha');
        expect(put!.url).toContain('/contents/posts/2026/10/%E6%B5%8B%E8%AF%95.md');
    });

    it('skips binary payloads above the 1MiB contents API limit', async () => {
        const calls = capturePut();
        const client = new GitHubClient(settings);

        const big = new ArrayBuffer(GITHUB_MAX_FILE_BYTES + 1);
        const ok = await client.uploadFile({ path: 'media/video.mp4', content: big, message: 'sync: media' });

        expect(ok).toBe(false);
        expect(calls.some((c) => c.init.method === 'PUT')).toBe(false);
    });

    it('uploads small binary files as base64', async () => {
        const calls = capturePut();
        const client = new GitHubClient(settings);

        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        const ok = await client.uploadFile({ path: 'media/a.png', content: bytes.buffer, message: 'sync: media' });

        expect(ok).toBe(true);
        const put = calls.find((c) => c.init.method === 'PUT');
        const body = JSON.parse(String(put!.init.body));
        expect(atob(body.content)).toBe(String.fromCharCode(0x89, 0x50, 0x4e, 0x47));
    });
});

describe('buildPostMarkdown', () => {
    it('serializes frontmatter with unified UTF-8 encoding', () => {
        const { path, markdown } = buildPostMarkdown({
            id: 7,
            title: '边缘计算',
            content: '正文',
            summary: '摘要',
            alias: 'edge',
            createdAt: new Date('2026-10-01T00:00:00Z'),
        });

        expect(path).toBe('posts/2026/10/edge.md');
        expect(markdown).toBe(
            '---\nid: 7\ntitle: "边缘计算"\nsummary: "摘要"\nalias: "edge"\ndate: 2026-10-01T00:00:00.000Z\n---\n正文',
        );
    });

    it('falls back to post-<id> when title is null', () => {
        const { markdown } = buildPostMarkdown({
            id: 9,
            title: null,
            content: 'x',
            createdAt: new Date('2026-10-02T00:00:00Z'),
        });
        expect(markdown).toContain('title: "post-9"');
        expect(markdown).not.toContain('summary');
    });
});

describe('isSafeMediaKey', () => {
    it('accepts normal storage keys and rejects traversal', () => {
        expect(isSafeMediaKey('images/2026/a.png')).toBe(true);
        expect(isSafeMediaKey('../evil.png')).toBe(false);
        expect(isSafeMediaKey('..\\evil.png')).toBe(false);
        expect(isSafeMediaKey('/abs.png')).toBe(false);
        expect(isSafeMediaKey('')).toBe(false);
    });
});

describe('buildGitHubExport', () => {
    const db = {
        query: {
            feeds: {
                findMany: async () => [
                    {
                        id: 1,
                        title: '你好',
                        content: '文 ![p](/blob/images/a.png) ![dup](/blob/images/a.png)',
                        summary: 's',
                        alias: null,
                        createdAt: '2026-10-01T00:00:00.000Z',
                    },
                ],
            },
            moments: {
                findMany: async () => [
                    { id: 3, content: 'm ![bad](/blob/../../evil)', createdAt: '2026-10-02T00:00:00.000Z' },
                ],
            },
        },
    } as any;

    it('produces the manifest consumed by GitHub Actions', async () => {
        const env = { S3_ACCESS_HOST: 'https://img.example.com' } as unknown as Env;
        const payload = await buildGitHubExport(db, env);

        expect(payload.files).toHaveLength(2);
        expect(payload.files[0].path).toBe('posts/2026/10/你好.md');
        expect(payload.files[0].content).toContain('id: 1');
        expect(payload.files[1].path).toBe('moments/2026/10/moment-3.md');

        // 去重后只剩合法 key，越界的 ../../evil 被过滤
        expect(payload.media).toEqual([
            { key: 'images/a.png', path: 'media/images/a.png' },
        ]);
    });
});

describe('GET /github/export routes (PAT auth)', () => {
    function createApp(configValues: Record<string, unknown>) {
        const app = new Hono<{ Bindings: Env; Variables: Variables }>();
        app.use('*', async (c: any, next: any) => {
            c.set('serverConfig', { async get(key: string) { return configValues[key]; } });
            c.set('env', {});
            c.set('db', {
                query: {
                    feeds: { findMany: async () => [] },
                    moments: { findMany: async () => [] },
                },
            });
            await next();
        });
        app.route('/github', GitHubService());
        return app;
    }

    const configured = {
        'github.enabled': true,
        'github.repo_owner': 'o',
        'github.repo_name': 'r',
        'github.pat': 'tok',
    };

    it('rejects missing or wrong tokens', async () => {
        const app = createApp(configured);
        expect((await app.request('/github/export')).status).toBe(401);
        const wrong = await app.request('/github/export', { headers: { Authorization: 'token nope' } });
        expect(wrong.status).toBe(401);
    });

    it('rejects when integration is not configured', async () => {
        const app = createApp({});
        const res = await app.request('/github/export', { headers: { Authorization: 'token tok' } });
        expect(res.status).toBe(401);
    });

    it('returns the export manifest for the configured PAT', async () => {
        const app = createApp(configured);
        const res = await app.request('/github/export', { headers: { Authorization: 'Bearer tok' } });
        expect(res.status).toBe(200);
        const payload = await res.json() as any;
        expect(payload.files).toEqual([]);
        expect(payload.media).toEqual([]);
        expect(typeof payload.exportedAt).toBe('string');
    });

    it('rejects traversal keys on the media endpoint', async () => {
        const app = createApp(configured);
        const res = await app.request('/github/export/media?key=../../etc', {
            headers: { Authorization: 'token tok' },
        });
        expect(res.status).toBe(400);
    });
});
