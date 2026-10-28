import { describe, it, expect } from "bun:test";
import {
    parseFrontmatter,
    slugify,
    extractHashtags,
    transformPost,
    transformBlogMarkdown,
    rewriteMediaUrls,
    collectMediaRefs,
} from "../markdown-import";

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("parseFrontmatter", () => {
    it("parses key:value pairs and strips quotes", () => {
        const raw = `---\ntitle: "网页红警"\nsummary: 网页版红警\nalias: ra2web\ndate: 2025-09-15T03:52:37.000Z\n---\n\n# body`;
        const { data, content } = parseFrontmatter(raw);
        expect(data.title).toBe("网页红警");
        expect(data.summary).toBe("网页版红警");
        expect(data.alias).toBe("ra2web");
        expect(content.startsWith("# body")).toBe(true);
    });

    it("returns empty data when no frontmatter", () => {
        const raw = "just text\n# no fm";
        const { data, content } = parseFrontmatter(raw);
        expect(data).toEqual({});
        expect(content).toBe(raw);
    });
});

describe("slugify", () => {
    it("lowercases and dashes non-alnum", () => {
        expect(slugify("Hello World!")).toBe("hello-world");
        expect(slugify("网页红警")).toBe("网页红警");
    });
});

describe("extractHashtags", () => {
    it("extracts #tags and ignores code blocks", () => {
        const content = "intro #rust #rust-lang\n```\n#notatag\n```\nend #go";
        const tags = extractHashtags(content);
        expect(tags).toContain("rust");
        expect(tags).toContain("rust-lang");
        expect(tags).toContain("go");
        expect(tags).not.toContain("notatag");
    });
});

describe("transformPost", () => {
    it("derives title/summary/tags/cover/slug from frontmatter + body", () => {
        const raw = `---\nid: 3\ntitle: 网页红警\nsummary: 网页版红警\nalias: ra2web\ndate: 2025-09-15T03:52:37.000Z\n---\n\n![](https://gh.zjkl0330.dpdns.org/827802685/blog-markdown/raw/main/media/ABC.png#blurhash=x&width=1&height=2)\n\n# Github托管页面\n\n聊聊 #cloudflare 部署`;
        const feed = transformPost("posts/2025/09/ra2web.md", raw, NOW);
        expect(feed.title).toBe("网页红警");
        expect(feed.summary).toBe("网页版红警");
        expect(feed.alias).toBe("ra2web");
        expect(feed.slug).toBe("ra2web");
        expect(feed.tags).toContain("cloudflare");
        expect(feed.cover).toContain("media/ABC.png");
        expect(feed.createdAt.getUTCFullYear()).toBe(2025);
    });

    it("falls back to filename title and path date when no frontmatter", () => {
        const feed = transformPost(
            "blog/贪吃蛇.md",
            "正文内容 #game",
            NOW,
        );
        expect(feed.title).toBe("贪吃蛇");
        expect(feed.tags).toContain("game");
    });
});

describe("transformBlogMarkdown", () => {
    it("maps posts/moments and ignores openlist/media", () => {
        const files: Record<string, string> = {
            "posts/2025/08/a.md": "---\ntitle: A\ndate: 2025-08-01T00:00:00.000Z\n---\nbody #x",
            "blog/about.md": "# 关于\n内容",
            "moments/2025/09/moment-1.md": "---\nid: 1\ndate: 2025-09-16T13:28:13.000Z\n---\n# 检讨\n正文",
            "media/ABC.png": "binary",
            "openlist/hello.md": "自定义内容",
        };
        const res = transformBlogMarkdown(files, NOW);
        expect(res.feeds.length).toBe(2); // posts + blog
        expect(res.moments.length).toBe(1);
        expect(res.feeds.map((f) => f.title).sort()).toEqual(["A", "关于"]);
        expect(res.skipped.length).toBe(0);
    });

    it("collects media refs from feed contents", () => {
        const content =
            "![](https://gh.zjkl0330.dpdns.org/827802685/blog-markdown/raw/main/media/KEY1.png)";
        const refs = collectMediaRefs(content);
        expect(refs).toEqual(["KEY1"]);
    });
});

describe("rewriteMediaUrls", () => {
    it("rewrites blog-markdown media urls via callback", () => {
        const content =
            "![](https://gh.zjkl0330.dpdns.org/827802685/blog-markdown/raw/main/media/KEY1.png#blurhash=x)";
        const out = rewriteMediaUrls(content, (key, ext) => `/r2/${key}.${ext}`);
        expect(out).toContain("/r2/KEY1.png");
        expect(out).not.toContain("gh.zjkl0330");
    });
});
