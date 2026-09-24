// Captures a reproducible live case pack: raw Bitget, Yahoo, NVIDIA Newsroom and SEC EDGAR responses.
// Usage: node evals/e2e/capture.mjs <pack-name>
import fs from "node:fs";

const name = process.argv[2] ?? `live-${new Date().toISOString().slice(0, 10)}`;
const secAgent = process.env.THESIS_SEC_USER_AGENT ?? "ThesisGate Fexx301@proton.me";
const requests = [];

async function get(label, url, { accept = "application/json", agent = "Mozilla/5.0 (compatible; ThesisGate eval capture)", json = false } = {}) {
  const response = await fetch(url, { headers: { accept, "user-agent": agent } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  requests.push({ label, url, receivedAt: new Date().toISOString(), body: json ? JSON.parse(text) : text });
  return text;
}

const capturedAt = new Date().toISOString();
for (const [asset, symbol, cik] of [["NVDA", "RNVDAUSDT", "0001045810"], ["TSLA", "RTSLAUSDT", "0001318605"]]) {
  await get(`${asset}:instrument`, `https://api.bitget.com/api/v3/market/instruments?category=SPOT&symbol=${symbol}`, { json: true });
  await get(`${asset}:book`, `https://api.bitget.com/api/v3/market/orderbook?category=SPOT&symbol=${symbol}&limit=50`, { json: true });
  await get(`${asset}:daily`, `https://query1.finance.yahoo.com/v8/finance/chart/${asset}?range=10d&interval=1d`, { json: true });
  await get(`${asset}:intraday`, `https://query1.finance.yahoo.com/v8/finance/chart/${asset}?range=1d&interval=5m&includePrePost=true`, { json: true });
  await get(`${asset}:yahoo_rss`, `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${asset}&region=US&lang=en-US`, { accept: "application/rss+xml" });
  await get(`${asset}:sec_8k`, `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=8-K&dateb=&owner=include&count=6&output=atom`, { accept: "application/atom+xml", agent: secAgent });
}
const newsroom = await get("NVDA:newsroom_rss", "https://nvidianews.nvidia.com/releases.xml", { accept: "application/rss+xml" });
const releaseLinks = [...newsroom.matchAll(/<link>(https:\/\/nvidianews\.nvidia\.com\/news\/[^<]+)<\/link>/g)].map((m) => m[1]).slice(0, 4);
for (const link of releaseLinks) await get(`NVDA:release:${link}`, link, { accept: "text/html" });

const out = `evals/e2e/packs/${name}.json`;
fs.writeFileSync(out, `${JSON.stringify({ name, capturedAt, requests }, null, 1)}\n`);
console.log(out, requests.length, "responses,", releaseLinks.length, "newsroom releases");
