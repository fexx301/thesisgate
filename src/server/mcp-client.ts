import "server-only";

/**
 * Minimal MCP (streamable HTTP) client for the two public Bitget Agent Hub data servers.
 * Only allowlisted hosts are contacted; sessions are reused briefly; bodies are size-capped.
 */
const ALLOWED_HOSTS = new Set(["agent.bitget.com", "datahub.noxiaohao.com"]);
const SESSION_TTL_MS = 10 * 60_000;
const MAX_BODY_BYTES = 2_000_000;
const PROTOCOL_VERSION = "2025-06-18";

export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpError";
  }
}

const sessions = new Map<string, { id: string | null; createdAt: number }>();
// Concurrent calls share one in-flight handshake instead of racing to open several sessions.
const opening = new Map<string, Promise<{ id: string | null; createdAt: number }>>();
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

async function post(url: string, payload: unknown, sessionId: string | null, timeoutMs: number) {
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
      signal: controller.signal,
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

async function openSession(url: string, timeoutMs: number) {
  const init = await post(url, {
    jsonrpc: "2.0",
    id: ++requestCounter,
    method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "thesisgate", version: "0.3" } },
  }, null, timeoutMs);
  if (init.status >= 400) throw new McpError(`The data server refused the session (HTTP ${init.status}).`);
  parseRpcBody(init.text);
  await post(url, { jsonrpc: "2.0", method: "notifications/initialized" }, init.sessionId, timeoutMs);
  const session = { id: init.sessionId, createdAt: Date.now() };
  sessions.set(url, session);
  return session;
}

/** Calls one MCP tool and returns the text content of its result. Retries once with a fresh session. */
export async function callMcpTool(url: string, name: string, args: Record<string, unknown>, timeoutMs = 20_000): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let session = sessions.get(url);
    if (!session || Date.now() - session.createdAt > SESSION_TTL_MS || attempt > 0) {
      if (attempt > 0) sessions.delete(url);
      session = await sharedSession(url, timeoutMs);
    }
    const response = await post(url, { jsonrpc: "2.0", id: ++requestCounter, method: "tools/call", params: { name, arguments: args } }, session.id, timeoutMs);
    if (response.status === 404 || response.status === 400) {
      sessions.delete(url);
      continue;
    }
    if (response.status >= 400) throw new McpError(`The data server returned HTTP ${response.status}.`);
    const message = parseRpcBody(response.text);
    if (message.error) throw new McpError(message.error.message || "The data tool returned an error.");
    const result = message.result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | undefined;
    const text = (result?.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
    if (result?.isError) throw new McpError(text.slice(0, 200) || "The data tool reported an error.");
    return text;
  }
  throw new McpError("The data server session could not be established.");
}

export function resetMcpSessionsForTests() {
  sessions.clear();
  opening.clear();
}
