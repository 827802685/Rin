import { useContext, useEffect, useMemo, useRef, useState } from "react";
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
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem("rin.player.volume"));
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.8;
  });
  const [collapsed, setCollapsed] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playlistRef = useRef<HTMLDivElement | null>(null);

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
  useEffect(() => {
    if (!showPlaylist) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (playlistRef.current && !playlistRef.current.contains(event.target as Node)) {
        setShowPlaylist(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showPlaylist]);

  const totalCount = tracks.length;

  const activeTracks = useMemo(
    () =>
      tracks.map((item, itemIndex) => ({
        ...item,
        isCurrent: itemIndex === index,
        onClick: () => jumpTo(itemIndex),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, index],
  );

  function jumpTo(targetIndex: number) {
    setIndex((targetIndex + tracks.length) % tracks.length);
    setShowPlaylist(false);
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

  return (
    <div className="fixed bottom-4 left-4 z-40 w-[min(92vw,28rem)]">
      <div className="relative rounded-2xl border border-black/10 bg-w shadow-xl dark:border-white/10">
        <div className="flex items-center gap-3 px-4 py-3">
          <audio ref={audioRef} />
          {track.cover ? (
            <img src={track.cover} alt="" className="h-11 w-11 rounded-xl object-cover" />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-theme/10 text-theme">
              <i className="ri-music-2-line" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium t-primary">
              {collapsed ? `${track.name}${track.artist ? ` - ${track.artist}` : ""}` : track.name}
            </p>
            {!collapsed && (
              <>
                <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {track.artist || t("theme.player.unknown_artist")}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">{formatTime(currentTime)}</span>
                  <div className="h-1 flex-1 rounded-full bg-neutral-200 dark:bg-neutral-700">
                    <div className="h-1 rounded-full bg-theme" style={{ width: `${progress}%` }} />
                  </div>
                  <span className="text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">{formatTime(duration)}</span>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {totalCount > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => jumpTo(index - 1)}
                  className="rounded-full p-2 t-primary transition hover:bg-neutral-100 dark:hover:bg-white/10"
                  aria-label={t("theme.player.prev")}
                >
                  <i className="ri-skip-back-line" />
                </button>
                <button
                  type="button"
                  onClick={() => jumpTo(index + 1)}
                  className="rounded-full p-2 t-primary transition hover:bg-neutral-100 dark:hover:bg-white/10"
                  aria-label={t("theme.player.next")}
                >
                  <i className="ri-skip-forward-line" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-theme text-white transition hover:bg-theme-hover"
              aria-label={playing ? t("theme.player.pause") : t("theme.player.play")}
            >
              <i className={playing ? "ri-pause-fill" : "ri-play-fill"} />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="rounded-full p-2 t-primary transition hover:bg-neutral-100 dark:hover:bg-white/10"
              aria-label={collapsed ? t("theme.player.expand") : t("theme.player.collapse")}
            >
              <i className={collapsed ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="flex items-center gap-2 border-t border-black/5 px-4 py-2 dark:border-white/5">
            <button
              type="button"
              onClick={() => setShowPlaylist((value) => !value)}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] t-muted transition hover:bg-neutral-100 dark:hover:bg-white/10"
              aria-label={t("theme.player.playlist")}
            >
              <i className="ri-play-list-2-line" />
              <span>{totalCount}</span>
            </button>
            <div className="flex flex-1 items-center gap-2">
              <i className="ri-volume-down-line text-xs text-neutral-400 dark:text-neutral-500" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-200 accent-theme dark:bg-neutral-700"
                aria-label={t("theme.player.volume")}
              />
              <i className="ri-volume-up-line text-xs text-neutral-400 dark:text-neutral-500" />
            </div>
          </div>
        )}

        {showPlaylist && !collapsed && (
          <div
            ref={playlistRef}
            className="absolute bottom-full left-2 right-2 z-50 mb-2 max-h-64 overflow-auto rounded-2xl border border-black/10 bg-w p-2 shadow-xl dark:border-white/10"
          >
            <p className="px-2 py-1 text-xs font-medium text-neutral-400 dark:text-neutral-500">{t("theme.player.playlist_title")}</p>
            {activeTracks.map((item) => (
              <button
                key={item.url}
                type="button"
                onClick={item.onClick}
                className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-neutral-100 dark:hover:bg-white/10 ${
                  item.isCurrent ? "bg-theme/5" : ""
                }`}
              >
                <span className={`text-sm ${item.isCurrent ? "text-theme" : "t-muted"}`}>
                  <i className={item.isCurrent ? "ri-volume-up-line" : "ri-music-2-line"} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${item.isCurrent ? "t-primary" : "t-secondary"}`}>{item.name}</span>
                  {item.artist ? (
                    <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">{item.artist}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}