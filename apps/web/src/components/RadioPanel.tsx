import { useCallback, useEffect, useState } from "react";
import {
  fetchLatestShow,
  fetchShow,
  fetchShows,
  type Show,
  type ShowSummary,
} from "../api/client";
import { usePlayer } from "../hooks/usePlayer";
import { TransportControls } from "./TransportControls";
import { Transcript } from "./Transcript";
import "./radio-panel.css";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly show: Show };

/** A short, human label for the picker: date first, then the lead headline. */
function summaryLabel(s: ShowSummary): string {
  const date = s.createdAt.slice(0, 10);
  const lead = s.headlines[0];
  return lead ? `${date} — ${lead}` : date;
}

export function RadioPanel(): React.JSX.Element {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [shows, setShows] = useState<readonly ShowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load one show: a specific id from the picker, or the latest by default.
  const loadShow = useCallback(async (id?: string) => {
    setLoad({ kind: "loading" });
    try {
      const show = id ? await fetchShow(id) : await fetchLatestShow();
      setSelectedId(show.showId);
      setLoad({ kind: "ready", show });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load show";
      // A 404 from the server carries the "no show available" copy verbatim.
      if (/no show available/i.test(message)) {
        setLoad({ kind: "empty", message });
      } else {
        setLoad({ kind: "error", message });
      }
    }
  }, []);

  // On mount, fetch the episode list so the picker is populated, then load the
  // newest (or fall back to /latest when the list is empty or unavailable).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let list: readonly ShowSummary[] = [];
      try {
        list = await fetchShows();
      } catch {
        list = []; // picker just stays hidden; the show still loads below
      }
      if (cancelled) return;
      setShows(list);
      await loadShow(list[0]?.showId);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadShow]);

  const picker =
    shows.length > 1 ? (
      <div className="show-picker">
        <label htmlFor="show-select">Episode</label>
        <select
          id="show-select"
          value={selectedId ?? ""}
          onChange={(e) => void loadShow(e.target.value)}
        >
          {shows.map((s) => (
            <option key={s.showId} value={s.showId}>
              {summaryLabel(s)}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  // The hook must be called unconditionally; it accepts null until a show loads.
  const show = load.kind === "ready" ? load.show : null;
  const player = usePlayer(show);

  if (load.kind === "loading") {
    return (
      <div className="radio-panel">
        {picker}
        <div className="skeleton skeleton-transport" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
      </div>
    );
  }

  if (load.kind === "empty") {
    return (
      <div className="radio-panel">
        {picker}
        <div className="empty-state">
          <p>{load.message}</p>
          <p className="mono">npm run show:build</p>
          <button
            type="button"
            onClick={() => void loadShow(selectedId ?? undefined)}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (load.kind === "error") {
    return (
      <div className="radio-panel">
        {picker}
        <div className="error-banner">{load.message}</div>
        <button
          type="button"
          onClick={() => void loadShow(selectedId ?? undefined)}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="radio-panel">
      {picker}
      <TransportControls show={load.show} player={player} />
      <Transcript
        show={load.show}
        partIndex={player.partIndex}
        failedParts={player.failedParts}
        onSeekToPart={player.seekToPart}
      />
    </div>
  );
}
