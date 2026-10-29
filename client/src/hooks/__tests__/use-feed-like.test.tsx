import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { likedStorageKey, useFeedLike } from "../use-feed-like";

function createStorage() {
    const store = new Map<string, string>();
    return {
        store,
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

describe("useFeedLike", () => {
    it("连点两次只发一次请求", async () => {
        const pending = deferred<{ data: { likes: number } }>();
        const like = vi.fn(() => pending.promise);
        const storage = createStorage();

        const { result } = renderHook(() =>
            useFeedLike({ storageId: 7, feedId: 7, like, storage }),
        );

        await act(async () => {
            void result.current.like();
            void result.current.like();
        });

        expect(like).toHaveBeenCalledTimes(1);

        await act(async () => {
            pending.resolve({ data: { likes: 5 } });
            await pending.promise;
        });

        expect(result.current.likes).toBe(5);
        expect(result.current.liked).toBe(true);
    });

    it("已点赞的文章不会再发请求", async () => {
        const storage = createStorage();
        storage.setItem(likedStorageKey(7), "1");
        const like = vi.fn();

        const { result } = renderHook(() =>
            useFeedLike({ storageId: 7, feedId: 7, like, storage }),
        );

        await waitFor(() => expect(result.current.liked).toBe(true));

        await act(async () => {
            await result.current.like();
        });

        expect(like).not.toHaveBeenCalled();
    });

    it("成功后用路由 id（可以是 alias）写本地标记，接口用文章 id", async () => {
        const storage = createStorage();
        const like = vi.fn().mockResolvedValue({ data: { likes: 4 } });

        const { result } = renderHook(() =>
            useFeedLike({ storageId: "hello-world", feedId: 12, like, storage }),
        );

        await act(async () => {
            await result.current.like();
        });

        expect(like).toHaveBeenCalledWith(12);
        expect(storage.getItem(likedStorageKey("hello-world"))).toBe("1");
        expect(storage.getItem(likedStorageKey(12))).toBeNull();
        expect(result.current.likes).toBe(4);
    });

    it("hydrate 用服务端计数覆盖本地值", async () => {
        const { result } = renderHook(() =>
            useFeedLike({ storageId: 1, feedId: 1, like: vi.fn(), storage: createStorage() }),
        );

        act(() => {
            result.current.hydrate(9);
        });

        expect(result.current.likes).toBe(9);

        act(() => {
            result.current.hydrate(undefined);
        });

        expect(result.current.likes).toBe(0);
    });

    it("文章还没加载完（feedId 为空）时不发请求", async () => {
        const like = vi.fn();

        const { result } = renderHook(() =>
            useFeedLike({ storageId: "draft", feedId: undefined, like, storage: createStorage() }),
        );

        await act(async () => {
            await result.current.like();
        });

        expect(like).not.toHaveBeenCalled();
    });

    it("失败时回调错误、不写本地标记，并允许重试", async () => {
        const storage = createStorage();
        const onError = vi.fn();
        const like = vi
            .fn()
            .mockResolvedValueOnce({ error: { value: "boom", status: 500 } })
            .mockResolvedValueOnce({ data: { likes: 2 } });

        const { result } = renderHook(() =>
            useFeedLike({ storageId: 3, feedId: 3, like, onError, storage }),
        );

        await act(async () => {
            await result.current.like();
        });

        expect(onError).toHaveBeenCalledWith({ value: "boom", status: 500 });
        expect(storage.getItem(likedStorageKey(3))).toBeNull();
        expect(result.current.liked).toBe(false);

        await act(async () => {
            await result.current.like();
        });

        expect(like).toHaveBeenCalledTimes(2);
        expect(result.current.liked).toBe(true);
        expect(storage.getItem(likedStorageKey(3))).toBe("1");
    });

    it("切换文章时重新读取本地标记", async () => {
        const storage = createStorage();
        storage.setItem(likedStorageKey("second"), "1");

        const { result, rerender } = renderHook(
            ({ storageId }: { storageId: string }) =>
                useFeedLike({ storageId, feedId: 1, like: vi.fn(), storage }),
            { initialProps: { storageId: "first" } },
        );

        expect(result.current.liked).toBe(false);

        rerender({ storageId: "second" });

        await waitFor(() => expect(result.current.liked).toBe(true));
    });
});
