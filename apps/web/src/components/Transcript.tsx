import { useEffect, useRef } from "react";
import type { Show, ShowAudioSegment } from "../api/client";
import { formatTime } from "../utils/format";

interface Props {
  readonly show: Show;
  readonly partIndex: number;
  readonly failedParts: readonly number[];
  readonly onSeekToPart: (index: number) => void;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function Transcript({
  show,
  partIndex,
  failedParts,
  onSeekToPart,
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLOListElement | null>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  // Suspend auto-scroll once the user takes over, resume on the next part change.
  const userScrolledRef = useRef(false);

  // Real user-intent events only — programmatic scrollIntoView never fires these,
  // so we can distinguish "the user is reading" from "we moved the highlight".
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const suspend = (): void => {
      userScrolledRef.current = true;
    };
    el.addEventListener("wheel", suspend, { passive: true });
    el.addEventListener("touchmove", suspend, { passive: true });
    return () => {
      el.removeEventListener("wheel", suspend);
      el.removeEventListener("touchmove", suspend);
    };
  }, []);

  useEffect(() => {
    userScrolledRef.current = false; // new part -> auto-scroll allowed again
    const active = itemRefs.current[partIndex];
    if (active && !userScrolledRef.current) {
      active.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [partIndex]);

  return (
    <ol className="transcript" ref={containerRef}>
      {show.parts.map((part: ShowAudioSegment, index) => {
        const active = index === partIndex;
        const failed = failedParts.includes(index);
        return (
          <li
            key={part.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            className={[
              "segment-card",
              active ? "active" : "",
              failed ? "failed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <button
              type="button"
              className="segment-seek"
              onClick={() => onSeekToPart(index)}
              aria-label={`Play ${part.kind}${part.headline ? `: ${part.headline}` : ""}`}
            >
              <div className="segment-head">
                <span className={`segment-kind kind-${part.kind}`}>
                  {part.kind}
                </span>
                {part.headline && (
                  <span className="segment-headline">{part.headline}</span>
                )}
                <span className="segment-meta mono">
                  {part.voice} · {formatTime(part.durationSeconds)}
                </span>
              </div>
              <p className="segment-text">{part.text}</p>
            </button>

            {part.sourceUrls.length > 0 && (
              <div className="segment-sources">
                {part.sourceUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {hostname(url)}
                  </a>
                ))}
              </div>
            )}

            {failed && (
              <div className="segment-error">Audio unavailable — skipped.</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
