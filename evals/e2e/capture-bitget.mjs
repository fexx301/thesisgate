// Captures Bitget Agent Hub (bitget-mcp-server) records for the comparison, closing the MCP session afterwards.
// Usage: node evals/e2e/capture-bitget.mjs <pack-name>
import fs from "node:fs";

const URL = "https://agent.bitget.com/mcp";
const name = process.argv[2] ?? `bitget-${new Date().toISOString().slice(0, 10)}`;
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };

function rpcBody(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  return JSON.parse(lines.length ? lines[lines.length - 1] : text);
}

const init = await fetch(URL, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "thesisgate-eval-capture", version: "1" } } }) });
const session = init.headers.get("mcp-session-id");
await init.text();
const withSession = { ...headers, "mcp-session-id": session };
await fetch(URL, { method: "POST", headers: withSession, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
const requests = [];
try {
  let id = 2;
  for (const asset of ["NVDA", "TSLA"]) {
    for (const [entry, params] of [["equity_estimates_price_target", { symbol: asset, limit: 20 }], ["equity_calendar", { symbol: asset }]]) {
      const response = await fetch(URL, { method: "POST", headers: withSession, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name: "do_query", arguments: { entry_id: entry, params } } }) });
      const message = rpcBody(await response.text());
      const text = message.result?.content?.map((part) => part.text ?? "").join("") ?? "";
      const envelope = JSON.parse(text);
      requests.push({ label: `${asset}:${entry}`, receivedAt: new Date().toISOString(), rows: envelope?.data?.results ?? [] });
    }
  }
} finally {
  await fetch(URL, { method: "DELETE", headers: { "mcp-session-id": session } });
}
const out = `evals/e2e/packs/${name}.json`;
fs.writeFileSync(out, `${JSON.stringify({ name, capturedAt: new Date().toISOString(), source: URL, requests }, null, 1)}\n`);
console.log(out, requests.map((request) => `${request.label}=${request.rows.length}`).join(" "));
