import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 文章点赞状态。
 *
 * 关键点：`liked` 是 React state，要等请求返回才更新，所以「连点两次」时第二次
 * 点击读到的仍是 `liked === false`，会给同一个访客记两次赞。这里用一个 ref 做
 * 在途请求去重（ref 同步生效，不经过渲染），并在成功后同步写 ref，保证同一次
 * 会话里不会重复提交。
 */

export const LIKED_STORAGE_PREFIX = "rin_liked_";

export function likedStorageKey(id: number | string): string {
    return `${LIKED_STORAGE_PREFIX}${id}`;
}

export interface FeedLikeResponse {
    data?: { likes?: number } | null;
    error?: unknown;
}

export interface UseFeedLikeOptions {
    /** 页面路由 id（点赞去重的 localStorage 键用它，可以是文章 alias）。 */
    storageId: number | string | undefined;
    /** 真正发给接口的文章 id；文章未加载完成前为 undefined。 */
    feedId?: number | string;
    like: (id: number | string) => Promise<FeedLikeResponse>;
    onError?: (error: unknown) => void;
    /** 可注入的存储实现，默认 `localStorage`（测试用）。 */
    storage?: Pick<Storage, "getItem" | "setItem">;
}

export interface UseFeedLikeResult {
    likes: number;
    liked: boolean;
    /** 文章详情加载完成后用服务端计数覆盖本地值。 */
    hydrate: (count?: number | null) => void;
    like: () => Promise<void>;
}

function resolveStorage(storage?: Pick<Storage, "getItem" | "setItem">) {
    if (storage) return storage;
    if (typeof localStorage === "undefined") return undefined;
    return localStorage;
}

export function useFeedLike({
    storageId,
    feedId,
    like,
    onError,
    storage,
}: UseFeedLikeOptions): UseFeedLikeResult {
    const [likes, setLikes] = useState(0);
    const [liked, setLiked] = useState(false);

    const inFlight = useRef(false);
    const likedRef = useRef(false);

    const getStorage = useCallback(() => resolveStorage(storage), [storage]);

    // 切换文章时重新读取本地标记；同时清掉上一篇残留的在途状态。
    useEffect(() => {
        const store = getStorage();
        const alreadyLiked =
            storageId !== undefined && store?.getItem(likedStorageKey(storageId)) === "1";

        likedRef.current = Boolean(alreadyLiked);
        setLiked(Boolean(alreadyLiked));
        inFlight.current = false;
    }, [storageId, getStorage]);

    const hydrate = useCallback((count?: number | null) => {
        setLikes(typeof count === "number" ? count : 0);
    }, []);

    const likeOnce = useCallback(async () => {
        if (feedId === undefined || feedId === null) return;
        // 连点保护：请求还没回来时直接忽略后续点击。
        if (inFlight.current || likedRef.current) return;

        inFlight.current = true;
        try {
            const response = await like(feedId);

            if (response?.error) {
                onError?.(response.error);
                return;
            }

            const next = response?.data?.likes;
            setLikes((prev) => (typeof next === "number" ? next : prev + 1));

            likedRef.current = true;
            setLiked(true);

            if (storageId !== undefined) {
                getStorage()?.setItem(likedStorageKey(storageId), "1");
            }
        } catch (error) {
            onError?.(error);
        } finally {
            inFlight.current = false;
        }
    }, [feedId, getStorage, like, onError, storageId]);

    return { likes, liked, hydrate, like: likeOnce };
}
