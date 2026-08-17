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

export function MusicPlayer() {
  const config = useContext(ClientConfigContext);
  const { t } = useTranslation();
  const [tracks] = useState<PlayerTrack[]>(() => parseTracks(config.get("widget.player.audio")));
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const enabled = config.getBoolean("widget.player.enabled");
  const autoplay = config.getBoolean("widget.player.autoplay");
  const track = tracks[index];

  const trackUrl = track?.url;

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

  if (!enabled || !track) {
    return null;
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

  const jump = (targetIndex: number) => {
    setIndex((targetIndex + tracks.length) % tracks.length);
  };

  const formatTime = (seconds: number) => {
    const rounded = Math.floor(seconds);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-[min(92vw,28rem)] -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-w px-4 py-3 shadow-xl dark:border-white/10">
        <audio ref={audioRef} />
        {track.cover ? (
          <img src={track.cover} alt="" className="h-11 w-11 rounded-xl object-cover" />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-theme/10 text-theme">
            <i className="ri-music-2-line" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium t-primary">{track.name}</p>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{track.artist || t("theme.player.unknown_artist")}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">{formatTime(currentTime)}</span>
            <div className="h-1 flex-1 rounded-full bg-neutral-200 dark:bg-neutral-700">
              <div className="h-1 rounded-full bg-theme" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">{formatTime(duration)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {tracks.length > 1 ? (
            <button
              type="button"
              onClick={() => jump(index - 1)}
              className="rounded-full p-2 t-primary transition hover:bg-neutral-100 dark:hover:bg-white/10"
              aria-label={t("theme.player.prev")}
            >
              <i className="ri-skip-back-line" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-theme text-white transition hover:bg-theme-hover"
            aria-label={playing ? t("theme.player.pause") : t("theme.player.play")}
          >
            <i className={playing ? "ri-pause-fill" : "ri-play-fill"} />
          </button>
          {tracks.length > 1 ? (
            <button
              type="button"
              onClick={() => jump(index + 1)}
              className="rounded-full p-2 t-primary transition hover:bg-neutral-100 dark:hover:bg-white/10"
              aria-label={t("theme.player.next")}
            >
              <i className="ri-skip-forward-line" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
