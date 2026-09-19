import { describe, expect, it } from "vitest";
import {
    attachImageMetadataToUrl,
    buildMarkdownImage,
    isImageFile,
    parseImageUrlMetadata,
    stripImageUrlMetadata,
} from "../image-upload";

function fileOf(type: string) {
    return new File(["x"], "a.png", { type });
}

describe("isImageFile", () => {
    it("accepts image mime types", () => {
        expect(isImageFile(fileOf("image/png"))).toBe(true);
        expect(isImageFile(fileOf("image/jpeg"))).toBe(true);
    });

    it("rejects everything else", () => {
        expect(isImageFile(fileOf("application/pdf"))).toBe(false);
        expect(isImageFile(fileOf("text/plain"))).toBe(false);
    });
});

describe("attachImageMetadataToUrl", () => {
    it("returns the url untouched when there is no metadata", () => {
        expect(attachImageMetadataToUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
        expect(attachImageMetadataToUrl("https://example.com/a.png", {})).toBe("https://example.com/a.png");
    });

    it("appends the metadata as a fragment", () => {
        const result = attachImageMetadataToUrl("https://example.com/a.png", {
            blurhash: "abc123",
            width: 800,
            height: 600,
        });

        expect(result).toContain("blurhash=abc123");
        expect(result).toContain("width=800");
        expect(result).toContain("height=600");
        expect(result.startsWith("https://example.com/a.png#")).toBe(true);
    });

    it("round-trips through parseImageUrlMetadata", () => {
        const metadata = { blurhash: "xyz", width: 100, height: 50 };
        const parsed = parseImageUrlMetadata(attachImageMetadataToUrl("https://example.com/a.png", metadata));

        expect(parsed.src).toBe("https://example.com/a.png");
        expect(parsed.blurhash).toBe("xyz");
        expect(parsed.width).toBe(100);
        expect(parsed.height).toBe(50);
    });

    it("merges into an existing fragment instead of adding a second one", () => {
        const result = attachImageMetadataToUrl("https://example.com/a.png#old=1", { blurhash: "new" });

        // Only one '#' — a second fragment would corrupt the URL.
        expect(result.split("#").length).toBe(2);
        // Existing fragment data is preserved rather than silently dropped.
        expect(result).toContain("old=1");
        expect(result).toContain("blurhash=new");
    });
});

describe("parseImageUrlMetadata", () => {
    it("handles empty input", () => {
        expect(parseImageUrlMetadata("")).toEqual({ src: "", blurhash: undefined });
        expect(parseImageUrlMetadata(null).src).toBe("");
        expect(parseImageUrlMetadata(undefined).src).toBe("");
    });

    it("returns no metadata for a plain url", () => {
        const parsed = parseImageUrlMetadata("https://example.com/a.png");

        expect(parsed.src).toBe("https://example.com/a.png");
        expect(parsed.blurhash).toBeUndefined();
        expect(parsed.width).toBeUndefined();
    });

    it("ignores non positive dimensions", () => {
        const parsed = parseImageUrlMetadata("https://example.com/a.png#width=0&height=-4");

        expect(parsed.width).toBeUndefined();
        expect(parsed.height).toBeUndefined();
    });
});

describe("stripImageUrlMetadata", () => {
    it("drops the metadata fragment", () => {
        expect(stripImageUrlMetadata("https://example.com/a.png#blurhash=abc")).toBe("https://example.com/a.png");
    });

    it("leaves a plain url alone", () => {
        expect(stripImageUrlMetadata("https://example.com/a.png")).toBe("https://example.com/a.png");
    });

    it("handles empty input", () => {
        expect(stripImageUrlMetadata(null)).toBe("");
        expect(stripImageUrlMetadata(undefined)).toBe("");
    });
});

describe("buildMarkdownImage", () => {
    it("builds an image tag", () => {
        expect(buildMarkdownImage("photo", "https://example.com/a.png")).toBe(
            "![photo](https://example.com/a.png)\n",
        );
    });

    it("strips square brackets from the file name", () => {
        expect(buildMarkdownImage("a[1].png", "https://example.com/a.png")).toContain("![a1.png]");
    });

    it("escapes spaces in the url", () => {
        expect(buildMarkdownImage("a b", "https://example.com/a b.png")).toContain(
            "https://example.com/a%20b.png",
        );
    });

    it("keeps the metadata fragment", () => {
        const markdown = buildMarkdownImage("a.png", "https://example.com/a.png", { width: 10 });

        expect(markdown).toContain("width=10");
    });

    it("keeps parentheses in names and urls", () => {
        // `截图(1).png` is a very common file name. CommonMark accepts balanced
        // parentheses inside a link destination, so they must survive as-is.
        expect(buildMarkdownImage("shot(1).png", "https://example.com/shot(1).png")).toBe(
            "![shot(1).png](https://example.com/shot(1).png)\n",
        );
    });
});
