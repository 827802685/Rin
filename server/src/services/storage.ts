import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { getStorageObject, putStorageObject } from "../utils/storage";

function buf2hex(buffer: ArrayBuffer) {
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Upload ceiling for the image upload endpoint. Mirrors
 * `DEFAULT_IMAGE_MAX_FILE_SIZE` on the client so the server enforces the same
 * contract instead of trusting a check that can be skipped with a raw request.
 */
export const MAX_IMAGE_UPLOAD_SIZE = 5 * 1024 * 1024;

/** Content types the upload endpoint accepts, matching `isImageFile` on the client. */
function isImageUpload(file: File) {
    // `File.type` may carry parameters, e.g. `image/png;charset=utf-8`.
    return file.type.split(';')[0]!.trim().startsWith('image/');
}

/**
 * Objects are replayed to the browser from the same origin as the app, with the
 * content type that was supplied at upload time. Anything scriptable therefore
 * has to be served inert.
 */
const BLOB_SAFETY_HEADERS: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
};

export function StorageService(): Hono {
    const app = new Hono();

    // POST /storage
    app.post('/', async (c: AppContext) => {
        const uid = c.get('uid');
        const env = c.get('env');
        
        const body = await profileAsync(c, 'storage_parse', () => c.req.parseBody());
        const rawKey = typeof body.key === 'string' && body.key.length > 0 ? body.key : undefined;
        const file = body.file instanceof File ? body.file : undefined;
        
        if (!uid) {
            return c.text('Unauthorized', 401);
        }

        if (!file) {
            return c.text('No file uploaded', 400);
        }

        if (file.size > MAX_IMAGE_UPLOAD_SIZE) {
            return c.text(`File size exceeds limit (${MAX_IMAGE_UPLOAD_SIZE / 1024 / 1024}MB)`, 400);
        }

        // The stored content type is replayed verbatim by the blob route, so
        // accepting arbitrary types here would turn object storage into a
        // same-origin XSS sink.
        if (!isImageUpload(file)) {
            return c.text('Disallowed file type', 400);
        }

        const nameForSuffix = rawKey ?? file.name ?? '';
        const suffix = nameForSuffix.includes(".") ? nameForSuffix.split('.').pop() ?? '' : "";
        const fileBuffer = await profileAsync(c, 'storage_file_buffer', () => file.arrayBuffer());
        const hashArray = await profileAsync(c, 'storage_hash', () => crypto.subtle.digest(
            { name: 'SHA-1' },
            fileBuffer
        ));
        const hash = buf2hex(hashArray);
        const hashkey = suffix ? `${hash}.${suffix}` : hash;
        
        try {
            const result = await profileAsync(c, 'storage_put', () => putStorageObject(env, hashkey, new Uint8Array(fileBuffer), file.type, new URL(c.req.url).origin));
            return c.json({ url: result.url });
        } catch (e: any) {
            console.error(e.message);
            const status = e.message?.includes('is not defined') ? 500 : 400;
            return c.text(e.message, status);
        }
    });

    return app;
}

export function BlobService(): Hono {
    const app = new Hono();

    app.get("/*", async (c: AppContext) => {
        const env = c.get("env");
        const key = c.req.path.replace(/^\/blob\/?/, "");

        if (!key) {
            return c.text("Blob key is required", 400);
        }

        try {
            const response = await profileAsync(c, "blob_fetch", () => getStorageObject(env, decodeURIComponent(key)));

            if (!response) {
                return c.text("Not found", 404);
            }

            const headers = new Headers(response.headers);
            for (const [name, value] of Object.entries(BLOB_SAFETY_HEADERS)) {
                headers.set(name, value);
            }

            return new Response(response.body, {
                status: response.status,
                headers,
            });
        } catch (error) {
            console.error("Blob fetch failed:", error);
            return c.text("Blob fetch failed", 500);
        }
    });

    return app;
}
