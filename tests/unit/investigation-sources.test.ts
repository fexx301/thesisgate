import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupInvestigation } from "../../src/server/investigation-sources";
import { fetchBoundedText } from "../../src/server/fetch-text";
import { callMcpToolOnce } from "../../src/server/mcp-client";
vi.mock("../../src/server/fetch-text", async (original) => ({ ...await original<typeof import("../../src/server/fetch-text")>(), fetchBoundedText: vi.fn() }));
vi.mock("../../src/server/mcp-client", async (original) => ({ ...await original<typeof import("../../src/server/mcp-client")>(), callMcpToolOnce: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const date = new Date("2026-10-03T12:00:00Z");
const signal = () => new AbortController().signal;

describe("targeted source retrieval", () => {
  it("uses one earnings tool without fetching unrelated signals", async () => {
    vi.mocked(callMcpToolOnce).mockResolvedValue(JSON.stringify({ success: true, data: { results: [{ perf_report_dsclsr_date: "2026-07-22", period_ending: "2026-06-30", fiscal_year: "2026" }] } }));
    const result = await lookupInvestigation("earnings", "TSLA", "Tesla reported earnings today", date, signal());
    expect(callMcpToolOnce).toHaveBeenCalledTimes(1);
    expect(fetchBoundedText).not.toHaveBeenCalled();
    expect(result.sources[0].cleanedText).toContain("2026-07-22");
    expect(result.lookups[0].status).toBe("found");
  });
  it("distinguishes a malformed provider response from a valid empty result", async () => {
    vi.mocked(callMcpToolOnce).mockResolvedValueOnce('{"success":true,"data":{}}').mockResolvedValueOnce('{"success":true,"data":{"results":[]}}');
    expect((await lookupInvestigation("analysts", "NVDA", "Analysts raised targets", date, signal())).lookups[0].status).toBe("failed");
    expect((await lookupInvestigation("analysts", "NVDA", "Analysts raised targets", date, signal())).lookups[0].status).toBe("empty");
  });
  it("retrieves revenue as dated evidence, preserving period durations and excluding future filings", async () => {
    vi.stubEnv("THESIS_SEC_USER_AGENT", "ThesisGate test@example.com");
    vi.mocked(fetchBoundedText).mockResolvedValue({ finalUrl: "https://data.sec.gov/", text: JSON.stringify({ facts: { "us-gaap": { Revenues: { units: { USD: [
      { start: "2026-04-01", end: "2026-06-30", val: 100, filed: "2026-08-01", form: "10-Q", accn: "a" },
      { start: "2026-07-01", end: "2026-09-30", val: 200, filed: "2026-11-01", form: "10-Q", accn: "b" },
    ] } } } } }) });
    const result = await lookupInvestigation("revenue", "NVDA", "NVIDIA reported revenue", date, signal());
    expect(fetchBoundedText).toHaveBeenCalledTimes(1);
    expect(result.sources[0].cleanedText).toContain("100 USD; period 2026-04-01 to 2026-06-30");
    expect(result.sources[0].cleanedText).not.toContain("200 USD");
    expect(result.sources[0].cleanedText).toContain("do not attribute revenue");
  });
  it("does not request SEC without configured contact information", async () => {
    vi.stubEnv("THESIS_SEC_USER_AGENT", "");
    const result = await lookupInvestigation("filings", "TSLA", "Tesla filed an 8-K today", date, signal());
    expect(result.lookups[0].status).toBe("failed"); expect(fetchBoundedText).not.toHaveBeenCalled();
  });
  it("stops after an unrelated newsroom index without a second lookup", async () => {
    vi.mocked(fetchBoundedText).mockResolvedValue({ finalUrl: "https://nvidianews.nvidia.com/releases.xml", text: "<rss><channel><item><title>Unrelated software release</title><link>https://nvidianews.nvidia.com/news/software</link><description>A driver update.</description></item></channel></rss>" });
    const result = await lookupInvestigation("newsroom", "NVDA", "NVIDIA and AWS announced 2 million GPUs today", date, signal());
    expect(fetchBoundedText).toHaveBeenCalledTimes(1); expect(result.sources).toHaveLength(0); expect(result.lookups[0].status).toBe("empty");
  });
  it("honors cancellation before starting transport", async () => {
    const controller = new AbortController(); controller.abort();
    const result = await lookupInvestigation("newsroom", "NVDA", "announcement", date, controller.signal);
    expect(result.lookups[0].status).toBe("failed"); expect(fetchBoundedText).not.toHaveBeenCalled(); expect(callMcpToolOnce).not.toHaveBeenCalled();
  });
});
