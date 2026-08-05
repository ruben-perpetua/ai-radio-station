import { useState } from "react";
import type { RetrievedChunk } from "../api/client";

// Cosine distance runs 0 (identical) to 2 (opposite). In practice good matches
// live well under 1, so we scale the bar against 1.0 and clamp.
const BAR_MAX_DISTANCE = 1;

/** Longer bar = closer match, so invert the distance into a fill fraction. */
function fillFraction(distance: number): number {
  const clamped = Math.min(Math.max(distance, 0), BAR_MAX_DISTANCE);
  return 1 - clamped / BAR_MAX_DISTANCE;
}

/** Colour bands teach the distance scale faster than any number can. */
function bandColor(distance: number): string {
  if (distance < 0.3) return "#1a9850"; // green: a genuinely close match
  if (distance < 0.5) return "#e6a000"; // amber: plausibly relevant
  return "#9aa0a6"; // grey: probably noise
}

function preview(text: string, max = 220): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

interface Props {
  readonly item: RetrievedChunk;
  readonly totalChunksInDoc?: number;
}

export function ResultCard({ item }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { chunk, distance, rank } = item;
  const { metadata } = chunk;

  return (
    <li className="result-card">
      <div className="result-head">
        <span className="result-rank">#{rank}</span>
        <span className="result-bar" aria-hidden="true">
          <span
            className="result-bar-fill"
            style={{
              width: `${fillFraction(distance) * 100}%`,
              background: bandColor(distance),
            }}
          />
        </span>
        <span className="result-distance" style={{ color: bandColor(distance) }}>
          {distance.toFixed(3)}
        </span>
        <span className="result-source">
          {metadata.sourceId} · chunk {chunk.index}
        </span>
      </div>

      <div className="result-title">{metadata.title}</div>

      {/* Plain string render: retrieved text is untrusted web content, so it
          must never touch dangerouslySetInnerHTML. React escapes it for us. */}
      <button
        type="button"
        className="result-text"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Collapse" : "Expand full chunk"}
      >
        {expanded ? chunk.text : preview(chunk.text)}
      </button>

      <div className="result-meta">
        ~{chunk.tokenEstimate} tokens · {formatDate(metadata.publishedAt)} ·{" "}
        <a href={metadata.url} target="_blank" rel="noopener noreferrer">
          open source ↗
        </a>
      </div>
    </li>
  );
}
