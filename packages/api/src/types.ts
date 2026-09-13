// ============================================================================
// Shared API Types - Used by both client and server
// ============================================================================

// Common types
export interface ApiResponse<T> {
  data?: T;
  error?: {
    status: number;
    value: string;
  };
}

export interface RequestOptions {
  headers?: Record<string, string>;
}

// ============================================================================
// Feed Types
// ============================================================================

export interface Feed {
  id: number;
  title: string | null;
  content: string;
  uid: number;
  createdAt: string;
  updatedAt: string;
  ai_summary: string;
  ai_summary_status: "idle" | "pending" | "processing" | "completed" | "failed";
  ai_summary_error: string;
  hashtags: Array<{ id: number; name: string }>;
  user: {
    avatar: string | null;
    id: number;
    username: string;
  };
  pv: number;
  uv: number;
  top?: number;
}

export interface FeedListResponse {
  size: number;
  data: Array<{
    id: number;
    title: string | null;
    summary: string;
    hashtags: Array<{ id: number; name: string }>;
    user: {
      avatar: string | null;
      id: number;
      username: string;
    };
    avatar: string | null;
    createdAt: string;
    updatedAt: string;
    pv: number;
    uv: number;
  }>;
  hasNext: boolean;
}

export interface TimelineItem {
  id: number;
  title: string | null;
  createdAt: string;
}

export interface CreateFeedRequest {
  title: string;
  content: string;
  summary?: string;
  alias?: string;
  draft: boolean;
  listed: boolean;
  createdAt?: string;
  tags: string[];
}

export interface UpdateFeedRequest {
  title?: string;
  content?: string;
  summary?: string;
  alias?: string;
  listed: boolean;
  draft?: boolean;
  createdAt?: string;
  tags?: string[];
  top?: number;
}

export interface AdjacentFeed {
  id: number;
  title: string | null;
  summary: string;
  hashtags: Array<{ id: number; name: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AdjacentFeedResponse {
  previousFeed: AdjacentFeed | null;
  nextFeed: AdjacentFeed | null;
}

// ============================================================================
// User Types
// ============================================================================

export interface UserProfile {
  id: number;
  username: string;
  avatar: string | null;
  permission: boolean;
}

export interface UpdateProfileRequest {
  username?: string;
  avatar?: string | null;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface AuthStatus {
  github: boolean;
  password: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  token?: string;
  user: UserProfile;
}

// ============================================================================
// Tag Types
// ============================================================================

export interface Tag {
  id: number;
  name: string;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface TagDetail extends Tag {
  feeds: Feed[];
}

// ============================================================================
// Comment Types
// ============================================================================

export interface Comment {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  /** 登录用户的评论 */
  user?: {
    id: number;
    username: string;
    avatar: string | null;
    permission: number | null;
  } | null;
  /** 游客评论的昵称 */
  guestName?: string;
  /** 游客评论的邮箱 */
  guestEmail?: string;
  /** 游客评论的网站 */
  guestWebsite?: string;
  /** 审核状态 */
  approved: boolean;
}

export interface CreateCommentRequest {
  content: string;
  /** 游客昵称（未登录时必填） */
  guestName?: string;
  /** 游客邮箱（可选） */
  guestEmail?: string;
  /** 游客网站（可选） */
  guestWebsite?: string;
}

// ============================================================================
// Friend Types
// ============================================================================

export interface Friend {
  id: number;
  name: string;
  desc: string | null;
  avatar: string;
  url: string;
  accepted: number;
  sort_order: number | null;
  createdAt: string;
  uid: number;
  updatedAt: string;
  health: string;
}

export interface FriendListResponse {
  friend_list: Friend[];
  apply_list: Friend | null;
}

export interface CreateFriendRequest {
  name: string;
  desc: string;
  avatar: string;
  url: string;
}

export interface UpdateFriendRequest {
  name?: string;
  desc?: string;
  avatar?: string;
  url?: string;
  accepted?: number;
  sort_order?: number;
}

// ============================================================================
// Moment Types
// ============================================================================

export interface Moment {
  id: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: number;
    username: string;
    avatar: string;
  };
}

export interface CreateMomentRequest {
  content: string;
}

export interface MomentListResponse {
  data: Moment[];
  hasNext: boolean;
}

// ============================================================================
// Config Types
// ============================================================================

export type ConfigType = 'client' | 'server';

export interface ConfigResponse {
  [key: string]: any;
}

// ============================================================================
// AI Config Types
// ============================================================================

export interface AIConfig {
  enabled: boolean;
  provider: string;
  model: string;
  api_key: string;
  api_url: string;
}

// ============================================================================
// AI Chat Types
// ============================================================================

export type AIChatRole = "system" | "user" | "assistant";

export interface AIChatMessage {
  role: AIChatRole;
  content: string;
}

export interface AIChatRequest {
  messages: AIChatMessage[];
}

export interface AIChatResponse {
  content: string;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface UploadResponse {
  url: string;
}

// ============================================================================
// Search Types
// ============================================================================

// Uses FeedListResponse

// ============================================================================
// WordPress Import Types
// ============================================================================

export interface WordPressImportResponse {
  success: number;
  skipped: number;
  skippedList: Array<{ title: string; reason: string }>;
}

// ============================================================================
// API Endpoint Paths
// ============================================================================

export const API_PATHS = {
  // Feed
  FEED_LIST: '/api/feed',
  FEED_TIMELINE: '/api/feed/timeline',
  FEED_GET: (id: number | string) => `/api/feed/${id}`,
  FEED_CREATE: '/api/feed',
  FEED_UPDATE: (id: number | string) => `/api/feed/${id}`,
  FEED_DELETE: (id: number | string) => `/api/feed/${id}`,
  FEED_ADJACENT: (id: number | string) => `/api/feed/adjacent/${id}`,
  FEED_SET_TOP: (id: number | string) => `/api/feed/top/${id}`,

  // Search
  SEARCH: (keyword: string) => `/api/search/${encodeURIComponent(keyword)}`,

  // WordPress import
  WP_IMPORT: '/api/wp',

  // Auth
  AUTH_STATUS: '/api/auth/status',
  AUTH_LOGIN: '/api/auth/login',

  // User
  USER_PROFILE: '/api/user/profile',
  USER_UPDATE_PROFILE: '/api/user/profile',
  USER_LOGOUT: '/api/user/logout',
  USER_GITHUB: '/api/user/github',
  USER_GITHUB_CALLBACK: '/api/user/github/callback',

  // Tag
  TAG_LIST: '/api/tag',
  TAG_GET: (name: string) => `/api/tag/${encodeURIComponent(name)}`,

  // Comment
  COMMENT_LIST: (feedId: number | string) => `/api/comment/${feedId}`,
  COMMENT_CREATE: (feedId: number | string) => `/api/comment/${feedId}`,
  COMMENT_DELETE: (id: number | string) => `/api/comment/${id}`,

  // Friend
  FRIEND_LIST: '/api/friend',
  FRIEND_CREATE: '/api/friend',
  FRIEND_UPDATE: (id: number | string) => `/api/friend/${id}`,
  FRIEND_DELETE: (id: number | string) => `/api/friend/${id}`,

  // Moments
  MOMENTS_LIST: '/api/moments',
  MOMENTS_CREATE: '/api/moments',
  MOMENTS_UPDATE: (id: number | string) => `/api/moments/${id}`,
  MOMENTS_DELETE: (id: number | string) => `/api/moments/${id}`,

  // Config (AI settings live under the `server` config type)
  CONFIG_GET: (type: ConfigType) => `/api/config/${type}`,
  CONFIG_UPDATE: (type: ConfigType) => `/api/config/${type}`,
  CONFIG_HEALTH: '/api/config/health',
  CONFIG_QUEUE_STATUS: '/api/config/queue-status',
  CONFIG_QUEUE_RETRY: (id: number | string) => `/api/config/queue-status/${id}/retry`,
  CONFIG_QUEUE_DELETE: (id: number | string) => `/api/config/queue-status/${id}`,
  CONFIG_COMPAT_TASKS: '/api/config/compat-tasks',
  CONFIG_COMPAT_AI_SUMMARY: '/api/config/compat-tasks/ai-summary',
  CONFIG_COMPAT_BLURHASH: '/api/config/compat-tasks/blurhash',
  CONFIG_COMPAT_BLURHASH_FILL: (id: number | string) => `/api/config/compat-tasks/blurhash/${id}`,
  CONFIG_TEST_AI: '/api/config/test-ai',
  CONFIG_TEST_WEBHOOK: '/api/config/test-webhook',
  CONFIG_CLEAR_CACHE: '/api/config/cache',

  // Client bootstrap script
  CONFIG_BOOTSTRAP_JS: '/api/config/client/bootstrap.js',

  // AI Chat
  AI_CHAT: '/api/ai/chat',

  // Storage
  STORAGE_UPLOAD: '/api/storage',
  BLOB_GET: (key: string) => `/api/blob/${key}`,

  // Favicon (also served at the site root by the favicon routes)
  FAVICON_GET: '/api/favicon',
  FAVICON_GET_ORIGINAL: '/api/favicon/original',
  FAVICON_UPLOAD: '/api/favicon',

  // RSS-like feeds are served from the site root, not under /api
  RSS_GET: (name: string) => `/${encodeURIComponent(name)}`,
} as const;

/**
 * Well known routes served from the site root instead of under `/api`.
 * Kept here so clients and tests share one source of truth.
 */
export const ROOT_PATHS = {
  RSS_XML: '/rss.xml',
  ATOM_XML: '/atom.xml',
  RSS_JSON: '/rss.json',
  FEED_JSON: '/feed.json',
  FEED_XML: '/feed.xml',
  FAVICON: '/favicon',
  FAVICON_ICO: '/favicon.ico',
  FAVICON_ORIGINAL: '/favicon/original',
  SITEMAP_XML: '/sitemap.xml',
  ROBOTS_TXT: '/robots.txt',
} as const;

export type APIEndpoint = typeof API_PATHS;
