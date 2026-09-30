import type { Asset } from "./contracts";

/**
 * Suggested chat messages shown as buttons. They are shared with the quick-edit fallback's tests so
 * every displayed suggestion is guaranteed to work even when the AI is busy or unavailable.
 */
export const POST_BRIEF_SUGGESTIONS = {
  halveAmount: "What if I only put in half?",
  halveDepth: "What if exit liquidity halves?",
  bidsRise: "What if bids only rise 1%?",
  refreshLive: "Refresh with live prices",
  useLive: "Use live prices instead",
} as const;

export const RUN_CHECKS = "Run the checks";

export function switchAssetSuggestion(current: Asset) {
  return `Switch to r${current === "NVDA" ? "TSLA" : "NVDA"}`;
}
