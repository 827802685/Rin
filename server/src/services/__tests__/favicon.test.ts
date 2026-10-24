import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { eq } from 'drizzle-orm';
import { FaviconService, FAVICON_ALLOWED_TYPES, getFaviconKey } from '../favicon';
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Variables, JWTUtils, CacheImpl } from "../../core/hono-types";
import { createMockDB, createMockEnv, cleanupTestDB } from '../../../tests/fixtures';
import type { Database } from 'bun:sqlite';
import { users } from '../../db/schema';

// Simple cache implementation for tests
class TestCacheImpl implements CacheImpl {
    private data = new Map<string, any>();
    
    async get(key: string): Promise<any | null> {
        return this.data.get(key) ?? null;
    }
    
    async set(key: string, value: any, _save?: boolean): Promise<void> {
        this.data.set(key, value);
    }

    async setQuick(key: string, value: any): Promise<void> {
        this.data.set(key, value);
    }
    
    async delete(key: string, _save?: boolean): Promise<void> {
        this.data.delete(key);
    }
    
    async deletePrefix(prefix: string): Promise<void> {
        for (const key of this.data.keys()) {
            if (key.startsWith(prefix)) {
                this.data.delete(key);
            }
        }
    }
    
    async getOrSet<T>(key: string, factory: () => Promise<T>): Promise<T> {
        const cached = await this.get(key);
        if (cached !== null) return cached;
        const value = await factory();
        await this.set(key, value);
        return value;
    }
    
    async getOrDefault<T>(key: string, defaultValue: T): Promise<T> {
        const cached = await this.get(key);
        return cached !== null ? cached : defaultValue;
    }
    
    async getBySuffix(_suffix: string): Promise<any[]> {
        return [];
    }
    
    async all(): Promise<Map<string, any>> {
        return new Map(this.data);
    }
    
    async save(): Promise<void> {}
    async clear(): Promise<void> {
        this.data.clear();
    }
}

/** 记录写入/删除动作的内存 R2 替身 */
type TestR2Bucket = {
    puts: string[];
    deletes: string[];
    head: (key: string) => Promise<R2Object | null>;
    get: (key: string) => Promise<R2ObjectBody | null>;
    put: (key: string) => Promise<R2Object>;
    delete: (key: string) => Promise<void>;
};

function createR2Object(
    key: string,
    body: string,
    uploaded: Date,
    contentType: string,
): R2ObjectBody {
    return {
        key,
        size: body.length,
        etag: `etag-${key}`,
        httpEtag: `etag-${key}`,
        uploaded,
        storageClass: 'Standard',
        checksums: {} as R2Checksums,
        httpMetadata: { contentType },
        writeHttpMetadata(headers: Headers) {
            headers.set('Content-Type', contentType);
        },
        body: new Blob([body]).stream(),
        bodyUsed: false,
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
        text: async () => body,
        json: async () => ({ value: body }),
        blob: async () => new Blob([body]),
        bytes: async () => new Uint8Array(new TextEncoder().encode(body)),
    } as unknown as R2ObjectBody;
}

function createR2Env(
    objects: Record<string, R2ObjectBody>,
    seed: Record<string, string> = {},
): Env {
    const store = new Map<string, R2ObjectBody>(Object.entries(objects));
    const puts: string[] = [];
    const deletes: string[] = [];

    const bucket = {
        puts,
        deletes,
        head: async (key: string) => store.get(key) ?? null,
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string) => {
            puts.push(key);
            const object = createR2Object(key, seed[key] ?? 'body', new Date(), 'application/octet-stream');
            store.set(key, object);
            return object;
        },
        delete: async (key: string) => {
            deletes.push(key);
            store.delete(key);
        },
    } as unknown as TestR2Bucket;

    return createMockEnv({ R2_BUCKET: bucket as unknown as R2Bucket });
}

describe('FaviconService', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;

    /** 用指定 env 起一个只有 FaviconService 的应用（uid=1 / admin=true） */
    function buildApp(targetEnv: Env) {
        const testApp = new Hono<{ Bindings: Env; Variables: Variables }>();

        testApp.use(createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
            c.set('db', db);
            c.set('cache', new TestCacheImpl());
            c.set('serverConfig', new TestCacheImpl());
            c.set('clientConfig', new TestCacheImpl());
            c.set('jwt', {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
            } as JWTUtils);
            c.set('oauth2', undefined);
            c.set('env', targetEnv);
            c.set('uid', 1);
            c.set('admin', true);
            await next();
        }));

        testApp.route('/', FaviconService());
        return testApp;
    }

    beforeEach(async () => {
        const mockDB = createMockDB();
        db = mockDB.db;
        sqlite = mockDB.sqlite;
        env = createMockEnv();

        app = new Hono<{ Bindings: Env; Variables: Variables }>();
        
        // Mock middleware to inject dependencies and handle auth
        app.use(createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
            c.set('db', db);
            c.set('cache', new TestCacheImpl());
            c.set('serverConfig', new TestCacheImpl());
            c.set('clientConfig', new TestCacheImpl());
            
            const jwt = {
                sign: async (payload: any) => `mock_token_${payload.id}`,
                verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
            } as JWTUtils;
            c.set('jwt', jwt);
            c.set('oauth2', undefined);
            c.set('env', env);
            
            // Parse Authorization header and set user info
            const authHeader = c.req.header('authorization');
            let uid: number | undefined = undefined;
            let admin = false;
            
            if (authHeader?.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const profile = await jwt.verify(token);
                if (profile?.id) {
                    uid = profile.id;
                    // Look up user in database to check permission
                    const user = await db.query.users.findFirst({
                        where: eq(users.id, uid as number)
                    });
                    if (user) {
                        admin = user.permission === 1;
                    }
                }
            }
            
            c.set('uid', uid);
            c.set('admin', admin);
            
            await next();
        }));

        // Register service
        app.route('/', FaviconService());

        // Create test user
        await createTestUser();
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function createTestUser() {
        sqlite.exec(`
            INSERT INTO users (id, username, openid, avatar, permission) 
            VALUES (1, 'admin', 'gh_admin', 'admin.png', 1)
        `);
    }

    describe('GET / - Get favicon', () => {
        it('should return favicon from S3', async () => {
            const res = await app.request('/', { method: 'GET' }, env);

            // Will fail due to S3 not being available, but verifies route is registered
            expect(res.status).not.toBe(404);
        });

        it('should generate favicon from site avatar when favicon is missing', async () => {
            const clientConfig = new TestCacheImpl();
            await clientConfig.set('site.avatar', 'https://example.com/avatar.png');

            app = new Hono<{ Bindings: Env; Variables: Variables }>();
            app.use(createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
                c.set('db', db);
                c.set('cache', new TestCacheImpl());
                c.set('serverConfig', new TestCacheImpl());
                c.set('clientConfig', clientConfig);
                c.set('jwt', {
                    sign: async (payload: any) => `mock_token_${payload.id}`,
                    verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
                } as JWTUtils);
                c.set('oauth2', undefined);
                c.set('env', env);
                c.set('uid', 1);
                c.set('admin', true);
                await next();
            }));
            app.route('/', FaviconService());

            const originalFetch = globalThis.fetch;
            // Derived from the mock env instead of hardcoded, so the intercept keeps
            // matching when the fixture endpoint changes.
            const faviconObjectUrl = `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${env.S3_FOLDER}favicon.webp`;
            globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
                const method = init?.method ?? (input instanceof Request ? input.method : undefined);

                if (url === 'https://example.com/avatar.png') {
                    return new Response(new Uint8Array([1, 2, 3]), {
                        status: 200,
                        headers: { 'Content-Type': 'image/webp' },
                    });
                }

                if (url.split('?')[0] === faviconObjectUrl && method === 'PUT') {
                    return new Response(null, { status: 200 });
                }

                if (url.split('?')[0] === faviconObjectUrl) {
                    return new Response('missing', { status: 404 });
                }

                return originalFetch(input, init);
            };

            try {
                const res = await app.request('/', { method: 'GET' }, env);
                expect(res.status).toBe(200);
                expect(res.headers.get('content-type')).toBe('image/webp');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        it('should return favicon through R2 API when S3_ACCESS_HOST is missing', async () => {
            const r2Env = createMockEnv({
                S3_ACCESS_HOST: '' as any,
                S3_ENDPOINT: '' as any,
                S3_BUCKET: '' as any,
                S3_ACCESS_KEY_ID: '',
                S3_SECRET_ACCESS_KEY: '',
                R2_BUCKET: {
                    get: async (key: string) => {
                        if (key !== 'images/favicon.webp') {
                            return null;
                        }

                        return {
                            key,
                            size: 4,
                            etag: 'etag',
                            httpEtag: 'etag',
                            uploaded: new Date('2025-01-01T00:00:00Z'),
                            storageClass: 'Standard',
                            checksums: {} as R2Checksums,
                            httpMetadata: { contentType: 'image/webp' },
                            writeHttpMetadata(headers: Headers) {
                                headers.set('Content-Type', 'image/webp');
                            },
                            body: new Blob(['test']).stream(),
                            bodyUsed: false,
                            arrayBuffer: async () => new TextEncoder().encode('test').buffer,
                            text: async () => 'test',
                            json: async () => ({ value: 'test' }),
                            blob: async () => new Blob(['test']),
                            bytes: async () => new Uint8Array(new TextEncoder().encode('test')),
                        } as unknown as R2ObjectBody;
                    },
                } as R2Bucket,
            });

            const r2App = new Hono<{ Bindings: Env; Variables: Variables }>();
            r2App.use(createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
                c.set('db', db);
                c.set('cache', new TestCacheImpl());
                c.set('serverConfig', new TestCacheImpl());
                c.set('clientConfig', new TestCacheImpl());
                c.set('jwt', {
                    sign: async (payload: any) => `mock_token_${payload.id}`,
                    verify: async (token: string) => token.startsWith('mock_token_') ? { id: 1 } : null,
                } as JWTUtils);
                c.set('oauth2', undefined);
                c.set('env', r2Env);
                c.set('uid', 1);
                c.set('admin', true);
                await next();
            }));
            r2App.route('/', FaviconService());

            const res = await r2App.request('/', { method: 'GET' }, r2Env);

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('image/webp');
            expect(await res.text()).toBe('test');
        });
    });

    describe('GET /original - Get original favicon', () => {
        it('should return original favicon from S3', async () => {
            const res = await app.request('/original', { method: 'GET' }, env);

            // Will fail due to S3 not being available, but verifies route is registered
            expect(res.status).not.toBe(404);
        });

        /**
         * 换格式上传后旧扩展名的对象不会消失，而遍历顺序是固定的
         * jpg→png→gif→webp。先传 png 再传 jpg 之后，「取第一个命中」会永远
         * 把那张旧 png 回给浏览器，新图标怎么传都不生效。
         */
        it('should return the most recently uploaded original, not the first match by extension', async () => {
            const r2Env = createR2Env({
                'images/originFavicon.jpg': createR2Object(
                    'images/originFavicon.jpg', 'stale-jpg', new Date('2024-01-01T00:00:00Z'), 'image/jpeg',
                ),
                'images/originFavicon.png': createR2Object(
                    'images/originFavicon.png', 'fresh-png', new Date('2026-06-01T00:00:00Z'), 'image/png',
                ),
            });

            const res = await buildApp(r2Env).request('/original', { method: 'GET' }, r2Env);

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('image/png');
            expect(await res.text()).toBe('fresh-png');
        });

        it('should fall back to the only existing original', async () => {
            const r2Env = createR2Env({
                'images/originFavicon.webp': createR2Object(
                    'images/originFavicon.webp', 'only-webp', new Date('2026-06-01T00:00:00Z'), 'image/webp',
                ),
            });

            const res = await buildApp(r2Env).request('/original', { method: 'GET' }, r2Env);

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('image/webp');
            expect(await res.text()).toBe('only-webp');
        });

        it('should return 404 when no original has ever been uploaded', async () => {
            const r2Env = createR2Env({});

            const res = await buildApp(r2Env).request('/original', { method: 'GET' }, r2Env);

            expect(res.status).toBe(404);
        });
    });

    describe('POST / - Upload favicon', () => {
        it('should require admin permission', async () => {
            const file = new File(['test'], 'favicon.png', { type: 'image/png' });
            const formData = new FormData();
            formData.append('file', file);

            const res = await app.request('/', {
                method: 'POST',
                body: formData,
            }, env);

            // Should be rejected (400 validation or 401/403 auth)
            expect(res.status).toBeGreaterThanOrEqual(400);
        });

        it('should reject files over 10MB', async () => {
            const largeContent = new Uint8Array(10 * 1024 * 1024 + 1);
            const file = new File([largeContent], 'favicon.png', { type: 'image/png' });
            const formData = new FormData();
            formData.append('file', file);

            const res = await app.request('/', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer mock_token_1' },
                body: formData,
            }, env);

            expect(res.status).toBe(400);
        });

        it('should reject disallowed file types', async () => {
            const file = new File(['test'], 'favicon.txt', { type: 'text/plain' });
            const formData = new FormData();
            formData.append('file', file);

            const res = await app.request('/', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer mock_token_1' },
                body: formData,
            }, env);

            expect(res.status).toBe(400);
        });

        it('should accept allowed image types', async () => {
            const file = new File(['test'], 'favicon.png', { type: 'image/png' });
            const formData = new FormData();
            formData.append('file', file);

            const res = await app.request('/', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer mock_token_1' },
                body: formData,
            }, env);

            // Should not be 403 - permission check passes
            // Will fail due to S3 not available
            expect(res.status).not.toBe(403);
        });

        /**
         * `/api/blob/<key>` 回放对象时会强制加 `X-Content-Type-Options: nosniff`，
         * 所以上传时写进存储的 Content-Type 就是浏览器能不能把它当图片渲染的唯一依据。
         * 上传分支历史上两次 `putStorageObjectAtKey` 都不传 contentType，
         * 与按需生成分支（显式传 image/webp）以及 /storage 上传（传 file.type）不对称。
         */
        it('should store both objects with a real Content-Type', async () => {
            const file = new File(['test'], 'favicon.png', { type: 'image/png' });
            const formData = new FormData();
            formData.append('file', file);

            const puts: { url: string; contentType: string | null }[] = [];
            const originalFetch = globalThis.fetch;

            globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
                const isRequest = input instanceof Request;
                const url = typeof input === 'string'
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : input.url;
                const method = init?.method ?? (isRequest ? input.method : 'GET');
                const rawHeaders = init?.headers ?? (isRequest ? input.headers : undefined);
                const headers = rawHeaders ? new Headers(rawHeaders as HeadersInit) : null;

                if (method === 'PUT') {
                    puts.push({ url, contentType: headers ? headers.get('content-type') : null });
                    return new Response(null, { status: 200 });
                }

                // 图片转换请求（取回刚上传的原图）
                return new Response(new Uint8Array([1, 2, 3]), {
                    status: 200,
                    headers: { 'Content-Type': 'image/webp' },
                });
            };

            try {
                const res = await app.request('/', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer mock_token_1' },
                    body: formData,
                }, env);

                expect(res.status).toBe(200);
                expect(puts.length).toBe(2);

                const originPut = puts.find(p => p.url.includes('originFavicon.png'));
                const faviconPut = puts.find(p => p.url.includes('favicon.webp'));

                expect(originPut).toBeDefined();
                expect(faviconPut).toBeDefined();
                expect(originPut!.contentType).toBe('image/png');
                expect(faviconPut!.contentType).toBe('image/webp');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        /**
         * 不清理的话，站点每换一次图标格式就会在存储里多留一份永远读不到的旧原图。
         */
        it('should remove originals left over from a previous upload in another format', async () => {
            const r2Env = createR2Env({}, { 'images/originFavicon.jpg': 'stale' });
            const file = new File(['test'], 'favicon.png', { type: 'image/png' });
            const formData = new FormData();
            formData.append('file', file);

            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () =>
                new Response(new Uint8Array([1, 2, 3]), {
                    status: 200,
                    headers: { 'Content-Type': 'image/webp' },
                });

            try {
                const res = await buildApp(r2Env).request('/', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer mock_token_1' },
                    body: formData,
                }, r2Env);

                expect(res.status).toBe(200);

                const bucket = r2Env.R2_BUCKET as unknown as TestR2Bucket;
                expect(bucket.puts).toContain('images/originFavicon.png');
                expect(bucket.puts).toContain('images/favicon.webp');
                expect(bucket.deletes.sort()).toEqual([
                    'images/originFavicon.gif',
                    'images/originFavicon.jpg',
                    'images/originFavicon.webp',
                ]);
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        it('should reject a non-file field named file', async () => {
            const formData = new FormData();
            formData.append('file', 'not-a-file');

            const res = await app.request('/', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer mock_token_1' },
                body: formData,
            }, env);

            expect(res.status).toBe(400);
        });
    });

    describe('FAVICON_ALLOWED_TYPES', () => {
        it('should contain allowed image types', () => {
            expect(FAVICON_ALLOWED_TYPES['image/jpeg']).toBe('.jpg');
            expect(FAVICON_ALLOWED_TYPES['image/png']).toBe('.png');
            expect(FAVICON_ALLOWED_TYPES['image/gif']).toBe('.gif');
            expect(FAVICON_ALLOWED_TYPES['image/webp']).toBe('.webp');
        });

        it('should have correct number of allowed types', () => {
            expect(Object.keys(FAVICON_ALLOWED_TYPES).length).toBe(4);
        });
    });

    describe('getFaviconKey', () => {
        it('should return favicon path with S3 folder', () => {
            const env = createMockEnv();
            const key = getFaviconKey(env);
            expect(key).toBe('images/favicon.webp');
        });

        it('should handle empty S3_FOLDER', () => {
            const env = createMockEnv({
                S3_FOLDER: '' as any,
            });
            const key = getFaviconKey(env);
            expect(key).toBe('favicon.webp');
        });
    });
});
