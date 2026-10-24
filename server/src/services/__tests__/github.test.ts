import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Hono } from 'hono';

import type { Variables } from '../../core/hono-types';
import {
    buildGitHubExport,
    buildMomentMarkdown,
    buildPostMarkdown,
    redactSecrets,
    GitHubService,
    GITHUB_GIT_BLOB_MAX_BYTES,
    GITHUB_MAX_FILE_BYTES,
    GITHUB_MIRRORED_IMAGES_KEY,
    GITHUB_SYNCED_MEDIA_KEY,
    GitHubClient,
    extractMirrorableImageSources,
    getGitHubPath,
    getGitHubSettings,
    getMirroredImageKeys,
    getSyncedMediaKeys,
    isSafeMediaKey,
    markMediaSynced,
    parseMirrorableImageSource,
    REMOTE_IMAGE_TOO_LARGE,
    saveMirroredImageKeys,
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
        expect(out).toBe('![p](https://cdn.statically.io/gh/some-user/blog-content/main/media/images/a.png)');
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

describe('外链图片镜像：源解析', () => {
    it('识别 raw.githubusercontent 的自有仓库图片（含 refs/heads 形式）', () => {
        const url = 'https://raw.githubusercontent.com/some-user/image/refs/heads/main/pictures/a.png';
        const parsed = parseMirrorableImageSource(url, 'some-user');
        expect(parsed).not.toBeNull();
        expect(parsed!.key).toBe('some-user/image/refs/heads/main/pictures/a.png');
        expect(parsed!.fetchUrl).toBe('https://raw.githubusercontent.com/some-user/image/refs/heads/main/pictures/a.png');
        expect(parsed!.mediaPath).toMatch(/^media\/[A-Za-z0-9_-]+\.png$/);
    });

    it('识别 github.com/blob + ?raw=true 写法，并规范化为 raw 下载地址', () => {
        const url = 'https://github.com/some-user/image/blob/main/pictures/a.jpg?raw=true';
        const parsed = parseMirrorableImageSource(url, 'some-user');
        expect(parsed!.fetchUrl).toBe('https://raw.githubusercontent.com/some-user/image/main/pictures/a.jpg');
        expect(parsed!.mediaPath).toMatch(/\.jpg$/);
    });

    it('自建反代域名的两种形态与 raw 写法解析成同一个 key', () => {
        // 线上实测：正文里的图全走自建反代域名（github.com 在本机被 SNI 拦）。
        // 不认这两种形态，Actions 把大图提交进仓后也认领不到、永远切不到 CDN。
        const raw = parseMirrorableImageSource(
            'https://raw.githubusercontent.com/some-user/image/refs/heads/main/a.jpg',
            'some-user',
        )!;
        const encodedHost = parseMirrorableImageSource(
            'https://raw-githubusercontent-com-gh.example.dpdns.org/some-user/image/refs/heads/main/a.jpg',
            'some-user',
        )!;
        const blobProxy = parseMirrorableImageSource(
            'https://gh.example.dpdns.org/some-user/image/blob/main/refs/heads/main/a.jpg?raw=true',
            'some-user',
        )!;

        expect(encodedHost.key).toBe(raw.key);
        expect(encodedHost.mediaPath).toBe(raw.mediaPath);
        expect(encodedHost.fetchUrl).toBe(raw.fetchUrl);
        // blob 形态的 ref/path 与 github.com 一致，落仓文件名也必须是同一个
        expect(blobProxy.mediaPath).toBe(
            parseMirrorableImageSource('https://github.com/some-user/image/blob/main/refs/heads/main/a.jpg', 'some-user')!.mediaPath,
        );
    });

    it('保留 #blurhash 片段，且片段不影响源标识与哈希', () => {
        const withFrag = 'https://raw.githubusercontent.com/some-user/image/refs/heads/main/a.png#blurhash=LGFhPR&width=3000';
        const noFrag = 'https://raw.githubusercontent.com/some-user/image/refs/heads/main/a.png';
        const a = parseMirrorableImageSource(withFrag, 'some-user')!;
        const b = parseMirrorableImageSource(noFrag, 'some-user')!;
        expect(a.fragment).toBe('#blurhash=LGFhPR&width=3000');
        expect(a.key).toBe(b.key);
        expect(a.mediaPath).toBe(b.mediaPath);
    });

    it('非自有仓库（第三方图、GitHub 徽章）一律不镜像', () => {
        expect(parseMirrorableImageSource('https://raw.githubusercontent.com/other/repo/refs/heads/main/a.png', 'some-user')).toBeNull();
        expect(parseMirrorableImageSource('https://camo.githubusercontent.com/abc/def', 'some-user')).toBeNull();
        expect(parseMirrorableImageSource('https://other.site/a.png', 'some-user')).toBeNull();
    });

    it('中文/空格路径也能安全哈希成稳定文件名，且两次解析一致', () => {
        const url = 'https://raw.githubusercontent.com/some-user/image/refs/heads/main/屏幕截图 2025-09-16.png';
        const p1 = parseMirrorableImageSource(url, 'some-user')!;
        const p2 = parseMirrorableImageSource(url, 'some-user')!;
        expect(p1.mediaPath).toBe(p2.mediaPath);
        expect(p1.mediaPath).toMatch(/^media\/[A-Za-z0-9_-]+\.png$/);
    });
});

describe('外链图片镜像：提取与改写', () => {
    const client = new GitHubClient(settings);
    const hosts: string[] = [];

    it('extractMirrorableImageSources 按 key 去重', () => {
        const content =
            '![a](https://raw.githubusercontent.com/some-user/image/refs/heads/main/a.png) ' +
            '![a2](https://raw.githubusercontent.com/some-user/image/refs/heads/main/a.png#blurhash=x) ' +
            '![b](https://raw.githubusercontent.com/some-user/image/refs/heads/main/b.png)';
        const map = extractMirrorableImageSources(content, 'some-user');
        expect(map.size).toBe(2);
    });

    it('只有已镜像进仓库的外链才改写成 CDN，并保留片段', () => {
        const src = 'https://raw.githubusercontent.com/some-user/image/refs/heads/main/a.png#blurhash=LGF';
        const parsed = parseMirrorableImageSource(src, 'some-user')!;
        const mirrored = new Set([parsed.key]);
        const out = client.rewriteMediaToCdn(`![p](${src})`, hosts, new Set(), mirrored);
        expect(out).toBe(`![p](https://cdn.statically.io/gh/some-user/blog-content/main/${parsed.mediaPath}#blurhash=LGF)`);
    });

    it('未镜像的外链原样保留（不指向不存在的 CDN 文件）', () => {
        const src = '![p](https://raw.githubusercontent.com/some-user/image/refs/heads/main/missing.png)';
        expect(client.rewriteMediaToCdn(src, hosts, new Set(), new Set())).toBe(src);
        expect(client.rewriteMediaToCdn(src, hosts, new Set(), new Set(['other/key']))).toBe(src);
    });

    it('镜像清单读写：损坏 JSON 视为空集，覆盖写入去重截断', async () => {
        const store = new Map<string, unknown>();
        const config = {
            async get(key: string) { return store.get(key) ?? null; },
            async set(key: string, value: unknown) { store.set(key, value); },
            async setQuick(key: string, value: unknown) { store.set(key, value); },
        } as any;

        store.set(GITHUB_MIRRORED_IMAGES_KEY, '{not json');
        expect(await getMirroredImageKeys(config)).toEqual(new Set());

        await saveMirroredImageKeys(config, ['a', 'a', 'b']);
        expect(await getMirroredImageKeys(config)).toEqual(new Set(['a', 'b']));

        // 冷启动后 CacheImpl 逐行 JSON.parse，get 返回的是数组而不是字符串
        store.set(GITHUB_MIRRORED_IMAGES_KEY, ['c']);
        expect(await getMirroredImageKeys(config)).toEqual(new Set(['c']));
    });
});

describe('GitHubClient.remoteFileExists / fetchRemoteImage', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('contents 查询 200 → 存在，404 → 不存在', async () => {
        let status = 200;
        globalThis.fetch = (async () => new Response(
            status === 200 ? JSON.stringify({ sha: 'x' }) : JSON.stringify({ message: 'Not Found' }),
            { status },
        )) as typeof fetch;
        const client = new GitHubClient(settings);
        expect(await client.remoteFileExists('media/a.png')).toBe(true);
        status = 404;
        expect(await client.remoteFileExists('media/a.png')).toBe(false);
    });

    it('fetchRemoteImage 非 2xx 返回 null，不发认证头到第三方', async () => {
        const seen: Array<{ url: string; ua?: string; auth?: string }> = [];
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            const h = new Headers((init?.headers as Record<string, string>) ?? {});
            seen.push({ url: String(url), ua: h.get('User-Agent') ?? undefined, auth: h.get('Authorization') ?? undefined });
            return new Response('nope', { status: 404 });
        }) as typeof fetch;
        const client = new GitHubClient(settings);
        expect(await client.fetchRemoteImage('https://raw.githubusercontent.com/some-user/image/refs/heads/main/a.png')).toBeNull();
        expect(seen[0].auth).toBeUndefined();
        expect(seen[0].ua).toBe('rin-blog-github-sync');
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
            async setQuick(key: string, value: unknown) {
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

    it('accepts a list that CacheImpl already parsed back into an array', async () => {
        // 同步写入的是 JSON 字符串，但冷启动逐行 JSON.parse 后 get 返回的是数组；
        // 只认字符串会让 CDN 改写在每次冷启动后静默失效。
        expect(await getSyncedMediaKeys(makeConfig(['a.png', 'b.png'])))
            .toEqual(new Set(['a.png', 'b.png']));
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

    it('sends a User-Agent on every GitHub request', async () => {
        const calls = capturePut();
        const client = new GitHubClient(settings);

        await client.uploadFile({ path: 'posts/a.md', content: 'x', message: 'sync: a' });

        // Workers runtime 的出站 fetch 不带 UA，GitHub 会直接回 403
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
            expect((call.init.headers as Record<string, string>)['User-Agent']).toBe('rin-blog-github-sync');
        }
    });
});

describe('GitHubClient.checkAccess', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function stub(statuses: [number, number]) {
        const urls: Array<{ url: string; method?: string }> = [];
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            urls.push({ url: String(url), method: init?.method });
            const status = statuses[urls.length - 1];
            return new Response(status === 204 ? '' : '{}', { status });
        }) as typeof fetch;
        return urls;
    }

    it('reports ok only when the repo is reachable and contents are writable', async () => {
        const urls = stub([200, 204]);
        const result = await new GitHubClient(settings).checkAccess();

        expect(result).toEqual({ ok: true, repoStatus: 200, writeStatus: 204 });
        expect(urls[1]!.method).toBe('OPTIONS');
    });

    it('surfaces the status codes instead of throwing when GitHub rejects the request', async () => {
        stub([403, 403]);
        const result = await new GitHubClient(settings).checkAccess();

        expect(result.ok).toBe(false);
        expect(result.repoStatus).toBe(403);
    });
});

describe('redactSecrets', () => {
    const secrets = {
        classic: `ghp_${'A'.repeat(36)}`,
        fine: `github_pat_${'1AbC_'.repeat(8)}`,
        cfApi: `cfat_${'x'.repeat(40)}`,
        aws: `AKIA${'ABCDEFGH12345678'}`,
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4if0.dQgQvJZ7YH0rXxJ1k2L3m4n5o6p7q8r9s0t1u2v3w4x',
        pem: '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAASCA\n-----END PRIVATE KEY-----',
        assigned: 'JWT_SECRET = "aVeryLongSigningSecretValue123"',
        header: 'Authorization: Bearer sk_live_abcdefghijklmnop1234',
    };

    it('replaces every credential shape and reports only the category names', () => {
        const input = Object.values(secrets).join('\n');
        const { text, hits } = redactSecrets(input);

        for (const value of Object.values(secrets)) {
            expect(text).not.toContain(value.slice(0, 24));
        }
        expect(text).toContain('[已脱敏]');
        expect(hits.sort()).toEqual(
            ['assigned_secret', 'auth_header', 'aws_key', 'cf_token', 'github_token', 'jwt', 'private_key'].sort(),
        );
        // 键名要留着，读者才看得出是哪一项被挡住
        expect(text).toContain('JWT_SECRET = ');
    });

    it('leaves normal blog content untouched', () => {
        const benign = [
            '联系邮箱 someone@example.com',
            '![图](https://raw.githubusercontent.com/827802685/image/refs/heads/main/a.jpg#blurhash=LGFhPR)',
            '弱密码示例：password: "123456"',
            'tokenizer = "gpt2"',
            '配置里写 JWT_SECRET = ""',
            '部署用 bun cli/bin/rin.ts deploy --server',
        ].join('\n');

        const { text, hits } = redactSecrets(benign);
        expect(text).toBe(benign);
        expect(hits).toEqual([]);
    });

    it('applies to the markdown that actually goes into the repo', () => {
        const leak = `正文里的令牌 ${secrets.classic}`;
        const post = buildPostMarkdown({
            id: 11,
            title: '部署笔记',
            content: leak,
            summary: `摘要也抄了一份 ${secrets.fine}`,
            alias: null,
            createdAt: new Date('2026-10-01T00:00:00Z'),
        });
        expect(post.markdown).not.toContain(secrets.classic);
        expect(post.markdown).not.toContain(secrets.fine);
        expect(post.markdown).toContain('summary: "摘要也抄了一份 [已脱敏]"');

        const moment = buildMomentMarkdown({
            id: 5,
            content: `动态 ${secrets.aws}`,
            createdAt: new Date('2026-10-02T00:00:00Z'),
        });
        expect(moment.markdown).not.toContain(secrets.aws);
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

describe('GitHubClient.fetchRemoteImage 大小闸门', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    /** 假响应：只给响应头，body 是否被读走由 seen 记录 */
    function stubRemote(contentLength: number | null, bodyBytes: number) {
        const seen = { arrayBufferCalled: false, cancelled: false };
        const fake = {
            ok: true,
            status: 200,
            headers: new Headers(contentLength === null ? {} : { 'content-length': String(contentLength) }),
            body: {
                async cancel() {
                    seen.cancelled = true;
                },
            },
            async arrayBuffer() {
                seen.arrayBufferCalled = true;
                return new Uint8Array(bodyBytes).buffer;
            },
        } as unknown as Response;
        globalThis.fetch = (async () => fake) as typeof fetch;
        return seen;
    }

    const big = 'https://raw.githubusercontent.com/some-user/image/refs/heads/main/big.png';

    it('响应头显示超过 1 MiB 时不下载 body', async () => {
        const seen = stubRemote(GITHUB_MAX_FILE_BYTES + 1, GITHUB_MAX_FILE_BYTES + 1);

        const result = await new GitHubClient(settings).fetchRemoteImage(big);

        expect(result).toBe(REMOTE_IMAGE_TOO_LARGE);
        expect(seen.arrayBufferCalled).toBe(false);
        expect(seen.cancelled).toBe(true);
    });

    it('响应头没有长度时下载完再判大小', async () => {
        const seen = stubRemote(null, GITHUB_MAX_FILE_BYTES + 1);

        const result = await new GitHubClient(settings).fetchRemoteImage(big);

        expect(result).toBe(REMOTE_IMAGE_TOO_LARGE);
        expect(seen.arrayBufferCalled).toBe(true);
    });

    it('小图正常返回字节', async () => {
        stubRemote(100, 100);

        const result = await new GitHubClient(settings).fetchRemoteImage(
            'https://raw.githubusercontent.com/some-user/image/refs/heads/main/a.png',
        );

        expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it('传入更大的上限时，1 MiB 以上的图也能取回字节（交给 Git Data API 推）', async () => {
        const size = GITHUB_MAX_FILE_BYTES + 1;
        stubRemote(size, size);

        const result = await new GitHubClient(settings).fetchRemoteImage(big, GITHUB_GIT_BLOB_MAX_BYTES);

        expect(result).toBeInstanceOf(ArrayBuffer);
    });

    it('按传入上限判定：超过 12 MiB 仍然不下载', async () => {
        const size = GITHUB_GIT_BLOB_MAX_BYTES + 1;
        const seen = stubRemote(size, size);

        const result = await new GitHubClient(settings).fetchRemoteImage(big, GITHUB_GIT_BLOB_MAX_BYTES);

        expect(result).toBe(REMOTE_IMAGE_TOO_LARGE);
        expect(seen.arrayBufferCalled).toBe(false);
    });
});

describe('GitHubClient.uploadFileViaGitData', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    type Call = { url: string; method: string; body?: any };

    /** 按 URL 片段回放 Git Data API 的正常应答，并记下每次请求 */
    function stubGitApi(opts: { refStatus?: number; patchStatus?: number } = {}) {
        const calls: Call[] = [];
        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            const href = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            calls.push({
                url: href,
                method,
                body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
            });
            const json = (data: unknown, status = 200) =>
                new Response(JSON.stringify(data), { status });

            if (href.includes('/git/ref/heads/')) {
                if (method === 'PATCH') return json({}, opts.patchStatus ?? 200);
                return opts.refStatus === 404
                    ? json({ message: 'Not Found' }, 404)
                    : json({ object: { sha: 'HEADSHA' } });
            }
            if (href.includes('/git/blobs')) return json({ sha: 'BLOBSHA' });
            if (href.includes('/git/commits/')) return json({ tree: { sha: 'TREESHA' } });
            if (href.includes('/git/trees')) return json({ sha: 'NEWTREESHA' });
            if (href.includes('/git/commits')) return json({ sha: 'NEWCOMMITS' });
            return json({ message: 'unexpected' }, 500);
        }) as typeof fetch;
        return calls;
    }

    const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 256)).buffer;

    it('按 blob→base_tree→commit→ref 的顺序走，且 ref 只快进不覆盖', async () => {
        const calls = stubGitApi();

        const ok = await new GitHubClient(settings).uploadFileViaGitData({
            path: 'media/big.png',
            content: bytes(1000),
            message: 'sync: image big',
        });

        expect(ok).toBe(true);
        expect(calls.map((c) => c.url.replace('https://api.github.com', ''))).toEqual([
            '/repos/some-user/blog-content/git/ref/heads/main',
            '/repos/some-user/blog-content/git/blobs',
            '/repos/some-user/blog-content/git/commits/HEADSHA',
            '/repos/some-user/blog-content/git/trees',
            '/repos/some-user/blog-content/git/commits',
            '/repos/some-user/blog-content/git/ref/heads/main',
        ]);
        // base_tree 让 GitHub 合并未改动部分：整仓文件不可能塞进一次请求
        expect(calls[3].body.base_tree).toBe('TREESHA');
        expect(calls[3].body.tree).toEqual([
            { path: 'media/big.png', mode: '100644', type: 'blob', sha: 'BLOBSHA' },
        ]);
        expect(calls[4].body.parents).toEqual(['HEADSHA']);
        // force:false：并发时要么干净快进、要么失败重试，绝不冲掉别人的提交
        expect(calls[5].method).toBe('PATCH');
        expect(calls[5].body).toEqual({ sha: 'NEWCOMMITS', force: false });
    });

    it('base64 分段拼接后与整体编码逐字节一致', async () => {
        const calls = stubGitApi();
        // 32766 的 2 倍 + 5：末段不是 3 的倍数，正是分段编码最容易出错的地方
        const content = bytes(32766 * 2 + 5);

        await new GitHubClient(settings).uploadFileViaGitData({
            path: 'media/x.png',
            content,
            message: 'sync: x',
        });

        const sent = calls[1].body;
        expect(sent.encoding).toBe('base64');
        expect(sent.content).toBe(Buffer.from(new Uint8Array(content)).toString('base64'));
    });

    it('超过 12 MiB 直接拒，一个请求都不发', async () => {
        const calls = stubGitApi();

        const ok = await new GitHubClient(settings).uploadFileViaGitData({
            path: 'media/huge.mp4',
            content: new ArrayBuffer(GITHUB_GIT_BLOB_MAX_BYTES + 1),
            message: 'sync: huge',
        });

        expect(ok).toBe(false);
        expect(calls).toEqual([]);
    });

    it('分支读不到（404）就不往下走', async () => {
        const calls = stubGitApi({ refStatus: 404 });

        const ok = await new GitHubClient(settings).uploadFileViaGitData({
            path: 'media/x.png',
            content: bytes(10),
            message: 'sync: x',
        });

        expect(ok).toBe(false);
        expect(calls.length).toBe(1);
    });

    it('ref 快进被拒（他人并发推进了分支）时算失败，不谎报已进仓', async () => {
        const calls = stubGitApi({ patchStatus: 422 });

        const ok = await new GitHubClient(settings).uploadFileViaGitData({
            path: 'media/x.png',
            content: bytes(10),
            message: 'sync: x',
        });

        expect(ok).toBe(false);
        expect(calls.length).toBe(6);
    });
});
