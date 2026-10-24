import { eq, and, like } from "drizzle-orm";
import type { DB } from "../core/hono-types";
import { cache } from "../db/schema";
import { path_join } from "./path";
import { getStorageObject, putStorageObjectAtKey } from "./storage";

// Cache Utils for storing data in memory and persisting to database (with optional S3 backup)

export type CacheStorageMode = 'database' | 's3';

type CacheConfigReader = {
    getOrDefault<T>(key: string, defaultValue: T): Promise<T>;
};

function normalizeCacheEnabled(value: unknown) {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") {
            return true;
        }
        if (normalized === "false") {
            return false;
        }
    }

    if (typeof value === "number") {
        return value !== 0;
    }

    return Boolean(value);
}

export async function isPublicCacheEnabled(clientConfig: CacheConfigReader) {
    const value = await clientConfig.getOrDefault("cache.enabled", false);
    return normalizeCacheEnabled(value);
}

// 存储提供者接口
interface StorageProvider {
    load(): Promise<void>;
    save(): Promise<void>;
    /** 只落这一个键，其余键不碰 */
    upsert(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}

// 数据库存储提供者
class DatabaseStorageProvider implements StorageProvider {
    constructor(private db: DB, private cacheMap: Map<string, any>, private type: string) {}

    async load(): Promise<void> {
        console.log('Cache load from database', this.type);
        try {
            const rows = await this.db.select().from(cache).where(eq(cache.type, this.type));
            for (const row of rows) {
                try {
                    this.cacheMap.set(row.key, JSON.parse(row.value));
                } catch (e) {
                    this.cacheMap.set(row.key, row.value);
                }
            }
            console.log(`Cache loaded ${rows.length} entries from database`);
        } catch (e: any) {
            console.error('Cache load from database failed');
            console.error(e.message);
        }
    }

    async save(): Promise<void> {
        // Get all existing keys from database for this cache type
        const existingRows = await this.db.select({ key: cache.key }).from(cache).where(eq(cache.type, this.type));
        const existingKeys = new Set(existingRows.map((row: { key: string }) => row.key));
        const currentKeys = new Set(this.cacheMap.keys());

        // Delete keys from database that are no longer in memory
        for (const key of existingKeys) {
            if (!currentKeys.has(key)) {
                await this.db.delete(cache)
                    .where(and(eq(cache.key, key), eq(cache.type, this.type)));
                console.log('Cache removed from database:', key);
            }
        }

        // Save or update current cache entries
        for (const [key, value] of this.cacheMap.entries()) {
            if (value === undefined) {
                console.warn(`Cache: Skipping undefined value for key "${key}"`);
                continue;
            }

            const valueStr = typeof value === 'string' ? value : JSON.stringify(value);

            if (existingKeys.has(key)) {
                await this.db.update(cache)
                    .set({ value: valueStr, updatedAt: new Date() })
                    .where(and(eq(cache.key, key), eq(cache.type, this.type)));
            } else {
                await this.db.insert(cache).values({
                    key,
                    value: valueStr,
                    type: this.type,
                });
            }
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await this.db.delete(cache)
                .where(and(eq(cache.key, key), eq(cache.type, this.type)));
            console.log('Cache deleted from database:', key);
        } catch (e: any) {
            console.error('Cache delete from database failed');
            console.error(e.message);
        }
    }

    /**
     * 单行 upsert。`save()` 会为本 type 的**每个**键各发一次 D1 写（线上 14 个键实测一次
     * 全表重刷约 1.5 秒），循环里的高频写入用它会直接把墙钟预算吃光。
     */
    async upsert(key: string, value: any): Promise<void> {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        await this.db.insert(cache)
            .values({ key, value: valueStr, type: this.type })
            .onConflictDoUpdate({
                target: [cache.key, cache.type],
                set: { value: valueStr, updatedAt: new Date() },
            });
    }

    async clear(): Promise<void> {
        try {
            await this.db.delete(cache).where(eq(cache.type, this.type));
            console.log('Cache cleared from database');
        } catch (e: any) {
            console.error('Cache clear from database failed');
            console.error(e.message);
        }
    }
}

// S3 存储提供者
class S3StorageProvider implements StorageProvider {
    private cacheKey: string;

    constructor(private env: Env, private cacheMap: Map<string, any>, private type: string) {
        this.cacheKey = path_join(this.env.S3_CACHE_FOLDER || 'cache', `${type}.json`);
    }

    async load(): Promise<void> {
        console.log('Cache load from storage', this.cacheKey);
        try {
            const response = await getStorageObject(this.env, this.cacheKey);
            if (!response) {
                console.log('Cache file not found in storage, starting with empty cache');
                return;
            }
            const data = await response.json<any>();
            for (let key in data) {
                this.cacheMap.set(key, data[key]);
            }
        } catch (e: any) {
            console.error('Cache load from S3 failed');
            console.error(e.message);
        }
    }

    async save(): Promise<void> {
        try {
            await putStorageObjectAtKey(
                this.env,
                this.cacheKey,
                JSON.stringify(Object.fromEntries(this.cacheMap)),
                'application/json'
            ).then(() => {
                console.log('Cache saved to storage');
            }).catch((e: any) => {
                console.error('Cache save to storage failed');
                console.error(e.message);
            });
        } catch (e: any) {
            console.error('Cache save to storage failed');
            console.error(e.message);
        }
    }

    async delete(): Promise<void> {
        await this.save();
    }

    async clear(): Promise<void> {
        await this.save();
    }

    /** 单个对象存储没有「只改一个键」的写法，只能覆盖整份 JSON */
    async upsert(): Promise<void> {
        await this.save();
    }
}

// KV 存储提供者（高速缓存层）
class KVStorageProvider implements StorageProvider {
    constructor(private env: Env, private cacheMap: Map<string, any>, private type: string) {}

    private getCacheKey(key: string): string {
        return `cache:${this.type}:${key}`;
    }

    async load(): Promise<void> {
        if (!this.env.KV_CACHE) {
            console.warn('KV_CACHE binding not available, falling back to database');
            return;
        }

        console.log('Cache load from KV namespace');
        try {
            // KV doesn't have list API in workers, so we start with empty cache
            // and populate on-demand via getOrSet
            console.log('KV cache initialized (lazy loading mode)');
        } catch (e: any) {
            console.error('Cache load from KV failed');
            console.error(e.message);
        }
    }

    async save(): Promise<void> {
        // KV saves individual keys, not bulk
        // This is called for compatibility but actual saves happen in set/delete
    }

    async upsert(key: string, value: any): Promise<void> {
        await this.set(key, value);
    }

    async delete(key: string): Promise<void> {
        if (!this.env.KV_CACHE) return;
        
        try {
            await this.env.KV_CACHE.delete(this.getCacheKey(key));
            console.log('Cache deleted from KV:', key);
        } catch (e: any) {
            console.error('Cache delete from KV failed');
            console.error(e.message);
        }
    }

    async clear(): Promise<void> {
        // KV doesn't have bulk delete, would need to track all keys
        console.warn('KV cache clear not fully supported (no bulk delete)');
    }

    async get(key: string): Promise<any> {
        if (!this.env.KV_CACHE) return undefined;
        
        try {
            const value = await this.env.KV_CACHE.get(this.getCacheKey(key), 'json');
            return value;
        } catch (e: any) {
            console.error('Cache get from KV failed');
            console.error(e.message);
            return undefined;
        }
    }

    async set(key: string, value: any): Promise<void> {
        if (!this.env.KV_CACHE) return;
        
        try {
            await this.env.KV_CACHE.put(this.getCacheKey(key), JSON.stringify(value));
        } catch (e: any) {
            console.error('Cache set to KV failed');
            console.error(e.message);
        }
    }
}

export class CacheImpl {
    cache: Map<string, any> = new Map<string, any>();
    db: DB;
    env: Env;
    type: string;
    loaded: boolean = false;
    private storageProvider: StorageProvider;
    private kvProvider?: KVStorageProvider;
    // 只用于避免「每次读都回写一次 KV」：同一实例内一个键最多修一次
    private kvReconciled: Set<string> = new Set<string>();
    private cacheEnabled: Promise<boolean> | null = null;
    private configReader?: CacheConfigReader;

    constructor(
        db: DB,
        env: Env,
        type: string = "cache",
        storageMode?: CacheStorageMode,
        configReader?: CacheConfigReader,
    ) {
        // 确保 type 不为空，防止不同类型共享同一个存储位置
        if (!type || type.trim() === '') {
            throw new Error('Cache type cannot be empty');
        }
        this.type = type;
        this.db = db;
        this.env = env;
        this.cache = new Map<string, any>();
        this.configReader = configReader;

        // 优先级：参数 > 环境变量，默认为 s3 以向前兼容
        const mode = storageMode ?? (env.CACHE_STORAGE_MODE as CacheStorageMode) ?? 's3';

        // 根据存储模式创建对应的提供者
        if (mode === 's3') {
            this.storageProvider = new S3StorageProvider(env, this.cache, type);
        } else {
            this.storageProvider = new DatabaseStorageProvider(db, this.cache, type);
        }

        // 如果 KV_CACHE 绑定可用，创建 KV 提供者作为高速缓存层
        if (env.KV_CACHE) {
            this.kvProvider = new KVStorageProvider(env, this.cache, type);
            console.log(`KV cache enabled for type: ${type}`);
        }
    }

    private async isEnabled() {
        // Only the public content cache is gated by `cache.enabled`.
        // Config stores must stay readable, otherwise `cache -> client.config`
        // would recurse back into the same gate and break initialization.
        if (this.type !== "cache") {
            return true;
        }

        if (!this.configReader) {
            return true;
        }

        if (!this.cacheEnabled) {
            this.cacheEnabled = isPublicCacheEnabled(this.configReader);
        }

        return this.cacheEnabled;
    }

    async load() {
        await this.storageProvider.load();
        this.loaded = true;
    }

    async all() {
        if (!(await this.isEnabled())) {
            return new Map<string, any>();
        }
        if (!this.loaded) {
            await this.load();
        }
        return this.cache;
    }

    async get(key: string) {
        if (!(await this.isEnabled())) {
            return null;
        }

        // Try KV cache first (fast path)
        if (this.kvProvider) {
            const kvValue = await this.kvProvider.get(key);
            // null 不算命中：KV 里躺着 null，多半是持久层被直接改过（手工 SQL、
            // 迁移、回滚）留下的陈旧值。把它当命中会让真实配置永久读不到，
            // 而调用方看到 null 只会以为「没配置」。
            if (kvValue !== undefined && kvValue !== null) {
                console.log('Cache hit (KV)', key);
                this.cache.set(key, kvValue);
                return kvValue;
            }

            // 回落前不修 KV：真实 KV 里「键不存在」和「存了 null」都返回 null，
            // 无法区分，所以每个键只自愈一次，否则每次 miss 都变成一次 KV 写。
            if (!this.kvReconciled.has(key)) {
                this.kvReconciled.add(key);
                if (!this.loaded) {
                    await this.load();
                }
                const persisted = this.cache.get(key);
                if (persisted !== undefined) {
                    await this.kvProvider.set(key, persisted);
                    return persisted;
                }
                await this.kvProvider.delete(key);
            }
        }

        // Fallback to persistent storage
        if (!this.loaded) {
            await this.load();
        }
        return this.cache.get(key);
    }

    async getByPrefix(prefix: string): Promise<any[]> {
        if (!(await this.isEnabled())) {
            return [];
        }
        if (!this.loaded) {
            await this.load();
        }
        const result = [];
        for (let key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                result.push(this.cache.get(key));
            }
        }
        return result;
    }

    async getBySuffix(suffix: string): Promise<any[]> {
        if (!(await this.isEnabled())) {
            return [];
        }
        if (!this.loaded) {
            await this.load();
        }
        const result = [];
        for (let key of this.cache.keys()) {
            if (key.endsWith(suffix)) {
                result.push(this.cache.get(key));
            }
        }
        return result;
    }

    async getOrSet<T>(key: string, value: () => Promise<T>) {
        if (!(await this.isEnabled())) {
            return value();
        }
        const cached = await this.get(key);
        if (cached !== undefined) {
            console.log('Cache hit', key);
            return cached as T;
        }
        console.log('Cache miss', key);
        const newValue = await value();
        await this.set(key, newValue);
        return newValue;
    }

    async getOrDefault<T>(key: string, defaultValue: T) {
        if (!(await this.isEnabled())) {
            return defaultValue;
        }
        return this.getOrSet(key, async () => defaultValue);
    }

    async set(key: string, value: any, save: boolean = true) {
        if (!(await this.isEnabled())) {
            return;
        }
        if (!this.loaded)
            await this.load();
        
        // Update in-memory cache
        this.cache.set(key, value);
        
        // Write to KV (fast path) if available
        if (this.kvProvider) {
            await this.kvProvider.set(key, value);
        }
        
        // Persist to database/S3 (slow path)
        if (save) {
            await this.save();
        }
    }

    /**
     * 与 `set` 同义，但只落这一个键。`set` 走的是 `save()` 全表重刷 —— 对本 type 每个键
     * 各发一次 D1 写，线上 server.config 有 14 个键，实测一次 set 约 1.5 秒。
     * 任何「循环里写配置」的代码都应该用这个，否则光写入就能把整轮请求拖过切断线。
     */
    async setQuick(key: string, value: any): Promise<void> {
        if (!(await this.isEnabled())) {
            return;
        }
        if (!this.loaded)
            await this.load();

        this.cache.set(key, value);

        if (this.kvProvider) {
            await this.kvProvider.upsert(key, value);
        }

        await this.storageProvider.upsert(key, value);
    }

    async delete(key: string, save: boolean = true) {
        if (!this.loaded)
            await this.load();
        this.cache.delete(key);
        
        // Delete from KV if available
        if (this.kvProvider) {
            await this.kvProvider.delete(key);
        }
        
        if (save) {
            await this.storageProvider.delete(key);
        }
    }

    async deletePrefix(prefix: string) {
        for (let key of this.cache.keys()) {
            console.log('Cache key', key);
            if (key.startsWith(prefix)) {
                console.log('Cache delete', key);
                await this.delete(key, false);
            }
        }
        await this.save();
    }

    async deleteSuffix(suffix: string) {
        for (let key of this.cache.keys()) {
            console.log("Cache key", key);
            if (key.endsWith(suffix)) {
                console.log("Cache delete", key);
                await this.delete(key, false);
            }
        }
        await this.save();
    }

    async clear() {
        this.cache.clear();
        await this.storageProvider.clear();
    }

    async save() {
        await this.storageProvider.save();
    }

    // Migration helper: Load from S3 and save to database
    async migrateFromS3ToDatabase() {
        console.log('Migrating cache from S3 to database...');
        const s3Provider = new S3StorageProvider(this.env, this.cache, this.type);
        await s3Provider.load();
        const dbProvider = new DatabaseStorageProvider(this.db, this.cache, this.type);
        await dbProvider.save();
        console.log('Migration completed');
    }
}

// Factory functions to create cache instances with context
export function createPublicCache(db: DB, env: Env, storageMode?: CacheStorageMode) {
    return new CacheImpl(db, env, "cache", storageMode);
}

export function createServerConfig(db: DB, env: Env, storageMode?: CacheStorageMode) {
    return new CacheImpl(db, env, "server.config", storageMode);
}

export function createClientConfig(db: DB, env: Env, storageMode?: CacheStorageMode) {
    return new CacheImpl(db, env, "client.config", storageMode);
}
