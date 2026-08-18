import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientConfigContext } from "../../state/config";

export type PlayerTrack = {
  name: string;
  artist?: string;
  url: string;
  cover?: string;
};

function parseTracks(raw: unknown): PlayerTrack[] {
  if (typeof raw !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is PlayerTrack =>
        item && typeof item === "object" && typeof (item as PlayerTrack).url === "string",
    );
  } catch {
    return [];
  }
}

type MetingQuery = {
  server?: string;
  type?: string;
  id?: string;
};

// 从 meting 服务拉取歌单/搜索结果，返回可直接播放的曲目列表。
// meting 的 playlist/search 响应每项已自带带鉴权的 url/pic/lrc。
async function fetchMetingTracks(apiBase: string, query: MetingQuery): Promise<PlayerTrack[]> {
  const params = new URLSearchParams({
    server: query.server || "netease",
    type: query.type || "playlist",
    id: query.id || "",
  });
  const response = await fetch(`${apiBase.replace(/\/+$/, "")}/api?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Meting API ${response.status}`);
  }
  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) {
    return [];
  }
  return data.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as { title?: unknown; author?: unknown; url?: unknown; pic?: unknown };
    if (typeof record.title !== "string" || typeof record.url !== "string") {
      return [];
    }
    const author = Array.isArray(record.author)
      ? record.author.join(" / ")
      : typeof record.author === "string"
        ? record.author
        : undefined;
    return [
      {
        name: record.title,
        artist: author,
        url: record.url,
        cover: typeof record.pic === "string" ? record.pic : undefined,
      },
    ];
  });
}

function formatTime(seconds: number) {
  const rounded = Math.floor(Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export function MusicPlayer() {
  const config = useContext(ClientConfigContext);
  const { t } = useTranslation();
  const [staticTracks] = useState<PlayerTrack[]>(() => parseTracks(config.get("widget.player.audio")));
  const [metingTracks, setMetingTracks] = useState<PlayerTrack[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume] = useState(() => {
    const saved = Number(localStorage.getItem("rin.player.volume"));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.8;
  });
  const [collapsed, setCollapsed] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const didAutoSelectRef = useRef(false);

  const enabled = config.getBoolean("widget.player.enabled");
  const autoplay = config.getBoolean("widget.player.autoplay");
  const metingApi = String(config.get("widget.player.meting_api") ?? "").trim();
  const metingQueryRaw = config.get("widget.player.meting");
  const metingQueryKey = typeof metingQueryRaw === "object" ? JSON.stringify(metingQueryRaw) : String(metingQueryRaw ?? "");
  const metingQuery: MetingQuery | null = (() => {
    if (!metingQueryRaw) {
      return null;
    }
    // 兼容对象与 JSON 字符串两种存储格式
    if (typeof metingQueryRaw === "object") {
      return metingQueryRaw as MetingQuery;
    }
    try {
      const parsed = JSON.parse(String(metingQueryRaw));
      if (parsed && typeof parsed === "object") {
        return parsed as MetingQuery;
      }
    } catch {
      // ignore malformed config
    }
    return null;
  })();

  // fetch meting tracks once when enabled and api+query are configured
  useEffect(() => {
    if (!enabled || !metingApi || !metingQuery) {
      return;
    }
    let cancelled = false;
    fetchMetingTracks(metingApi, metingQuery)
      .then((tracks) => {
        if (!cancelled) {
          setMetingTracks(tracks);
        }
      })
      .catch(() => {
        // keep static tracks as fallback when meting fetch fails
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, metingApi, metingQueryKey]);

  const tracks = metingTracks.length > 0 ? metingTracks : staticTracks;
  const track = tracks[index] || undefined;
  const trackUrl = track?.url;

  // 歌单就绪后，若未手动切歌，自动选中默认曲目「轻涟」（La vaguelette）
  useEffect(() => {
    if (didAutoSelectRef.current || metingTracks.length === 0) {
      return;
    }
    const defaultIndex = metingTracks.findIndex(
      (item) => item.name.includes("轻涟") || item.name.toLowerCase().includes("vaguelette"),
    );
    if (defaultIndex >= 0) {
      didAutoSelectRef.current = true;
      setIndex(defaultIndex);
    }
  }, [metingTracks]);

  // 点击页面任意空白处：播放器自动收起成小磁贴，播放列表自动关闭
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const root = rootRef.current;
      if (!root || !target || root.contains(target)) {
        return;
      }
      setCollapsed(true);
      setListOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [enabled]);

  // persist volume across sessions
  useEffect(() => {
    localStorage.setItem("rin.player.volume", String(volume));
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !enabled) {
      return;
    }
    audio.volume = volume;
  }, [volume, enabled]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !enabled) {
      return;
    }
    if (!trackUrl) {
      setPlaying(false);
      return;
    }
    audio.src = trackUrl;
    audio.load();
    setCurrentTime(0);
    setDuration(0);
    setProgress(0);
    if (autoplay) {
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    } else {
      setPlaying(false);
    }
  }, [trackUrl, enabled, autoplay]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const onTimeUpdate = () => {
      if (audio.duration) {
        setCurrentTime(audio.currentTime);
        setDuration(audio.duration);
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };
    const onEnded = () => {
      if (tracks.length > 1) {
        setIndex((current) => (current + 1) % tracks.length);
      } else {
        setPlaying(false);
      }
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, [tracks.length]);

  // close playlist when clicking outside
  const totalCount = tracks.length;

  function jumpTo(targetIndex: number) {
    setIndex((targetIndex + tracks.length) % tracks.length);
  }

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  if (!enabled || !track) {
    return null;
  }

  const coverNode = track.cover ? (
      <img src={track.cover} alt="" className="h-full w-full object-cover" />
    ) : (
      <span className="flex h-full w-full items-center justify-center bg-theme/10 text-theme">
        <i className="ri-music-2-line text-xl" />
      </span>
    );

  return (
    <div ref={rootRef} className="fixed bottom-2 left-2 z-40">
      <audio ref={audioRef} />

      {/* 歌单列表：展开时在卡片上方弹出 */}
      {listOpen && totalCount > 0 ? (
        <div className="absolute bottom-full left-0 mb-2 max-h-[min(60vh,20rem)] w-[min(20rem,70vw)] overflow-hidden rounded-2xl border border-black/10 bg-w shadow-2xl dark:border-white/10">
          <div className="flex items-center justify-between border-b border-black/5 px-4 py-2.5 dark:border-white/5">
            <p className="text-sm font-medium t-primary">
              <i className="ri-play-list-2-line mr-1.5 text-theme" />
              {t("theme.player.playlist")}
            </p>
            <span className="text-xs text-neutral-400 dark:text-neutral-500">{totalCount}</span>
          </div>
          <ol className="max-h-[min(calc(60vh-3rem),17rem)] overflow-y-auto p-1.5">
            {tracks.map((item, itemIndex) => {
              const active = itemIndex === index;
              return (
                <li key={item.url + itemIndex}>
                  <button
                    type="button"
                    onClick={() => {
                      jumpTo(itemIndex);
                      setListOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-neutral-100 dark:hover:bg-white/10 ${
                      active ? "bg-theme/10" : ""
                    }`}
                  >
                    {item.cover ? (
                      <img src={item.cover} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-theme/10 text-theme">
                        <i className="ri-music-2-line text-sm" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm ${active ? "font-medium t-primary" : "t-primary"}`}
                      >
                        {item.name}
                      </span>
                      {item.artist ? (
                        <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                          {item.artist}
                        </span>
                      ) : null}
                    </span>
                    {active ? <i className="ri-volume-up-fill shrink-0 text-theme" /> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {/* 播放器本体：展开-收起用统一的容器，带宽度/透明度过渡动画 */}
      <div
        className={`flex items-center justify-between overflow-hidden rounded-2xl border border-black/10 bg-w shadow-2xl transition-all duration-300 ease-out dark:border-white/10 ${
          collapsed ? "w-[3.5rem]" : "w-[min(20rem,calc(100vw-1rem))]"
        }`}
      >
        {/* 专辑图（始终显示；收起时作为展开入口） */}
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          className={`group relative block shrink-0 overflow-hidden transition-all duration-300 ${
            collapsed ? "h-14 w-14" : "h-11 w-11"
          }`}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("theme.player.expand") : t("theme.player.collapse")}
          title={collapsed ? t("theme.player.expand") : t("theme.player.collapse")}
        >
          <span className="block h-full w-full">{coverNode}</span>
          <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-0 transition group-hover:opacity-100">
            <i className={collapsed ? "ri-arrow-up-s-line text-xl" : "ri-arrow-down-s-line text-xl"} />
          </span>
        </button>

        {/* 展开部分：信息 + 进度条 + 控制 */}
        <div
          className={`flex min-w-0 flex-1 items-center gap-2 overflow-hidden pl-1 pr-1.5 transition-all duration-300 ${
            collapsed ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium t-primary">{track.name}</p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {track.artist || t("theme.player.unknown_artist")}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="shrink-0 text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(progress, duration || 0)}
                onChange={(event) => {
                  const audio = audioRef.current;
                  if (!audio) return;
                  const target = Number(event.target.value);
                  audio.currentTime = target;
                  setCurrentTime(target);
                  setProgress((target / (audio.duration || 1)) * 100);
                }}
                aria-label={t("theme.player.seek")}
                className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
                style={{
                  background: `linear-gradient(to right, var(--theme, #5ab0d8) ${progress}%, rgb(229 229 229) ${progress}%)`,
                }}
              />
              <span className="shrink-0 text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
                {formatTime(duration)}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setListOpen((current) => !current)}
              className={`rounded-full p-1.5 text-base t-primary transition hover:bg-neutral-100 dark:hover:bg-white/10 ${
                listOpen ? "text-theme" : ""
              }`}
              aria-expanded={listOpen}
              aria-label={t("theme.player.playlist")}
              title={t("theme.player.playlist")}
            >
              <i className="ri-play-list-2-line" />
            </button>
            {totalCount > 1 ? (
              <button
                type="button"
                onClick={() => jumpTo(index - 1)}
                className="rounded-full p-1.5 text-base t-primary transition hover:scale-105 hover:bg-neutral-100 dark:hover:bg-white/10"
                aria-label={t("theme.player.prev")}
              >
                <i className="ri-skip-back-line" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-theme text-base text-white shadow-md transition hover:scale-105 hover:bg-theme-hover"
              aria-label={playing ? t("theme.player.pause") : t("theme.player.play")}
            >
              <i className={playing ? "ri-pause-fill" : "ri-play-fill"} />
            </button>
            {totalCount > 1 ? (
              <button
                type="button"
                onClick={() => jumpTo(index + 1)}
                className="rounded-full p-1.5 text-base t-primary transition hover:scale-105 hover:bg-neutral-100 dark:hover:bg-white/10"
                aria-label={t("theme.player.next")}
              >
                <i className="ri-skip-forward-line" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}