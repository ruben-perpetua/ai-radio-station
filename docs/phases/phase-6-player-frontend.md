# Phase 6 — Player Frontend

## Goal

A browser UI that plays the show, displays the transcript, highlights the segment
currently being spoken, and links to sources — sitting alongside the Phase 3 debug panel.

## Why now

Every backend piece exists. This phase makes the project demonstrable to someone who is
not you.

## Deliverables

- Two-tab layout: **Radio** and **Debug**
- Sequential playback of per-segment WAV files as one continuous show
- Transcript with the active segment highlighted
- Per-segment skip controls
- Source links per segment
- Play/pause, scrub, and total elapsed/remaining time
- Loading and error states

## Key design decision: sequential segments, one playhead

The backend produces seven WAV files. The user must experience one continuous show.

Two options:

| Approach                 | Pros                                              | Cons                           |
| ------------------------ | ------------------------------------------------- | ------------------------------ |
| **Sequential `<audio>`** | Simple, native controls, streams naturally        | Small gap between segments     |
| **Web Audio API**        | Gapless, precise scheduling, easy silence padding | More code, manual transport UI |

**Recommendation: sequential `<audio>` first.** Use one `<audio>` element, swap its `src`
on `ended`, and maintain the virtual playhead yourself. It is far less code and the gap is
barely perceptible with a short pad. Move to Web Audio in Phase 8 only if the seams
genuinely bother you.

## Steps

### 1. Show artifact shape

The frontend consumes what Phase 7 will write to `data/shows/{showId}.json`:

```ts
export interface ShowAudioSegment {
  readonly id: string;
  readonly kind: "intro" | "segment" | "outro";
  readonly headline?: string;
  readonly text: string;
  readonly sourceUrls: readonly string[];
  readonly audioHash: string;
  readonly durationSeconds: number;
  readonly voice: string;
}

export interface Show {
  readonly showId: string;
  readonly createdAt: string;
  readonly totalDurationSeconds: number;
  readonly parts: readonly ShowAudioSegment[];
}
```

`parts` is a flat, ordered array including intro and outro. A flat list makes playback
indexing trivial; special-casing intro and outro in the player is needless complexity.

Endpoints: `GET /api/show/latest` and `GET /api/show/:showId`.

### 2. Playback hook

```ts
// apps/web/src/hooks/usePlayer.ts
export interface PlayerState {
  readonly status:
    | "idle"
    | "loading"
    | "playing"
    | "paused"
    | "ended"
    | "error";
  readonly partIndex: number;
  readonly partElapsed: number;
  readonly showElapsed: number;
  readonly totalDuration: number;
}
```

Core logic:

- One `<audio>` element via `useRef`, created once.
- `src` set to `/api/audio/${parts[partIndex].audioHash}`.
- On `ended`: increment `partIndex`, set the new `src`, call `play()`.
- `showElapsed` = sum of durations of completed parts + `audio.currentTime`.
- On `timeupdate`, update state — but **throttle to ~4 Hz**. `timeupdate` fires roughly
  every 250ms and re-rendering a transcript at that rate for no visual benefit is wasteful.

**Autoplay:** browsers block programmatic playback without a user gesture. The first
`play()` must originate from a click. Subsequent segment transitions are fine because they
descend from that original gesture. Handle the rejected promise from `play()` and surface
a "click to play" state rather than failing silently.

### 3. Transcript with highlighting

Render every part's text. Highlight the one at `partIndex`.

- Active part: raised background, full-opacity text.
- Inactive parts: dimmed but readable.
- Auto-scroll the active part into view with `scrollIntoView({ behavior: 'smooth', block: 'center' })`.
- **Suspend auto-scroll if the user scrolls manually**, and resume on the next part
  change. Nothing is more irritating than a transcript that yanks you back while reading.
- Clicking a part seeks to it — set `partIndex` and reset `currentTime` to 0.

Within-part word highlighting is deliberately out of scope: it requires word-level
timestamps that Kokoro does not provide. Segment-level highlighting is the right
resolution for 55-word segments anyway.

### 4. Segment cards

Each segment shows headline, text, voice label if using two hosts, duration, and source
links.

Source links: `target="_blank"` with `rel="noopener noreferrer"`. Without `noopener`, the
opened page gets a reference to your window via `window.opener`. Modern browsers imply it
for `_blank`, but be explicit — it is one attribute.

### 5. Transport controls

```
  ⏮   ▶/⏸   ⏭        ━━━━━━●────────────   1:12 / 2:18
       segment 3 of 7 · "Anthropic ships agentic workflows"
```

- Previous/next jump by part, not by seconds. Parts are the natural unit here.
- The scrubber represents the whole show. Convert a scrub position into
  `(partIndex, offsetWithinPart)` by walking the cumulative durations.
- Show elapsed and total for the whole show, not the current file.

### 6. Two-tab layout

```
┌──────────────────────────────────┐
│  [ Radio ]  [ Debug ]            │
├──────────────────────────────────┤
│  ... active tab ...              │
└──────────────────────────────────┘
```

Plain `useState`, no router. Keep both tabs mounted so switching does not interrupt
playback — that is a genuinely useful behaviour: listen to the show while poking at
retrieval in the debug tab.

### 7. States that actually occur

Handle all of these explicitly — they are not edge cases, they are Tuesday:

| State                    | UI                                                 |
| ------------------------ | -------------------------------------------------- |
| No show built yet        | "No show available. Run `npm run show:build`."     |
| Show loading             | Skeleton                                           |
| Audio file missing (404) | Per-part error, skip to next, do not kill the show |
| Autoplay blocked         | "Click to play"                                    |
| Network failure          | Retry button, preserve position                    |

### 8. Preload the next segment

When a part starts, create a hidden `<link rel="preload" as="audio">` for the _next_
part's URL, or instantiate a second `Audio` object pointed at it. This removes almost all
of the perceptible gap at the transition. Small change, disproportionate polish.

## How to verify

```bash
npm run show:build     # from Phase 7, or synthesise manually for now
npm run dev:api
npm run dev:web
```

- Press play. The full show runs start to finish without intervention.
- The transcript highlight follows the audio.
- Clicking a segment seeks there and playback continues correctly.
- Scrubbing to the middle of the show lands in the right segment.
- Source links open the right articles.
- Switching to Debug and back does not interrupt playback.
- Reloading mid-show recovers gracefully.

## Learning checkpoints

- Why does the first `play()` need a user gesture, and why are later ones exempt?
- How do you convert a whole-show scrub position into a part index and offset?
- Why throttle `timeupdate` rather than rendering on every event?
- What does `rel="noopener"` prevent?
- Why is segment-level highlighting the right granularity here?

## Risks and gotchas

| Risk                                    | Mitigation                                        |
| --------------------------------------- | ------------------------------------------------- |
| Autoplay blocked, appears broken        | Handle the rejected promise; show "click to play" |
| Audible gap between segments            | Preload the next part                             |
| Auto-scroll fights the user             | Suspend on manual scroll                          |
| Re-render storm from `timeupdate`       | Throttle to ~4 Hz                                 |
| One missing audio file kills the show   | Per-part error handling, skip forward             |
| Scrubber maps to the file, not the show | Walk cumulative durations                         |

## Done criteria

- [ ] A show plays start to finish without manual intervention
- [ ] The transcript highlights the active segment and auto-scrolls politely
- [ ] Clicking a segment seeks to it
- [ ] Whole-show scrubbing works across part boundaries
- [ ] Elapsed/total reflect the whole show
- [ ] Source links open correctly with `noopener noreferrer`
- [ ] Both tabs work; switching does not interrupt playback
- [ ] All five states in step 7 are handled
- [ ] You have demoed it to someone else without needing to explain anything
