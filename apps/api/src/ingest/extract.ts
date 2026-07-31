import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { cleanText } from "./normalise.js";

// jsdom emits noisy CSS/HTML parse errors for real-world pages; we only want the
// document tree, so route its console nowhere.
const silentConsole = new VirtualConsole();

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const PER_HOST_DELAY_MS = 1_000;

// Identify the project honestly, with a contact URL, per robots etiquette.
const USER_AGENT =
  "TechRadioBot/0.1 (+https://github.com/ruben-perpetua/ai-radio-station; personal, non-commercial)";

/**
 * Reject loopback, private, link-local, unique-local and cloud-metadata ranges.
 * A malicious feed entry pointing at http://169.254.169.254/ is the textbook
 * cloud-metadata SSRF; this is the control that stops it.
 */
function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number, ...number[]];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80")) return true; // link-local
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique-local
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1] as string);
    return false;
  }
  return true; // unparseable: refuse
}

async function assertPublicHost(hostname: string): Promise<void> {
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) throw new Error(`no DNS records for ${hostname}`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`refusing private address ${address} for ${hostname}`);
    }
  }
}

/** https only. http/file/data/etc. are rejected — a security control, not style. */
function assertHttps(url: URL): void {
  if (url.protocol !== "https:") {
    throw new Error(`refusing non-https scheme: ${url.protocol}`);
  }
}

/** Minimal robots.txt: honour Disallow rules under `*` and our own agent. */
function isDisallowed(robots: string, path: string): boolean {
  const lines = robots.split("\n").map((l) => l.replace(/#.*$/, "").trim());
  let applies = false;
  const disallows: string[] = [];
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      applies = value === "*" || value.toLowerCase() === "techradiobot";
    } else if (key === "disallow" && applies && value) {
      disallows.push(value);
    }
  }
  return disallows.some((rule) => path.startsWith(rule));
}

export class ArticleExtractor {
  private readonly lastFetchByHost = new Map<string, number>();
  private readonly robotsCache = new Map<string, string>();

  /** Fetch and extract readable text, or null if blocked/unavailable/too thin. */
  async extract(rawUrl: string): Promise<string | null> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }
    assertHttps(url);
    await assertPublicHost(url.hostname);

    if (await this.blockedByRobots(url)) {
      console.warn(`  [extract] robots.txt disallows ${url.href}`);
      return null;
    }

    const html = await this.fetchHtml(url);
    if (html === null) return null;

    const dom = new JSDOM(html, { url: url.href, virtualConsole: silentConsole });
    const article = new Readability(dom.window.document).parse();
    dom.window.close();
    if (!article?.textContent) return null;

    const text = cleanText(article.textContent);
    return text.length > 0 ? text : null;
  }

  private async blockedByRobots(url: URL): Promise<boolean> {
    let robots = this.robotsCache.get(url.host);
    if (robots === undefined) {
      robots = await this.fetchRobots(url);
      this.robotsCache.set(url.host, robots);
    }
    return isDisallowed(robots, url.pathname);
  }

  private async fetchRobots(url: URL): Promise<string> {
    try {
      await this.throttle(url.host);
      const res = await fetch(`${url.protocol}//${url.host}/robots.txt`, {
        headers: { "user-agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return res.ok ? await res.text() : "";
    } catch {
      return ""; // absent/unreachable robots.txt means no restrictions
    }
  }

  private async fetchHtml(startUrl: URL): Promise<string | null> {
    let url = startUrl;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      await this.throttle(url.host);
      const res = await fetch(url.href, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        url = new URL(location, url);
        assertHttps(url); // re-check scheme after every redirect
        await assertPublicHost(url.hostname); // re-check IP after every redirect
        continue;
      }

      if (!res.ok || !res.body) return null;
      return this.readCapped(res.body);
    }
    console.warn(`  [extract] too many redirects for ${startUrl.href}`);
    return null;
  }

  /** Enforce at least PER_HOST_DELAY_MS between requests to the same host. */
  private async throttle(host: string): Promise<void> {
    const last = this.lastFetchByHost.get(host);
    if (last !== undefined) {
      const wait = PER_HOST_DELAY_MS - (Date.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    this.lastFetchByHost.set(host, Date.now());
  }

  /** Read the body, aborting past MAX_BYTES so a huge page can't exhaust memory. */
  private async readCapped(
    body: ReadableStream<Uint8Array>,
  ): Promise<string | null> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_BYTES) {
            await reader.cancel();
            console.warn(`  [extract] response exceeded ${MAX_BYTES} bytes`);
            return null;
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}
