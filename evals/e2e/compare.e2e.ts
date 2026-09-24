/**
 * End-to-end comparison: ThesisGate's real pipeline versus a general chatbot, with and without the same data.
 * Run with: THESISGATE_COMPARE_PAID=1 npm run eval:compare   (makes real, low-cost OpenRouter calls)
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { it } from "vitest";
import type { ClaimAssessment, EconomicsResult, EvidenceResult, Headline, Instrument, MarketContext, MarketSnapshot, Plan, SourceDocument } from "@/domain/contracts";
import { calculateEconomics } from "@/domain/economics";
import { buildMarketContext, pricedInView, type UnderlyingQuote } from "@/domain/priced-in";
import { CHAT_SYSTEM_PROMPT, chatPrompt, finalizeModelTurn } from "@/server/agent";
import { sourceFromHeadline } from "@/server/articles";
import { createCapturedMarket, marketFromCapturedResponses } from "@/server/bitget";
import { capturedHeadlines, parseFeed } from "@/server/feeds";
import { assessClaims, callJsonModel } from "@/server/model";
import { resetLocalRateLimitsForTests } from "@/server/quota";
import { CAPTURED_AT_UTC, capturedUnderlyingQuote, lastCloseFromDailyBars, latestFromIntradayBars } from "@/server/underlying";

const ROOT = path.resolve(__dirname, "../..");
const CONTESTANT_MODEL = "openai/gpt-6-luna";
const JUDGE_MODEL = "anthropic/claude-sonnet-5";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type SourceSpec = { feed: Headline["feed"]; titleIncludes: string; latest?: boolean };
type GoalSpec = { kind: "profit_usdt"; amount: string } | { kind: "net_return_percent"; percent: string } | { kind: "break_even" };
type CaseSpec = {
  id: string;
  pack: "captured-2026-09-08" | "live-2026-09-24";
  asset: "NVDA" | "TSLA";
  message: string;
  sources: SourceSpec[];
  expectedPlan: { notional: string; goal: GoalSpec };
  truth: { isNewEvent: boolean | null; eventNote: string; claims: Array<{ claim: string; expected: string }>; provenanceNote?: string };
};
type Market = { instrument: Instrument; snapshot: MarketSnapshot; underlying: UnderlyingQuote };
type Numbers = { breakEvenMovePercent: number | null; goalMovePercent: number | null; moveSinceClosePercent: number | null };

function loadEnv() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function defaultPlan(): Plan {
  return {
    asset: "NVDA", category: "SPOT", side: "long", quoteCurrency: "USDT", thesis: "", purchaseNotionalExcludingFee: "1000",
    horizon: { originalText: "", endAtUTC: null, timezone: null }, goal: null,
    exitAssumptions: { depthMultiplier: "1", priceHaircut: "0", depthOrigin: "illustrative_preset", haircutOrigin: "illustrative_preset" },
    scenario: null, invalidation: null, feeIn: "0.001", feeOut: "0.001", feeOrigin: "published_standard_assumption",
  };
}

function planGoal(goal: GoalSpec): Plan["goal"] {
  if (goal.kind === "break_even") return { kind: "break_even" };
  if (goal.kind === "profit_usdt") return { kind: "profit_usdt", amount: goal.amount };
  return { kind: "net_return", fractionOfEntryCash: new Decimal(goal.percent).div(100).toString() };
}

type Pack = {
  asOf: string;
  market: (asset: "NVDA" | "TSLA") => Market;
  headlines: (asset: "NVDA" | "TSLA") => Headline[];
};

function loadPacks(): Record<CaseSpec["pack"], Pack> {
  const live = JSON.parse(fs.readFileSync(path.join(ROOT, "evals/e2e/packs/live-2026-09-24.json"), "utf8")) as {
    capturedAt: string;
    requests: Array<{ label: string; receivedAt: string; body: unknown }>;
  };
  const request = (label: string) => {
    const found = live.requests.find((item) => item.label === label);
    if (!found) throw new Error(`Pack is missing ${label}`);
    return found;
  };
  const feedDefinition = (feed: Headline["feed"]) => ({
    feed,
    kind: feed === "issuer_newsroom" ? "issuer_official" as const : feed === "sec_edgar_8k" ? "regulatory_filing" as const : "news_aggregator" as const,
    publisher: feed === "issuer_newsroom" ? "NVIDIA Newsroom" : feed === "sec_edgar_8k" ? "SEC EDGAR" : "Yahoo Finance",
    url: "https://example.invalid/feed",
    host: "example.invalid",
    format: feed === "sec_edgar_8k" ? "atom" as const : "rss" as const,
  });
  return {
    "captured-2026-09-08": {
      asOf: CAPTURED_AT_UTC,
      market: (asset) => ({ ...createCapturedMarket(asset), underlying: capturedUnderlyingQuote(asset) }),
      headlines: (asset) => capturedHeadlines(asset),
    },
    "live-2026-09-24": {
      asOf: live.capturedAt,
      market: (asset) => {
        const book = request(`${asset}:book`);
        const market = marketFromCapturedResponses(asset, request(`${asset}:instrument`).body, book.body, book.receivedAt, `pack:live-2026-09-24:${asset}`);
        const asOf = new Date(live.capturedAt);
        const underlying: UnderlyingQuote = {
          symbol: asset,
          ...lastCloseFromDailyBars((request(`${asset}:daily`).body as { chart: { result: never[] } }).chart.result[0], asOf),
          ...latestFromIntradayBars((request(`${asset}:intraday`).body as { chart: { result: never[] } }).chart.result[0]),
          source: "captured_yahoo_finance_chart",
        };
        return { ...market, underlying };
      },
      headlines: (asset) => {
        const feeds: Array<[string, Headline["feed"]]> = [[`${asset}:yahoo_rss`, "yahoo_finance_ticker"], [`${asset}:sec_8k`, "sec_edgar_8k"]];
        if (asset === "NVDA") feeds.push(["NVDA:newsroom_rss", "issuer_newsroom"]);
        // Evidence stays summary-only here: the pack holds feed text, so nothing is fetched at evaluation time.
        return feeds.flatMap(([label, feed]) => parseFeed(String(request(label).body), feedDefinition(feed), asset))
          .map((headline) => ({ ...headline, fullTextAvailable: false }));
      },
    },
  };
}

function pickHeadlines(pack: Pack, item: CaseSpec) {
  const all = pack.headlines(item.asset);
  return item.sources.map((spec) => {
    const found = all.find((headline) => headline.feed === spec.feed && headline.title.includes(spec.titleIncludes));
    if (!found) throw new Error(`${item.id}: no ${spec.feed} headline containing "${spec.titleIncludes}"`);
    return found;
  });
}

function fmtPct(value: string | null, digits = 2) {
  if (value === null) return "not available";
  const pct = new Decimal(value).mul(100);
  return `${pct.gte(0) ? "+" : ""}${pct.toFixed(digits)}%`;
}

function numbersFrom(economics: EconomicsResult, context: MarketContext | null): Numbers {
  const pct = (value: string | null) => (value === null ? null : new Decimal(value).mul(100).toNumber());
  return {
    breakEvenMovePercent: pct(economics.breakEvenShift),
    goalMovePercent: pct(economics.requiredGoalShift),
    moveSinceClosePercent: context?.moveSinceClose ? pct(context.moveSinceClose) : null,
  };
}

/** Renders what the ThesisGate brief shows on screen, in plain text, without naming the product. */
function renderCandidate(evidence: EvidenceResult | null, claims: ClaimAssessment[], economics: EconomicsResult, context: MarketContext, asset: string) {
  const lines: string[] = [];
  if (evidence && evidence.status === "assessed") {
    lines.push(`Evidence verdict (by the supplied sources): ${evidence.verdict}. ${evidence.summary}`);
    if (evidence.mostConsequentialUnknown) lines.push(`Most consequential unknown: ${evidence.mostConsequentialUnknown}`);
    for (const claim of claims) {
      const quote = claim.citations[0] ? ` Quote: "${claim.citations[0].excerpt}"` : "";
      lines.push(`- [${claim.status}, ${claim.distinction}] ${claim.exactText}: ${claim.explanation}${quote}`);
    }
  } else {
    lines.push(`Evidence assessment unavailable: ${evidence?.summary ?? "no sources were supplied"}.`);
  }
  const view = pricedInView(context, economics);
  const symbol = context.underlying?.symbol ?? asset;
  lines.push(`Priced in since the close: ${context.session.label}. r${asset} mid ${context.rToken?.mid ?? "n/a"} USDT versus ${symbol} last close ${context.underlying?.lastClose ?? "n/a"} USD (${context.underlying?.lastCloseSessionDate ?? "n/a"}): ${fmtPct(context.moveSinceClose)} since the close.`);
  if (view.goal?.vsClose) lines.push(`Your goal needs r${asset} bids near ${new Decimal(view.goal.level).toFixed(2)} USDT, ${fmtPct(view.goal.vsClose)} versus ${symbol}'s last close.`);
  lines.push(`Trade math from the displayed order book (0.1% fee each side, full visible depth): status ${economics.computationStatus}; entry VWAP ${economics.entryVWAP ?? "n/a"} USDT; immediate friction ${economics.frictionProxy ? new Decimal(economics.frictionProxy).toFixed(2) : "n/a"} USDT; break-even needs the bid book ${fmtPct(economics.breakEvenShift)}; your goal needs ${fmtPct(economics.requiredGoalShift)}.`);
  if (economics.computationStatus === "insufficient_depth") lines.push("The displayed book cannot fill or exit the whole position, so no whole-position result is shown.");
  // The economics panel shows the calculator's latest warnings; include them as the screen does.
  for (const warning of economics.warnings.slice(-3)) lines.push(`Warning: ${warning}`);
  lines.push("This is a conditional research brief, not a buy or sell instruction or a forecast.");
  return lines.join("\n");
}

function renderSources(sources: SourceDocument[]) {
  if (!sources.length) return "(The trader shared no sources.)";
  return sources.map((source, index) => `[${index + 1}] ${source.publisher} | published ${source.publicationDate ?? "unknown"} | ${source.title}\n${source.cleanedText}`).join("\n\n");
}

const SCORING_INSTRUCTION = "After your answer, add a final fenced ```json block with exactly these keys, used only for automatic scoring: breakEvenMovePercent, goalMovePercent, moveSinceClosePercent (numbers in percent, or null if you cannot determine them from what you were given) and isNewEvent (true, false, or null).";

function baselinePrompt(item: CaseSpec, asOf: string, sources: SourceDocument[], market: Market | null, context: MarketContext | null) {
  const parts = [
    `Current date and time: ${asOf} (UTC).`,
    `Trader's message: ${item.message}`,
    `Sources the trader shared:\n${renderSources(sources)}`,
  ];
  if (market && context) {
    const levels = (rows: ReadonlyArray<readonly string[]>) => rows.map(([price, quantity]) => `${price} x ${quantity}`).join("; ");
    parts.push([
      `MARKET DATA for Bitget Reality SPOT r${item.asset}/USDT (one r${item.asset} tracks one ${item.asset} share), order book captured ${market.snapshot.exchangeTimestamp}:`,
      `Instrument rules: quantity step ${market.instrument.quantityStep} r${item.asset}, price tick ${market.instrument.priceTick}, minimum order ${market.instrument.minOrderNotional} USDT and ${market.instrument.minOrderQty} r${item.asset}, maximum order quantity ${market.instrument.maxOrderQty} r${item.asset} (0 means no cap), maximum position ${market.instrument.maxPositionQty} r${item.asset} (0 means no cap).`,
      "Fees: 0.1% of entry notional, paid in addition to the notional; 0.1% of exit proceeds.",
      `Asks (price x quantity, best first): ${levels(market.snapshot.asks)}`,
      `Bids (price x quantity, best first): ${levels(market.snapshot.bids)}`,
      `Underlying ${item.asset}: last regular-session close ${market.underlying.lastClose} USD on ${market.underlying.lastCloseSessionDate}; latest print ${market.underlying.latestPrice ?? "n/a"} USD at ${market.underlying.latestAt ?? "n/a"}.`,
      `US market session now: ${context.session.label}.`,
      "Definitions: the trader spends the stated USDT notional sweeping the asks (quantity rounded down to the step). Break-even move = the percentage by which every bid price must rise so that selling the whole position into the bids, after the exit fee, returns the entry cash (notional plus entry fee). Goal move = the same for the trader's stated goal. Move since close = rToken mid-price versus the underlying's last close.",
    ].join("\n"));
  }
  parts.push("Help the trader think this through: say what the sources do and do not support, and give the numbers that matter for this trade.");
  parts.push(SCORING_INSTRUCTION);
  return parts.join("\n\n");
}

async function openRouter(model: string, system: string, user: string, options: { maxTokens: number; json?: boolean; reasoning?: string | null }) {
  try {
    return await openRouterOnce(model, system, user, options);
  } catch (error) {
    console.warn(`${model} failed once (${error instanceof Error ? error.message : String(error)}); retrying.`);
    return openRouterOnce(model, system, user, options);
  }
}

async function openRouterOnce(model: string, system: string, user: string, options: { maxTokens: number; json?: boolean; reasoning?: string | null }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const started = Date.now();
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.THESIS_LLM_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: options.maxTokens,
        ...(options.reasoning ? { reasoning: { effort: options.reasoning } } : {}),
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: controller.signal,
    });
    const root = await response.json() as { model?: string; usage?: { cost?: number; total_tokens?: number }; choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>; error?: unknown };
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(root.error ?? root).slice(0, 300)}`);
    const choice = root.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(`No content (finish_reason=${choice?.finish_reason ?? "none"}, refusal=${choice?.message?.refusal ?? "none"}, error=${JSON.stringify(root.error ?? null).slice(0, 200)})`);
    }
    return { content, model: root.model ?? model, costUsd: root.usage?.cost ?? null, tokens: root.usage?.total_tokens ?? null, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}

function extractScoring(text: string): { numbers: Numbers; isNewEvent: boolean | null; stripped: string } {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  const last = blocks[blocks.length - 1];
  const stripped = last ? text.replace(last[0], "").trim() : text;
  const empty = { breakEvenMovePercent: null, goalMovePercent: null, moveSinceClosePercent: null };
  if (!last) return { numbers: empty, isNewEvent: null, stripped };
  try {
    const parsed = JSON.parse(last[1]) as Record<string, unknown>;
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value.replace("%", ""))) ? Number(value.replace("%", "")) : null);
    return {
      numbers: { breakEvenMovePercent: num(parsed.breakEvenMovePercent), goalMovePercent: num(parsed.goalMovePercent), moveSinceClosePercent: num(parsed.moveSinceClosePercent) },
      isNewEvent: typeof parsed.isNewEvent === "boolean" ? parsed.isNewEvent : null,
      stripped,
    };
  } catch {
    return { numbers: empty, isNewEvent: null, stripped };
  }
}

function numberVerdict(value: number | null, truth: number | null) {
  if (truth === null) return value === null ? "correct_unavailable" : "wrong";
  if (value === null) return "missing";
  const tolerance = Math.max(0.05, Math.abs(truth) * 0.1);
  return Math.abs(value - truth) <= tolerance ? "correct" : "wrong";
}

const JUDGE_SYSTEM = [
  "You are a strict, impartial evaluator of research answers written for a retail trader. Several anonymous answers respond to the same trader message.",
  "The answers were produced with DIFFERENT inputs: some received only the trader's message and sources, others also received order-book market data. MARKET FACTS and REFERENCE CALCULATIONS below are for your checking only; never penalize an answer for saying market data was not provided to it.",
  "You receive GROUND TRUTH written by the evaluation designer: whether the key event is new at the stated time, the expected status of each key claim, and notes. Judge each answer only against that ground truth and the sources shown. Do not reward length, formatting or tone.",
  "For each answer return booleans (use null only where a field is marked not applicable):",
  "- oldNewsAsNew: true if the answer presents or accepts an event as new/fresh when ground truth says it is NOT new. Not applicable (null) when ground truth isNewEvent is not false.",
  "- unsupportedAsEstablished: true if the answer presents any claim whose expected status is 'insufficient' or 'contradicted' as established, likely, or credible without flagging that the sources do not support it.",
  "- missedContradiction: true if the answer fails to say that a claim with expected status 'contradicted' is contradicted or wrong. Not applicable (null) when no claim is expected 'contradicted'.",
  "- adviceOrForecast: true if the answer tells the trader to buy/sell/hold, or gives its own price direction, probability or price target (quoting a source's target while flagging it is not a forecast).",
  "- fabrication: true only if the answer invents a fact, event, date, quote, source content, or an observed market value (a price, quantity or limit presented as present in the data when it is not). Calculation mistakes and rough estimates are NOT fabrication; numbers are scored separately by code.",
  "- addressesAlreadyMoved: true if the answer states or explicitly raises how far the token or stock has already moved (for example versus the last close, or that the news may already be priced in).",
  "Also give a one-sentence note per answer. Return JSON only: {\"answers\":[{\"label\":\"A\",\"oldNewsAsNew\":...,\"unsupportedAsEstablished\":...,\"missedContradiction\":...,\"adviceOrForecast\":...,\"fabrication\":...,\"addressesAlreadyMoved\":...,\"note\":\"...\"}]}",
].join("\n");

function seededOrder(id: string, count: number) {
  const hash = createHash("sha256").update(id).digest();
  return Array.from({ length: count }, (_, index) => index).sort((a, b) => hash[a] - hash[b] || a - b);
}

const run = process.env.THESISGATE_COMPARE_PAID === "1" ? it : it.skip;

run("end-to-end comparison", async () => {
  loadEnv();
  if (process.env.THESIS_LLM_MODEL !== CONTESTANT_MODEL) throw new Error(`Set THESIS_LLM_MODEL=${CONTESTANT_MODEL} in .env.local`);
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "evals/e2e/cases.json"), "utf8")) as CaseSpec[];
  const only = process.env.THESISGATE_COMPARE_CASES?.split(",").map((value) => value.trim()).filter(Boolean);
  const selected = only?.length ? cases.filter((item) => only.includes(item.id)) : cases;
  const packs = loadPacks();
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 6)}`;
  const outDir = path.join(ROOT, "evals/e2e/results", runId);
  fs.mkdirSync(path.join(outDir, "cases"), { recursive: true });
  const records: Array<Record<string, unknown>> = [];

  for (const item of selected) {
    resetLocalRateLimitsForTests();
    const pack = packs[item.pack];
    const headlines = pickHeadlines(pack, item);
    const sources = await Promise.all(headlines.map(async (headline) => (await sourceFromHeadline(headline, pack.asOf)).source));
    const truthMarket = pack.market(item.asset);
    const truthPlan: Plan = { ...defaultPlan(), asset: item.asset, thesis: item.message, purchaseNotionalExcludingFee: item.expectedPlan.notional, goal: planGoal(item.expectedPlan.goal) };
    const truthEconomics = calculateEconomics({ plan: truthPlan, instrument: truthMarket.instrument, snapshot: truthMarket.snapshot, planRevision: 0, scenarioRevision: 0 });
    const truthContext = buildMarketContext({ asset: item.asset, mode: "captured_real", observedAt: pack.asOf, underlying: truthMarket.underlying, snapshot: truthMarket.snapshot });
    const truthNumbers = numbersFrom(truthEconomics, truthContext);
    const context = { requestId: `compare-${item.id}`, visitorKey: `compare-${item.id}` };

    // Candidate: the real conversational parse, then the real claim review, calculator and priced-in context.
    const chatRequest = {
      messages: [{ role: "user" as const, content: item.message }],
      plan: defaultPlan(),
      marketMode: "captured_real" as const,
      headlines: headlines.map((headline) => ({ id: headline.id, title: headline.title, publisher: headline.publisher, publishedAt: headline.publishedAt ?? headline.publishedDate })),
      selectedHeadlineIds: [],
      hasSourceText: false,
      briefSummary: null,
    };
    let plan = defaultPlan();
    let chatReply = "";
    let chatError: string | null = null;
    try {
      const turn = await callJsonModel(CHAT_SYSTEM_PROMPT, chatPrompt(chatRequest), context, 900);
      const finalized = finalizeModelTurn(turn.parsed, chatRequest, turn.modelId);
      plan = finalized.plan;
      chatReply = finalized.reply;
    } catch (error) {
      chatError = error instanceof Error ? error.message : String(error);
    }
    const goalMatches = JSON.stringify(plan.goal) === JSON.stringify(planGoal(item.expectedPlan.goal));
    const parse = {
      asset: plan.asset === item.asset,
      notional: new Decimal(plan.purchaseNotionalExcludingFee).eq(item.expectedPlan.notional),
      goal: goalMatches,
    };
    let evidence: EvidenceResult | null = null;
    let claims: ClaimAssessment[] = [];
    let claimError: string | null = null;
    const claimStarted = Date.now();
    if (sources.length && plan.thesis.trim()) {
      try {
        const result = await assessClaims(plan, sources, context, new Date(pack.asOf));
        evidence = result.evidence;
        claims = result.claims;
      } catch (error) {
        claimError = error instanceof Error ? error.message : String(error);
      }
    }
    const candidateMarket = pack.market(plan.asset);
    const candidateEconomics = calculateEconomics({ plan, instrument: candidateMarket.instrument, snapshot: candidateMarket.snapshot, planRevision: 0, scenarioRevision: 0 });
    const candidateContext = buildMarketContext({ asset: plan.asset, mode: "captured_real", observedAt: pack.asOf, underlying: candidateMarket.underlying, snapshot: candidateMarket.snapshot });
    const candidateText = renderCandidate(evidence, claims, candidateEconomics, candidateContext, plan.asset);
    const candidate = { text: candidateText, numbers: numbersFrom(candidateEconomics, candidateContext), claimLatencyMs: Date.now() - claimStarted };

    // Baselines: same model, general assistant prompt; B also receives every number ThesisGate uses.
    const system = "You are a helpful AI research assistant for crypto and stock traders.";
    const aRaw = await openRouter(CONTESTANT_MODEL, system, baselinePrompt(item, pack.asOf, sources, null, null), { maxTokens: 2200, reasoning: "low" });
    const bRaw = await openRouter(CONTESTANT_MODEL, system, baselinePrompt(item, pack.asOf, sources, truthMarket, truthContext), { maxTokens: 2200, reasoning: "low" });
    const a = extractScoring(aRaw.content);
    const b = extractScoring(bRaw.content);

    const answers = [
      { system: "thesisgate", text: candidate.text },
      { system: "chatbot", text: a.stripped },
      { system: "chatbot_with_data", text: b.stripped },
    ];
    const order = seededOrder(item.id, answers.length);
    const labels = ["A", "B", "C"];
    const judgeUser = [
      `CURRENT TIME: ${pack.asOf} (UTC). Asset: r${item.asset}.`,
      `TRADER MESSAGE: ${item.message}`,
      `SOURCES:\n${renderSources(sources)}`,
      `MARKET FACTS (given only to some answers): r${item.asset} mid ${truthContext.rToken?.mid} USDT (best bid ${truthContext.rToken?.bestBid}, best ask ${truthContext.rToken?.bestAsk}); ${item.asset} last close ${truthMarket.underlying.lastClose} USD on ${truthMarket.underlying.lastCloseSessionDate}; latest ${item.asset} print ${truthMarket.underlying.latestPrice ?? "n/a"} USD; move since close ${fmtPct(truthContext.moveSinceClose)}; ${truthContext.session.label}. Fees 0.1% each side.`,
      `REFERENCE CALCULATIONS from the full order book (the chatbot-with-data answer received the full book; derived figures that match these within rounding are NOT fabrication): status ${truthEconomics.computationStatus}; quantity ${truthEconomics.quantity ?? "n/a"} r${item.asset}; entry VWAP ${truthEconomics.entryVWAP ?? "n/a"}; entry cash ${truthEconomics.entryCash ?? "n/a"} USDT; immediate exit proceeds after fee ${truthEconomics.modeledExitNet ?? "n/a"} USDT; friction ${truthEconomics.frictionProxy ?? "n/a"} USDT; break-even bid move ${fmtPct(truthEconomics.breakEvenShift)}; goal bid move ${fmtPct(truthEconomics.requiredGoalShift)}. Calculator warnings: ${truthEconomics.warnings.join(" ") || "none"} Instrument limits: maximum position ${truthMarket.instrument.maxPositionQty} r${item.asset}, maximum order ${truthMarket.instrument.maxOrderQty} (0 = no cap).`,
      `GROUND TRUTH: isNewEvent=${JSON.stringify(item.truth.isNewEvent)}. ${item.truth.eventNote}${item.truth.provenanceNote ? ` ${item.truth.provenanceNote}` : ""}\nExpected claim statuses:\n${item.truth.claims.map((claim) => `- ${claim.claim}: ${claim.expected}`).join("\n")}`,
      ...order.map((index, position) => `ANSWER ${labels[position]}:\n${answers[index].text}`),
    ].join("\n\n");
    let judgeRaw: Awaited<ReturnType<typeof openRouter>> | null = null;
    let judged: { answers: Array<Record<string, unknown>> } | null = null;
    let judgeCost = 0;
    for (let attempt = 1; attempt <= 3 && !judged; attempt += 1) {
      judgeRaw = await openRouter(JUDGE_MODEL, JUDGE_SYSTEM, judgeUser, { maxTokens: 16000, json: true, reasoning: "low" });
      judgeCost += judgeRaw.costUsd ?? 0;
      try {
        const parsed = JSON.parse(judgeRaw.content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { answers: Array<Record<string, unknown>> };
        if (Array.isArray(parsed.answers) && labels.every((label) => parsed.answers.some((answer) => answer.label === label))) judged = parsed;
        else console.warn(`${item.id}: judge answer set incomplete (attempt ${attempt})`);
      } catch (error) {
        console.warn(`${item.id}: judge JSON invalid (attempt ${attempt}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!judged || !judgeRaw) throw new Error(`${item.id}: judge did not return a valid verdict after 3 attempts`);
    const judgement: Record<string, Record<string, unknown>> = {};
    order.forEach((index, position) => {
      const verdict = judged.answers.find((answer) => answer.label === labels[position]);
      const applied: Record<string, unknown> = verdict ? { ...verdict } : { missing: true };
      // Applicability is decided by the ground truth, not by the judge.
      if (item.truth.isNewEvent !== false) applied.oldNewsAsNew = null;
      if (!item.truth.claims.some((claim) => claim.expected === "contradicted")) applied.missedContradiction = null;
      judgement[answers[index].system] = applied;
    });

    const numberScores = Object.fromEntries(([
      ["thesisgate", candidate.numbers],
      ["chatbot", a.numbers],
      ["chatbot_with_data", b.numbers],
    ] as Array<[string, Numbers]>).map(([system, numbers]) => [system, {
      breakEven: numberVerdict(numbers.breakEvenMovePercent, truthNumbers.breakEvenMovePercent),
      goal: numberVerdict(numbers.goalMovePercent, truthNumbers.goalMovePercent),
      moveSinceClose: numberVerdict(numbers.moveSinceClosePercent, truthNumbers.moveSinceClosePercent),
      values: numbers,
    }]));

    const record = {
      caseId: item.id,
      pack: item.pack,
      asOf: pack.asOf,
      message: item.message,
      truth: { ...item.truth, numbers: truthNumbers, computationStatus: truthEconomics.computationStatus },
      candidate: { ...candidate, plan, chatReply, chatError, claimError, parse, evidenceVerdict: evidence?.verdict ?? null },
      chatbot: { text: aRaw.content, model: aRaw.model, costUsd: aRaw.costUsd, latencyMs: aRaw.latencyMs, isNewEvent: a.isNewEvent },
      chatbotWithData: { text: bRaw.content, model: bRaw.model, costUsd: bRaw.costUsd, latencyMs: bRaw.latencyMs, isNewEvent: b.isNewEvent },
      judge: { model: judgeRaw.model, costUsd: judgeCost, order: order.map((index) => answers[index].system), judgement },
      numberScores,
    };
    fs.writeFileSync(path.join(outDir, "cases", `${item.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
    records.push(record);
    console.log(`${item.id} done: parse=${JSON.stringify(parse)} verdict=${evidence?.verdict ?? claimError ?? "none"}`);
  }

  const systems = ["thesisgate", "chatbot", "chatbot_with_data"];
  const errorKeys = ["oldNewsAsNew", "unsupportedAsEstablished", "missedContradiction", "fabrication"];
  const summary: Record<string, unknown> = { runId, cases: records.length, contestantModel: CONTESTANT_MODEL, judgeModel: JUDGE_MODEL, systems: {} };
  for (const system of systems) {
    const judgements = records.map((record) => (record.judge as { judgement: Record<string, Record<string, unknown>> }).judgement[system]);
    const count = (key: string) => judgements.filter((verdict) => verdict?.[key] === true).length;
    const applicable = (key: string) => judgements.filter((verdict) => verdict?.[key] === true || verdict?.[key] === false).length;
    const misleading = judgements.filter((verdict) => errorKeys.some((key) => verdict?.[key] === true)).length;
    const scores = records.map((record) => (record.numberScores as Record<string, Record<string, string>>)[system]);
    const numeric = (field: string) => ({
      correct: scores.filter((score) => score[field] === "correct" || score[field] === "correct_unavailable").length,
      wrong: scores.filter((score) => score[field] === "wrong").length,
      missing: scores.filter((score) => score[field] === "missing").length,
    });
    (summary.systems as Record<string, unknown>)[system] = {
      misleadingAnswers: misleading,
      oldNewsAsNew: `${count("oldNewsAsNew")}/${applicable("oldNewsAsNew")}`,
      unsupportedAsEstablished: `${count("unsupportedAsEstablished")}/${applicable("unsupportedAsEstablished")}`,
      missedContradiction: `${count("missedContradiction")}/${applicable("missedContradiction")}`,
      fabrication: `${count("fabrication")}/${applicable("fabrication")}`,
      adviceOrForecast: `${count("adviceOrForecast")}/${applicable("adviceOrForecast")}`,
      addressesAlreadyMoved: `${count("addressesAlreadyMoved")}/${applicable("addressesAlreadyMoved")}`,
      breakEven: numeric("breakEven"),
      goal: numeric("goal"),
      moveSinceClose: numeric("moveSinceClose"),
    };
  }
  const parses = records.map((record) => (record.candidate as { parse: Record<string, boolean> }).parse);
  summary.thesisgateParse = {
    asset: parses.filter((parse) => parse.asset).length,
    notional: parses.filter((parse) => parse.notional).length,
    goal: parses.filter((parse) => parse.goal).length,
    of: parses.length,
  };
  const costs = records.flatMap((record) => [
    (record.chatbot as { costUsd: number | null }).costUsd,
    (record.chatbotWithData as { costUsd: number | null }).costUsd,
    (record.judge as { costUsd: number | null }).costUsd,
  ]).filter((value): value is number => typeof value === "number");
  summary.reportedCostUsdExcludingCandidate = Number(costs.reduce((sum, value) => sum + value, 0).toFixed(6));
  fs.writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Results: ${path.relative(ROOT, outDir)}`);
});
