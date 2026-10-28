import type { RinApp } from "./app-types";
import { AIService } from "../services/ai";
import { PasswordAuthService } from "../services/auth";
import { CommentService } from "../services/comments";
import { ConfigService } from "../services/config";
import { FaviconService } from "../services/favicon";
import { FeedService, SearchService, WordPressService } from "../services/feed";
import { FriendService } from "../services/friends";
import { GitHubService } from "../services/github";
import { MomentsService } from "../services/moments";
import { RSSService } from "../services/rss";
import { SEOService } from "../services/seo";
import { BlobService, StorageService } from "../services/storage";
import { TagService } from "../services/tag";
import { UserService } from "../services/user";
import { MarkdownImportService } from "../services/markdown-import";
import { TaxonomyService } from "../services/taxonomy";
import { BacklinksService } from "../services/backlinks";

export function registerRoutes(app: RinApp) {
  app.get("/", (c) => c.text("Hi"));

  app.route("/feed", FeedService());
  app.route("/search", SearchService());
  app.route("/wp", WordPressService());
  app.route("/tag", TagService());
  app.route("/comment", CommentService());
  app.route("/storage", StorageService());
  app.route("/blob", BlobService());
  app.route("/friend", FriendService());
  app.route("/moments", MomentsService());
  app.route("/user", UserService());
  app.route("/auth", PasswordAuthService());
  app.route("/ai", AIService());
  app.route("/config", ConfigService());
  app.route("/github", GitHubService());
  app.route("/", RSSService());
  app.route("/", SEOService());
  app.route("/favicon", FaviconService());
  app.route("/favicon.ico", FaviconService());

  // P0 blog-markdown 导入器 + 内容组织（分类/相关/反链）
  app.route("/import", MarkdownImportService());
  app.route("/taxonomy", TaxonomyService());
  app.route("/backlinks", BacklinksService());
}
