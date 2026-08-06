import { useEffect, useState } from "react";
import {
  fetchStats,
  search,
  type SearchResponse,
  type Stats,
} from "../api/client";
import { ResultCard } from "./ResultCard";
import "./debug-panel.css";

export function DebugPanel(): React.JSX.Element {
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(10);
  const [maxDistanceOn, setMaxDistanceOn] = useState(false);
  const [maxDistance, setMaxDistance] = useState(0.5);

  const [result, setResult] = useState<SearchResponse | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load stats"),
      );
  }, []);

  async function runSearch(): Promise<void> {
    if (query.trim().length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await search({
        query: query.trim(),
        topK,
        ...(maxDistanceOn ? { maxDistance } : {}),
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="debug-panel">
      <header className="stats-strip">
        {stats ? (
          <>
            <strong>{stats.collection}</strong> · {stats.totalChunks} chunks ·{" "}
            {stats.embeddingModel} · {stats.dimensions}d ·{" "}
            {stats.distanceMetric}
          </>
        ) : (
          "loading collection stats…"
        )}
      </header>

      <form
        className="query-row"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <input
          className="query-box"
          type="text"
          placeholder="Type a query…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={500}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      <div className="controls-row">
        <label>
          top-k:{" "}
          <input
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={maxDistanceOn}
            onChange={(e) => setMaxDistanceOn(e.target.checked)}
          />{" "}
          max distance
        </label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={maxDistance}
          disabled={!maxDistanceOn}
          onChange={(e) => setMaxDistance(Number(e.target.value))}
        />
        <span className="mono">
          {maxDistanceOn ? maxDistance.toFixed(2) : "off"}
        </span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {result && (
        <>
          <div className="timing-strip">
            embedded {result.embedMs}ms · searched {result.searchMs}ms ·{" "}
            {result.results.length} results · {result.totalIndexed} indexed
          </div>

          <ul className="result-list">
            {result.results.map((item) => (
              <ResultCard key={item.chunk.id} item={item} />
            ))}
          </ul>

          <div className="prompt-section">
            <button
              type="button"
              className="prompt-toggle"
              onClick={() => setPromptOpen((v) => !v)}
            >
              {promptOpen ? "▾" : "▸"} Assembled prompt preview (
              {result.prompt.chars.toLocaleString()} chars, ~
              {result.prompt.tokenEstimate.toLocaleString()} tokens)
            </button>
            {promptOpen && (
              <pre className="prompt-body">{result.prompt.full}</pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}
