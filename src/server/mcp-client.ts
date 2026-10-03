import "server-only";

/**
 * Minimal MCP (streamable HTTP) client for the two public Bitget Agent Hub data servers.
 * Only allowlisted hosts are contacted; sessions are reused briefly; bodies are size-capped.
 */
const ALLOWED_HOSTS = new Set(["agent.bitget.com", "datahub.noxiaohao.com"]);
const SESSION_TTL_MS = 10 * 60_000;
// The public servers cap open sessions per client IP and never expire them, so a session that is not
// being used is closed quickly. This is the only protection that survives a SIGKILL, an out-of-memory
// kill or a host reboot: at most one minute of a session's life can be lost to a hard stop.
const IDLE_CLOSE_MS = 60_000;
const MAX_BODY_BYTES = 2_000_000;
const PROTOCOL_VERSION = "2025-06-18";

export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpError";
  }
}

type Session = { id: string | null; createdAt: number; inflight: number; idleTimer: ReturnType<typeof setTimeout> | null };
const sessions = new Map<string, Session>();
// Concurrent calls share one in-flight handshake instead of racing to open several sessions.
const opening = new Map<string, Promise<Session>>();
let requestCounter = 0;

/** Extracts the JSON-RPC message from either a JSON body or a server-sent-events body. */
export function parseRpcBody(body: string): { result?: unknown; error?: { message?: string } } {
  const trimmed = body.trim();
  if (!trimmed) throw new McpError("Empty response from the data server.");
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as { result?: unknown; error?: { message?: string } };
  const dataLines = trimmed.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  for (let index = dataLines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(dataLines[index]) as { id?: unknown; result?: unknown; error?: { message?: string } };
      if ("result" in parsed || "error" in parsed) return parsed;
    } catch {
      // Keep looking at earlier events.
    }
  }
  throw new McpError("The data server response had no JSON-RPC result.");
}

async function post(url: string, payload: unknown, sessionId: string | null, timeoutMs: number, signal?: AbortSignal) {
  const target = new URL(url);
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) throw new McpError(`Refused to contact ${target.hostname}.`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
    });
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES) throw new McpError("The data server response was too large.");
    return { status: response.status, sessionId: response.headers.get("mcp-session-id"), text };
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new McpError(`${target.hostname} timed out.`);
    throw new McpError(`${target.hostname} could not be reached.`);
  } finally {
    clearTimeout(timeout);
  }
}

function sharedSession(url: string, timeoutMs: number) {
  const pending = opening.get(url);
  if (pending) return pending;
  const promise = openSession(url, timeoutMs).finally(() => opening.delete(url));
  opening.set(url, promise);
  return promise;
}

/** Ends a session on the server; public MCP servers cap open sessions per client address. */
async function closeSession(url: string, id: string | null) {
  if (!id) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    await fetch(url, { method: "DELETE", headers: { "mcp-session-id": id, "mcp-protocol-version": PROTOCOL_VERSION }, signal: controller.signal });
  } catch {
    // Best effort: an unreachable server will expire the session itself.
  } finally {
    clearTimeout(timeout);
  }
}

function scheduleIdleClose(url: string, session: Session) {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    session.idleTimer = null;
    if (session.inflight > 0) {
      scheduleIdleClose(url, session);
      return;
    }
    if (sessions.get(url) === session) sessions.delete(url);
    void closeSession(url, session.id);
  }, IDLE_CLOSE_MS);
  session.idleTimer.unref?.();
}

export async function closeMcpSessions() {
  const open = [...sessions.entries()];
  sessions.clear();
  await Promise.all(open.map(([url, session]) => {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    return closeSession(url, session.id);
  }));
}

let shutdownHookInstalled = false;
/**
 * Installs the SIGTERM/SIGINT handler that closes open Bitget MCP sessions (DELETE) before exit.
 * Idempotent. Registered eagerly at server boot from `src/instrumentation.ts` so the handler exists
 * even if no MCP request has run yet — otherwise a deploy's SIGTERM is unhandled and Docker SIGKILLs
 * the process (exit 137), leaking the session against Bitget's per-IP cap. Also called lazily when a
 * session opens, as a belt-and-braces fallback.
 */
export function registerMcpShutdownHook() {
  if (shutdownHookInstalled || typeof process === "undefined" || typeof process.once !== "function") return;
  shutdownHookInstalled = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    // The container sets NEXT_MANUAL_SIG_HANDLE so Next does not exit first (its handler calls
    // process.exit within milliseconds, which cut the DELETE requests off). This handler owns the exit.
    process.once(signal, () => {
      void closeMcpSessions().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
    });
  }
}

async function openSession(url: string, timeoutMs: number) {
  registerMcpShutdownHook();
  const init = await post(url, {
    jsonrpc: "2.0",
    id: ++requestCounter,
    method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "thesisgate", version: "0.3" } },
  }, null, timeoutMs);
  if (init.status === 503) throw new McpError("The data server is busy (too many open sessions); try again shortly.");
  if (init.status >= 400) throw new McpError(`The data server refused the session (HTTP ${init.status}).`);
  parseRpcBody(init.text);
  await post(url, { jsonrpc: "2.0", method: "notifications/initialized" }, init.sessionId, timeoutMs);
  const session: Session = { id: init.sessionId, createdAt: Date.now(), inflight: 0, idleTimer: null };
  sessions.set(url, session);
  scheduleIdleClose(url, session);
  return session;
}

/** Calls one MCP tool and returns the text content of its result. Retries once with a fresh session. */
export async function callMcpTool(url: string, name: string, args: Record<string, unknown>, timeoutMs = 20_000): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let session = sessions.get(url);
    const expired = session && session.inflight === 0 && Date.now() - session.createdAt > SESSION_TTL_MS;
    if (!session || expired || attempt > 0) {
      if (session && (expired || attempt > 0)) {
        sessions.delete(url);
        if (session.idleTimer) clearTimeout(session.idleTimer);
        void closeSession(url, session.id);
      }
      session = await sharedSession(url, timeoutMs);
    }
    const active = session;
    active.inflight += 1;
    if (active.idleTimer) {
      clearTimeout(active.idleTimer);
      active.idleTimer = null;
    }
    try {
      const response = await post(url, { jsonrpc: "2.0", id: ++requestCounter, method: "tools/call", params: { name, arguments: args } }, active.id, timeoutMs);
      if (response.status === 404 || response.status === 400) {
        if (sessions.get(url) === active) sessions.delete(url);
        void closeSession(url, active.id);
        continue;
      }
      if (response.status >= 400) throw new McpError(`The data server returned HTTP ${response.status}.`);
      const message = parseRpcBody(response.text);
      if (message.error) throw new McpError(message.error.message || "The data tool returned an error.");
      const result = message.result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | undefined;
      const text = (result?.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
      if (result?.isError) throw new McpError(text.slice(0, 200) || "The data tool reported an error.");
      return text;
    } finally {
      active.inflight -= 1;
      if (active.inflight === 0 && sessions.get(url) === active) scheduleIdleClose(url, active);
    }
  }
  throw new McpError("The data server session could not be established.");
}

export function resetMcpSessionsForTests() {
  for (const session of sessions.values()) if (session.idleTimer) clearTimeout(session.idleTimer);
  sessions.clear();
  opening.clear();
}

/** A single investigation lookup: independent session, no retry, one shared abort signal across
 * handshake and tool request. Cancelling it cannot interrupt another visitor's shared session. */
export async function callMcpToolOnce(url: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  let id: string | null = null;
  try {
    signal.throwIfAborted();
    const init = await post(url, { jsonrpc: "2.0", id: ++requestCounter, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "thesisgate-investigation", version: "1" } } }, null, 8_000, signal);
    id = init.sessionId;
    if (init.status >= 400 || parseRpcBody(init.text).error) throw new McpError("Investigation data session unavailable.");
    await post(url, { jsonrpc: "2.0", method: "notifications/initialized" }, id, 8_000, signal);
    const response = await post(url, { jsonrpc: "2.0", id: ++requestCounter, method: "tools/call", params: { name, arguments: args } }, id, 8_000, signal);
    if (response.status >= 400) throw new McpError(`Investigation lookup failed (HTTP ${response.status}).`);
    const rpc = parseRpcBody(response.text);
    const result = rpc.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean } | undefined;
    if (rpc.error || result?.isError) throw new McpError("Investigation data tool failed.");
    return (result?.content ?? []).filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n");
  } finally {
    await closeSession(url, id);
  }
}
