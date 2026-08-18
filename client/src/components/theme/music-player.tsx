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
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // 收起状态：只保留一个专辑图磁贴，点击展开
  if (collapsed) {
    return (
      <div className="fixed bottom-4 left-4 z-40">
        <audio ref={audioRef} />
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="group relative block h-14 w-14 overflow-hidden rounded-2xl border border-black/10 bg-w shadow-xl transition hover:scale-105 dark:border-white/10"
          aria-expanded={false}
          aria-label={t("theme.player.expand")}
          title={track.name}
        >
          {track.cover ? (
            <img src={track.cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-theme/10 text-theme">
              <i className="ri-music-2-line text-xl" />
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-0 transition group-hover:opacity-100">
            <i className="ri-expand-up-line text-lg" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-40 w-[min(88vw,22rem)]">
      <div className="relative rounded-2xl border border-black/10 bg-w shadow-xl dark:border-white/10">
        <div className="flex items-center gap-3 p-3">
          <audio ref={audioRef} />
          {track.cover ? (
            <img src={track.cover} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-theme/10 text-theme">
              <i className="ri-music-2-line text-2xl" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium t-primary">{track.name}</p>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {track.artist || t("theme.player.unknown_artist")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
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
              className="flex h-10 w-10 items-center justify-center rounded-full bg-theme text-white transition hover:bg-theme-hover"
              aria-label={playing ? t("theme.player.pause") : t("theme.player.play")}
            >
              <i className={playing ? "ri-pause-fill" : "ri-play-fill"} />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="rounded-full p-2 t-primary transition hover:bg-neutral-100 dark:hover:bg-white/10"
              aria-label={t("theme.player.collapse")}
            >
              <i className="ri-arrow-down-s-line" />
            </button>
          </div>
        </div>
        {/* 精简播放进度条 */}
        <div className="flex items-center gap-2 border-t border-black/5 px-3 py-2 dark:border-white/5">
          <span className="shrink-0 text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">{formatTime(currentTime)}</span>
          <div className="h-1 flex-1">
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
              className="w-full cursor-pointer appearance-none bg-transparent"
              style={{ background: `linear-gradient(to right, var(--theme-rgb, 252 70 107) ${progress}%, rgb(229 229 229) ${progress}%)` }}
              aria-label={t("theme.player.seek")}
            />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}