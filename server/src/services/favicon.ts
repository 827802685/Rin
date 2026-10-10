import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { path_join } from "../utils/path";
import {
    deleteStorageObjectAtKey,
    getStorageObject,
    getStoragePublicUrl,
    headStorageObject,
    putStorageObjectAtKey,
} from "../utils/storage";

// @see https://developers.cloudflare.com/images/url-format#supported-formats-and-limitations
export const FAVICON_ALLOWED_TYPES: { [key: string]: string } = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
};

export function getFaviconKey(env: Env) {
    return path_join(env.S3_FOLDER || "", "favicon.webp");
}

export function getOriginFaviconKey(env: Env, ext: string) {
    return path_join(env.S3_FOLDER || "", `originFavicon${ext}`);
}

/**
 * 清掉其它扩展名的原始图标。
 *
 * 换格式上传时只会写 `originFavicon<新扩展名>`，旧扩展名的对象不会自动消失。
 * 请求失败不该连累上传本身 —— 新原图此时已经写进去了，所以这里只记日志。
 */
async function removeStaleOriginFavicons(env: Env, keepExt: string) {
    const staleKeys = Object.values(FAVICON_ALLOWED_TYPES)
        .filter((ext) => ext !== keepExt)
        .map((ext) => getOriginFaviconKey(env, ext));

    await Promise.all(staleKeys.map(async (key) => {
        try {
            await deleteStorageObjectAtKey(env, key);
        } catch (error) {
            console.error("Error removing stale original favicon:", error);
        }
    }));
}

async function buildFaviconFromSource(c: AppContext, sourceUrl: string, faviconKey: string) {
    const env = c.get('env');
    const imageRequest = new Request(sourceUrl, {
        headers: c.req.raw.headers,
    });

    const response = await fetch(imageRequest, {
        cf: {
            image: {
                width: 144,
                height: 144,
                fit: "cover",
                format: "webp",
                quality: 100,
            },
        },
    });

    if (!response.ok) {
        return response;
    }

    const arrayBuffer = await response.arrayBuffer();
    await putStorageObjectAtKey(
        env,
        faviconKey,
        new Uint8Array(arrayBuffer),
        "image/webp",
    );

    return new Response(arrayBuffer, {
        status: 200,
        headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000",
        },
    });
}

export function FaviconService(): Hono {
    const app = new Hono();

    // GET /favicon
    app.get("/", async (c: AppContext) => {
        const env = c.get('env');
        const clientConfig = c.get('clientConfig');
        const faviconKey = getFaviconKey(env);
        
        try {
            const response = await profileAsync(c, 'favicon_fetch', () => getStorageObject(env, faviconKey));

            if (!response) {
                const avatar = await profileAsync(c, 'favicon_avatar', () => clientConfig.get("site.avatar")) as string | undefined;
                if (!avatar) {
                    c.status(404);
                    return c.text("Favicon not found");
                }

                const avatarUrl = new URL(avatar, c.req.url).toString();
                const generatedFavicon = await profileAsync(c, 'favicon_generate', () => buildFaviconFromSource(c, avatarUrl, faviconKey));
                if (!generatedFavicon.ok) {
                    c.status(generatedFavicon.status as 200 | 400 | 401 | 403 | 404 | 500);
                    return c.text(await generatedFavicon.text());
                }

                c.header("Content-Type", generatedFavicon.headers.get("Content-Type") || "image/webp");
                c.header("Cache-Control", generatedFavicon.headers.get("Cache-Control") || "public, max-age=31536000");
                return c.body(await profileAsync(c, 'favicon_generate_body', () => generatedFavicon.arrayBuffer()));
            }

            c.header("Content-Type", "image/webp");
            c.header("Cache-Control", "public, max-age=31536000");

            return c.body(await profileAsync(c, 'favicon_body', () => response.arrayBuffer()));
        } catch (error) {
            if (error instanceof Error) {
                c.status(500);
                console.error("Error fetching favicon:", error);
                return c.text(`Error fetching favicon: ${error.message}`);
            }

            c.status(500);
            console.error("Error fetching favicon:", error);
            return c.text("Error fetching favicon");
        }
    });

    // GET /favicon/original
    app.get("/original", async (c: AppContext) => {
        const env = c.get('env');
        
        try {
            // 四个扩展名的对象可能同时存在：换格式上传后旧的那份并不会被自动替换掉，
            // 按固定顺序取「第一个命中」就会一直把旧图回给浏览器（顺序是 jpg→png→gif→webp，
            // 先传 png 再传 jpg 之后，这里永远返回 png）。所以把候选全部探一遍，
            // 取 Last-Modified 最新的那份；时间戳相同的按声明顺序取第一个（sort 稳定）。
            const candidates: { mimeType: string; key: string; uploadedAt: number }[] = [];

            for (const [mimeType, ext] of Object.entries(FAVICON_ALLOWED_TYPES)) {
                const originFaviconKey = getOriginFaviconKey(env, ext);
                const head = await profileAsync(c, 'favicon_original_head', () => headStorageObject(env, originFaviconKey));

                if (!head) {
                    continue;
                }

                const modified = head.headers.get("Last-Modified");
                const parsed = modified ? Date.parse(modified) : NaN;
                candidates.push({
                    mimeType,
                    key: originFaviconKey,
                    uploadedAt: Number.isNaN(parsed) ? 0 : parsed,
                });
            }

            const latest = candidates.sort((a, b) => b.uploadedAt - a.uploadedAt)[0];

            if (!latest) {
                c.status(404);
                return c.text("Original favicon not found");
            }

            const response = await profileAsync(c, 'favicon_original_fetch', () => getStorageObject(env, latest.key));

            if (!response) {
                // HEAD 命中之后对象又被删掉了
                c.status(404);
                return c.text("Original favicon not found");
            }

            c.header("Content-Type", response.headers.get("Content-Type") || latest.mimeType);
            c.header("Cache-Control", "public, max-age=31536000");
            return c.body(await profileAsync(c, 'favicon_original_body', () => response.arrayBuffer()));
        } catch (error) {
            if (error instanceof Error) {
                c.status(500);
                console.error("Error fetching original favicon:", error);
                return c.text(`Error fetching original favicon: ${error.message}`);
            }

            c.status(500);
            console.error("Error fetching original favicon:", error);
            return c.text("Error fetching original favicon");
        }
    });

    // POST /favicon
    app.post("/", async (c: AppContext) => {
        const env = c.get('env');
        const admin = c.get('admin');
        const faviconKey = getFaviconKey(env);
        
        try {
            if (!admin) {
                c.status(403);
                return c.text("Permission denied");
            }

            const body = await profileAsync(c, 'favicon_upload_parse', () => c.req.parseBody());
            const file = body.file instanceof File ? body.file : undefined;

            if (!file) {
                c.status(400);
                return c.text("No file uploaded");
            }

            const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
            if (file.size > MAX_FILE_SIZE) {
                c.status(400);
                return c.text(`File size exceeds limit (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
            }

            if (!FAVICON_ALLOWED_TYPES[file.type]) {
                c.status(400);
                return c.text("Disallowed file type");
            }
            
            const originExt = FAVICON_ALLOWED_TYPES[file.type];
            const originFaviconKey = getOriginFaviconKey(env, originExt);

            // 原图必须带上真实的 MIME：`/favicon/original` 会直接把它回给浏览器，
            // 而 `/api/blob/<key>` 一律加 `X-Content-Type-Options: nosniff`，
            // 缺 Content-Type 时对象会被当成 octet-stream，浏览器不会当图片渲染。
            // 这里也把 File 读成 Uint8Array 再写：直接把 File/Blob 当 body 会走
            // 流式校验和，Node 运行时下会在上传前就抛错。
            const originBytes = new Uint8Array(await file.arrayBuffer());
            await profileAsync(c, 'favicon_origin_put', () => putStorageObjectAtKey(
                env,
                originFaviconKey,
                originBytes,
                file.type
            ));

            const originFaviconUrl = getStoragePublicUrl(env, originFaviconKey, new URL(c.req.url).origin);
            const imageRequest = new Request(originFaviconUrl, {
                headers: c.req.raw.headers,
            });

            const response = await profileAsync(c, 'favicon_transform_fetch', () => fetch(imageRequest, {
                cf: {
                    image: {
                        width: 144,
                        height: 144,
                        fit: "cover",
                        format: "webp",
                        quality: 100,
                    },
                },
            }));

            if (!response.ok) {
                c.status(response.status as 200 | 400 | 401 | 403 | 404 | 500);
                return c.text(await response.text());
            }

            const arrayBuffer = await profileAsync(c, 'favicon_transform_body', () => response.arrayBuffer());

            // 转换结果恒为 webp，与按需生成分支（buildFaviconFromSource）保持一致。
            await profileAsync(c, 'favicon_put', () => putStorageObjectAtKey(
                env,
                faviconKey,
                new Uint8Array(arrayBuffer),
                "image/webp"
            ));

            // 新图已经落地，此时清掉旧扩展名的原图才不会把站点图标清成 404。
            await profileAsync(c, 'favicon_origin_cleanup', () => removeStaleOriginFavicons(env, originExt));

            return c.json({ url: getStoragePublicUrl(env, faviconKey, new URL(c.req.url).origin) });
        } catch (error) {
            if (error instanceof Error) {
                c.status(500);
                console.error("Error processing favicon:", error);
                return c.text(`Error processing favicon: ${error.message}`);
            }

            c.status(500);
            console.error("Error processing favicon:", error);
            return c.text("Error processing favicon");
        }
    });

    return app;
}
