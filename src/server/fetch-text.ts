import "server-only";

export class BoundedFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundedFetchError";
  }
}

/**
 * Fetches a fixed, allowlisted HTTPS URL with a timeout, a body cap and no cross-host redirects.
 * Callers only pass URLs they built from constants or from hosts they have already allowlisted.
 */
export async function fetchBoundedText(
  url: string,
  options: { allowedHosts: ReadonlySet<string>; maxBytes: number; timeoutMs: number; accept: string; userAgent?: string },
) {
  let current = new URL(url);
  for (let hop = 0; hop < 3; hop += 1) {
    if (current.protocol !== "https:" || !options.allowedHosts.has(current.hostname) || current.username || current.password || (current.port && current.port !== "443")) {
      throw new BoundedFetchError(`Refused to fetch a non-allowlisted URL (${current.hostname}).`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(current, {
        headers: { accept: options.accept, "user-agent": options.userAgent ?? "ThesisGate/0.2 (research prototype)" },
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        void response.body?.cancel().catch(() => undefined);
        if (!location) throw new BoundedFetchError("Redirect without a location.");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new BoundedFetchError(`${current.hostname} returned HTTP ${response.status}.`);
      }
      if (!response.body) throw new BoundedFetchError("Response had no body.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > options.maxBytes) {
            await reader.cancel("body too large");
            throw new BoundedFetchError(`${current.hostname} response exceeded ${Math.round(options.maxBytes / 1024)} KB.`);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { text: new TextDecoder().decode(bytes), finalUrl: current.toString() };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new BoundedFetchError(`${current.hostname} timed out.`);
      if (error instanceof BoundedFetchError) throw error;
      throw new BoundedFetchError(`${current.hostname} could not be reached.`);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new BoundedFetchError("Too many redirects.");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", trade: "™", reg: "®", copy: "©" };

export function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|figure)[\s\S]*?<\/\1>/gi, "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/tr)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A tiny in-process TTL cache that also coalesces concurrent misses, so a burst of visitors
 * produces one upstream request per key. Failures are not cached.
 */
export function createTtlCache<T>(ttlMs: number, maxEntries = 50) {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, Promise<T>>();
  return {
    async get(key: string, load: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now) return hit.value;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const promise = load()
        .then((value) => {
          entries.delete(key);
          entries.set(key, { value, expiresAt: Date.now() + ttlMs });
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
          return value;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
    clear() {
      entries.clear();
      inFlight.clear();
    },
  };
}
