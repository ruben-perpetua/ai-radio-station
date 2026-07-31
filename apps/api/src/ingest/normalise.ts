import { createHash } from "node:crypto";
import type { Document } from "../domain/types.js";

/** Query params that identify a campaign/referrer, not the content itself. */
const TRACKING_PARAM = /^(utm_|mc_|ref$|ref_|fbclid$|gclid$|igshid$)/i;

/**
 * Reduce a URL to a stable identity: no fragment, no tracking params, no
 * trailing slash. The same article shared from three places must collapse to
 * one canonical string so deduplication can catch it.
 */
export function canonicalUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();

  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
  }
  parsed.search = parsed.searchParams.toString()
    ? `?${parsed.searchParams.toString()}`
    : "";

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

/** Deterministic 16-hex-char id derived from the canonical URL. */
export function documentId(url: string): string {
  return createHash("sha256").update(canonicalUrl(url)).digest("hex").slice(0, 16);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "\u2019",
  lsquo: "\u2018",
  ldquo: "\u201c",
  rdquo: "\u201d",
  deg: "°",
  copy: "©",
  reg: "®",
  trade: "™",
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name.toLowerCase())
        ? (NAMED_ENTITIES[name.toLowerCase()] as string)
        : match,
    );
}

/**
 * Turn feed/API HTML into plain text safe to read aloud: block tags become
 * paragraph breaks (so the chunker still sees `\n\n` boundaries), remaining
 * tags are dropped, entities are decoded, and whitespace is normalised.
 */
export function cleanText(input: string): string {
  const withBreaks = input.replace(
    /<\s*(br\s*\/?|\/p|\/div|\/li|\/h[1-6])\s*>/gi,
    "\n\n",
  );
  const stripped = withBreaks.replace(/<[^>]*>/g, "");
  return decodeEntities(stripped)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Keep the copy with the richest text; carry the highest score across copies. */
function merge(a: Document, b: Document): Document {
  const richer = b.text.length > a.text.length ? b : a;
  const bestScore = Math.max(a.score ?? -Infinity, b.score ?? -Infinity);
  if (bestScore === -Infinity) return richer;
  return { ...richer, score: bestScore };
}

/**
 * Collapse documents that share a canonical URL. Without this the same story
 * from HN, Ars Technica and Lobsters would occupy three of the five show slots.
 */
export function deduplicate(docs: readonly Document[]): Document[] {
  const byUrl = new Map<string, Document>();
  for (const doc of docs) {
    const key = canonicalUrl(doc.url);
    const existing = byUrl.get(key);
    byUrl.set(key, existing ? merge(existing, doc) : doc);
  }
  return [...byUrl.values()];
}
