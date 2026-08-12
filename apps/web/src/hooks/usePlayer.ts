import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audioUrl, type Show } from "../api/client";

export type PlayerStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export interface PlayerState {
  readonly status: PlayerStatus;
  readonly partIndex: number;
  readonly partElapsed: number;
  readonly showElapsed: number;
  readonly totalDuration: number;
}

export interface Player extends PlayerState {
  /** Indices of parts whose audio failed to load (404); the show skips them. */
  readonly failedParts: readonly number[];
  /** True when the browser blocked programmatic playback; needs a click. */
  readonly autoplayBlocked: boolean;
  readonly toggle: () => void;
  readonly play: () => void;
  readonly pause: () => void;
  readonly next: () => void;
  readonly prev: () => void;
  readonly seekToPart: (index: number) => void;
  readonly seekToShowTime: (seconds: number) => void;
}

// timeupdate fires ~4x/second already, but coalesce to be safe: re-rendering the
// transcript more often than this buys nothing the eye can see.
const UPDATE_INTERVAL_MS = 250;

export function usePlayer(show: Show | null): Player {
  // Cumulative start time of each part, so a whole-show position converts to a
  // (partIndex, offset) by walking these boundaries.
  const offsets = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const p of show?.parts ?? []) {
      out.push(acc);
      acc += p.durationSeconds;
    }
    return out;
  }, [show]);

  const totalDuration = show?.totalDurationSeconds ?? 0;

  const [state, setState] = useState<PlayerState>({
    status: "idle",
    partIndex: 0,
    partElapsed: 0,
    showElapsed: 0,
    totalDuration,
  });
  const [failedParts, setFailedParts] = useState<readonly number[]>([]);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Refs the audio event handlers read, so a single set of listeners attached
  // once never sees stale props/state.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const indexRef = useRef(0);
  const showRef = useRef(show);
  const offsetsRef = useRef(offsets);
  const pendingOffsetRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const shouldPlayRef = useRef(false);

  showRef.current = show;
  offsetsRef.current = offsets;

  const patch = useCallback((next: Partial<PlayerState>) => {
    setState((prev) => ({ ...prev, ...next }));
  }, []);

  /** Point the hidden preloader at the next part so the transition is seamless. */
  const preloadNext = useCallback((index: number) => {
    const parts = showRef.current?.parts;
    const preload = preloadRef.current;
    if (!parts || !preload) return;
    const nextPart = parts[index + 1];
    if (nextPart) {
      preload.src = audioUrl(nextPart.audioHash);
      preload.load();
    }
  }, []);

  const loadPart = useCallback(
    (index: number, offset: number, playNow: boolean) => {
      const audio = audioRef.current;
      const parts = showRef.current?.parts;
      if (!audio || !parts) return;

      if (index >= parts.length) {
        patch({ status: "ended", partIndex: parts.length - 1 });
        shouldPlayRef.current = false;
        return;
      }

      indexRef.current = index;
      shouldPlayRef.current = playNow;
      const part = parts[index];
      const url = new URL(audioUrl(part.audioHash), window.location.href).href;

      const showElapsed = (offsetsRef.current[index] ?? 0) + offset;
      patch({
        partIndex: index,
        partElapsed: offset,
        showElapsed,
        status: playNow ? "loading" : "paused",
      });

      if (audio.src !== url) {
        audio.src = url;
        pendingOffsetRef.current = offset; // applied on loadedmetadata
        audio.load();
      } else {
        audio.currentTime = offset;
      }
      preloadNext(index);

      if (playNow) {
        audio.play().then(
          () => {
            setAutoplayBlocked(false);
            patch({ status: "playing" });
          },
          () => {
            // Programmatic playback without a user gesture is refused. Surface
            // it instead of failing silently; the next click will succeed.
            shouldPlayRef.current = false;
            setAutoplayBlocked(true);
            patch({ status: "paused" });
          },
        );
      }
    },
    [patch, preloadNext],
  );

  // Attach listeners exactly once; they read live values via refs.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
    preloadRef.current = new Audio();
    preloadRef.current.preload = "auto";

    const onLoadedMetadata = (): void => {
      if (pendingOffsetRef.current !== null) {
        audio.currentTime = pendingOffsetRef.current;
        pendingOffsetRef.current = null;
      }
    };

    const onTimeUpdate = (): void => {
      const now = performance.now();
      if (now - lastTickRef.current < UPDATE_INTERVAL_MS) return;
      lastTickRef.current = now;
      const index = indexRef.current;
      const base = offsetsRef.current[index] ?? 0;
      patch({
        partElapsed: audio.currentTime,
        showElapsed: base + audio.currentTime,
      });
    };

    const onEnded = (): void => {
      loadPart(indexRef.current + 1, 0, true);
    };

    const onError = (): void => {
      // A missing/broken part must not kill the show — record it and skip on.
      const failedIndex = indexRef.current;
      setFailedParts((prev) =>
        prev.includes(failedIndex) ? prev : [...prev, failedIndex],
      );
      if (shouldPlayRef.current) {
        loadPart(failedIndex + 1, 0, true);
      } else {
        patch({ status: "error" });
      }
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
    };
  }, [loadPart, patch]);

  // Reset everything when a different show loads.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    indexRef.current = 0;
    shouldPlayRef.current = false;
    pendingOffsetRef.current = null;
    setFailedParts([]);
    setAutoplayBlocked(false);
    setState({
      status: "idle",
      partIndex: 0,
      partElapsed: 0,
      showElapsed: 0,
      totalDuration: show?.totalDurationSeconds ?? 0,
    });
  }, [show]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !showRef.current) return;
    if (state.status === "playing") return;
    // If we already have a loaded part, just resume; otherwise start it.
    if (audio.src && state.status === "paused") {
      shouldPlayRef.current = true;
      audio.play().then(
        () => {
          setAutoplayBlocked(false);
          patch({ status: "playing" });
        },
        () => {
          setAutoplayBlocked(true);
          patch({ status: "paused" });
        },
      );
    } else {
      loadPart(indexRef.current, state.partElapsed, true);
    }
  }, [loadPart, patch, state.status, state.partElapsed]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    shouldPlayRef.current = false;
    audio.pause();
    patch({ status: "paused" });
  }, [patch]);

  const toggle = useCallback(() => {
    if (state.status === "playing") pause();
    else play();
  }, [state.status, play, pause]);

  const seekToPart = useCallback(
    (index: number) => {
      loadPart(index, 0, shouldPlayRef.current || state.status === "playing");
    },
    [loadPart, state.status],
  );

  const next = useCallback(() => {
    seekToPart(Math.min(indexRef.current + 1, (show?.parts.length ?? 1) - 1));
  }, [seekToPart, show]);

  const prev = useCallback(() => {
    seekToPart(Math.max(indexRef.current - 1, 0));
  }, [seekToPart]);

  const seekToShowTime = useCallback(
    (seconds: number) => {
      const parts = showRef.current?.parts;
      if (!parts) return;
      const clamped = Math.max(0, Math.min(seconds, totalDuration));
      // Walk cumulative boundaries to find which part this position lands in.
      let index = 0;
      for (let i = 0; i < parts.length; i++) {
        if (clamped >= (offsetsRef.current[i] ?? 0)) index = i;
        else break;
      }
      const offset = clamped - (offsetsRef.current[index] ?? 0);
      loadPart(index, offset, shouldPlayRef.current || state.status === "playing");
    },
    [loadPart, totalDuration, state.status],
  );

  return {
    ...state,
    totalDuration,
    failedParts,
    autoplayBlocked,
    toggle,
    play,
    pause,
    next,
    prev,
    seekToPart,
    seekToShowTime,
  };
}
