const CAPTURED_LIMITATION = "Captured market mode is historical replay data from the selection spike. It is not current market data.";

export function withMarketModeLimitations(limitations: string[], mode: "captured_real" | "live"): string[] {
  const current = limitations.filter((item) => item !== CAPTURED_LIMITATION);
  if (mode === "captured_real") current.push(CAPTURED_LIMITATION);
  return current;
}
