import type { Player } from "../hooks/usePlayer";
import type { Show } from "../api/client";
import { formatTime } from "../utils/format";

interface Props {
  readonly show: Show;
  readonly player: Player;
}

export function TransportControls({ show, player }: Props): React.JSX.Element {
  const current = show.parts[player.partIndex];
  const isPlaying = player.status === "playing";
  const label =
    current?.kind === "segment"
      ? (current.headline ?? "segment")
      : (current?.kind ?? "");

  return (
    <div className="transport">
      <div className="transport-buttons">
        <button
          type="button"
          aria-label="Previous segment"
          onClick={player.prev}
          disabled={player.partIndex === 0}
        >
          ⏮
        </button>
        <button
          type="button"
          className="play-toggle"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={player.toggle}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          aria-label="Next segment"
          onClick={player.next}
          disabled={player.partIndex >= show.parts.length - 1}
        >
          ⏭
        </button>
      </div>

      <div className="transport-scrub">
        <input
          type="range"
          className="scrubber"
          min={0}
          max={player.totalDuration || 0}
          step={0.1}
          value={Math.min(player.showElapsed, player.totalDuration)}
          onChange={(e) => player.seekToShowTime(Number(e.target.value))}
          aria-label="Seek within show"
        />
        <span className="time mono">
          {formatTime(player.showElapsed)} / {formatTime(player.totalDuration)}
        </span>
      </div>

      <div className="transport-now">
        segment {player.partIndex + 1} of {show.parts.length}
        {label ? ` · “${label}”` : ""}
      </div>

      {player.autoplayBlocked && (
        <div className="autoplay-hint">
          Autoplay blocked — click play to start.
        </div>
      )}
    </div>
  );
}
