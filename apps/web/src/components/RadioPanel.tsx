import { useCallback, useEffect, useState } from "react";
import { fetchLatestShow, type Show } from "../api/client";
import { usePlayer } from "../hooks/usePlayer";
import { TransportControls } from "./TransportControls";
import { Transcript } from "./Transcript";
import "./radio-panel.css";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly show: Show };

export function RadioPanel(): React.JSX.Element {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  const loadShow = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const show = await fetchLatestShow();
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

  useEffect(() => {
    void loadShow();
  }, [loadShow]);

  // The hook must be called unconditionally; it accepts null until a show loads.
  const show = load.kind === "ready" ? load.show : null;
  const player = usePlayer(show);

  if (load.kind === "loading") {
    return (
      <div className="radio-panel">
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
        <div className="empty-state">
          <p>{load.message}</p>
          <p className="mono">npm run tts -- data/shows/&lt;date&gt;.json</p>
          <button type="button" onClick={() => void loadShow()}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (load.kind === "error") {
    return (
      <div className="radio-panel">
        <div className="error-banner">{load.message}</div>
        <button type="button" onClick={() => void loadShow()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="radio-panel">
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
