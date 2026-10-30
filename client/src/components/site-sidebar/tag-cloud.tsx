import { Link } from "wouter";

export interface TagItem {
  id: number;
  name: string;
  feeds: number;
}

const MAX_TAGS = 14;

export function TagCloud({ tags, title }: { tags: TagItem[]; title?: string }) {
  const visible = tags
    .filter((tag) => tag.feeds > 0)
    .sort((a, b) => b.feeds - a.feeds)
    .slice(0, MAX_TAGS);

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="border-card">
      {title && <p className="text-base font-bold t-primary">{title}</p>}
      <div className="flex flex-wrap gap-2">
        {visible.map((tag) => (
          <Link
            key={tag.id}
            href={`/hashtag/${encodeURIComponent(tag.name)}`}
            className="rounded-full bg-secondary px-3 py-1 text-sm t-secondary bg-button rin-glass-pill"
          >
            #{tag.name}
            <span className="ml-1 text-xs t-muted">{tag.feeds}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
