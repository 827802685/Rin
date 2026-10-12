import type { QueueTask } from "./queue";

declare global {
  interface Env {
    TASK_QUEUE?: Queue<QueueTask>;
    R2_BUCKET?: R2Bucket;
    KV_CACHE?: KVNamespace;
    
    // GitHub integration
    GITHUB_REPO_OWNER?: string;
    GITHUB_REPO_NAME?: string;
    GITHUB_REPO_BRANCH?: string;
    GITHUB_PAT?: string;
    GITHUB_CDN_BASE_URL?: string;
  }
}

export {};
