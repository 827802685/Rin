import { describe, expect, it } from "bun:test";
import type { S3Client } from "@aws-sdk/client-s3";
import { deleteObject, getObject, headObject, putObject } from "../s3";

/**
 * The commands are constructed inside the helpers, so the interesting part is
 * what ends up on `command.input`. A stub `send` records that instead of
 * round-tripping a real HTTP request (which would drag in retries, signing and
 * the sandbox's reachability of whichever endpoint is configured).
 */
function fakeClient(handler: (command: any) => unknown) {
    return {
        send: async (command: any) => handler(command),
    } as unknown as S3Client;
}

function recordingClient(result: unknown = {}) {
    const seen: { command?: any } = {};
    const client = fakeClient((command) => {
        seen.command = command;
        return result;
    });

    // Returned as a holder rather than the command itself: the command only
    // exists after the call under test has run.
    return { client, seen };
}

const env = {
    S3_BUCKET: "rin-test",
    S3_ENDPOINT: "https://s3.example.com",
    S3_REGION: "auto",
    S3_ACCESS_KEY_ID: "ak",
    S3_SECRET_ACCESS_KEY: "sk",
} as unknown as Env;

function streamOf(text: string) {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
        },
    });
}

describe("putObject > body normalization", () => {
    it("passes strings through unchanged", async () => {
        const { client, seen } = recordingClient({});
        await putObject(client, env, "a/b.txt", "hello");

        expect(seen.command!.input.Body).toBe("hello");
    });

    it("passes Uint8Array through unchanged", async () => {
        const body = new Uint8Array([1, 2, 3]);
        const { client, seen } = recordingClient({});
        await putObject(client, env, "a/b.bin", body);

        expect(seen.command!.input.Body).toBe(body);
    });

    it("wraps an ArrayBuffer into a Uint8Array view", async () => {
        const buffer = new Uint8Array([9, 8, 7]).buffer;
        const { client, seen } = recordingClient({});
        await putObject(client, env, "a/b.bin", buffer);

        expect(seen.command!.input.Body).toBeInstanceOf(Uint8Array);
        expect([...(seen.command!.input.Body as Uint8Array)]).toEqual([9, 8, 7]);
    });

    it("buffers a Blob so the SDK never hashes a flowing stream", async () => {
        // File/Blob are accepted by the type but go down the streaming path:
        // the checksum middleware throws "Unable to calculate hash for flowing
        // readable stream" before the request leaves the process. This is the
        // regression guard for that.
        const blob = new Blob([new Uint8Array([4, 5, 6])], { type: "image/webp" });
        const { client, seen } = recordingClient({});
        await putObject(client, env, "a/b.webp", blob);

        expect(seen.command!.input.Body).toBeInstanceOf(Uint8Array);
        expect(seen.command!.input.Body).not.toBeInstanceOf(Blob);
        expect([...(seen.command!.input.Body as Uint8Array)]).toEqual([4, 5, 6]);
    });

    it("buffers a File the same way", async () => {
        const file = new File([new Uint8Array([7, 7, 7])], "avatar.png", { type: "image/png" });
        const { client, seen } = recordingClient({});
        await putObject(client, env, "a/avatar.png", file);

        expect(seen.command!.input.Body).toBeInstanceOf(Uint8Array);
        expect([...(seen.command!.input.Body as Uint8Array)]).toEqual([7, 7, 7]);
    });

    it("keeps an empty Blob working (avoids hashing a zero-length stream)", async () => {
        const { client, seen } = recordingClient({});
        await putObject(client, env, "a/empty.bin", new Blob([]));

        expect(seen.command!.input.Body).toBeInstanceOf(Uint8Array);
        expect((seen.command!.input.Body as Uint8Array).byteLength).toBe(0);
    });

    it("carries the bucket, key and content type onto the command", async () => {
        const { client, seen } = recordingClient({});
        await putObject(client, env, "rin/cache/rss.xml", "<rss />", "application/xml");

        expect(seen.command!.input.Bucket).toBe("rin-test");
        expect(seen.command!.input.Key).toBe("rin/cache/rss.xml");
        expect(seen.command!.input.ContentType).toBe("application/xml");
    });
});

describe("getObject", () => {
    it("maps the S3 metadata onto the response", async () => {
        const lastModified = new Date("2026-10-01T00:00:00Z");
        const client = fakeClient(() => ({
            ContentType: "image/webp",
            ETag: '"abc"',
            ContentLength: 12,
            LastModified: lastModified,
            Body: streamOf("hello there "),
        }));

        const response = await getObject(client, env, "favicon.webp");

        expect(response).not.toBeNull();
        expect(response!.status).toBe(200);
        expect(response!.headers.get("Content-Type")).toBe("image/webp");
        expect(response!.headers.get("ETag")).toBe('"abc"');
        expect(response!.headers.get("Content-Length")).toBe("12");
        expect(response!.headers.get("Last-Modified")).toBe(lastModified.toUTCString());
        expect(await response!.text()).toBe("hello there ");
    });

    it("omits headers the backend did not report", async () => {
        const client = fakeClient(() => ({}));
        const response = await getObject(client, env, "x.bin");

        expect(response!.headers.get("Content-Type")).toBeNull();
        expect(response!.headers.get("ETag")).toBeNull();
    });

    it("returns null for a missing object (NoSuchKey)", async () => {
        // Only the error name carries the signal here. Adding the 404 status as
        // well would let either branch of `isNotFoundError` mask a regression
        // in the other one.
        const client = fakeClient(() => {
            throw { name: "NoSuchKey" };
        });

        expect(await getObject(client, env, "missing.webp")).toBeNull();
    });

    it("returns null when the error is named NotFound", async () => {
        const client = fakeClient(() => {
            throw { name: "NotFound" };
        });

        expect(await getObject(client, env, "missing.webp")).toBeNull();
    });

    it("returns null when only the status code says 404", async () => {
        const client = fakeClient(() => {
            throw { $metadata: { httpStatusCode: 404 } };
        });

        expect(await getObject(client, env, "missing.webp")).toBeNull();
    });

    it("does not swallow genuine failures", async () => {
        const client = fakeClient(() => {
            throw { name: "InternalError", $metadata: { httpStatusCode: 500 } };
        });

        expect(getObject(client, env, "boom.bin")).rejects.toBeTruthy();
    });

    it("does not swallow non-object throws", async () => {
        const client = fakeClient(() => {
            throw "network down";
        });

        expect(getObject(client, env, "boom.bin")).rejects.toBe("network down");
    });
});

describe("headObject", () => {
    it("returns metadata without a body", async () => {
        const client = fakeClient(() => ({
            ContentType: "application/json",
            ETag: '"z"',
            ContentLength: 2,
            LastModified: new Date("2026-10-01T00:00:00Z"),
        }));

        const response = await headObject(client, env, "cache.json");

        expect(response).not.toBeNull();
        expect(await response!.text()).toBe("");
        expect(response!.headers.get("Content-Length")).toBe("2");
    });

    it("returns null for a missing object", async () => {
        const client = fakeClient(() => {
            throw { name: "NotFound", $metadata: { httpStatusCode: 404 } };
        });

        expect(await headObject(client, env, "missing")).toBeNull();
    });

    it("propagates non-404 failures", async () => {
        const client = fakeClient(() => {
            throw { name: "AccessDenied", $metadata: { httpStatusCode: 403 } };
        });

        expect(headObject(client, env, "secret")).rejects.toBeTruthy();
    });
});

describe("deleteObject", () => {
    it("targets the configured bucket and key", async () => {
        const { client, seen } = recordingClient({});
        await deleteObject(client, env, "rin/originFavicon.png");

        expect(seen.command!.input.Bucket).toBe("rin-test");
        expect(seen.command!.input.Key).toBe("rin/originFavicon.png");
    });
});
