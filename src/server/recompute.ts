import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Instrument, MarketSnapshot } from "@/domain/contracts";
import { sha256 } from "./identifiers";

const RECEIPT_VERSION = "v1";
const RECEIPT_PATTERN = /^v1\.([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/;

export class RecomputeReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecomputeReceiptError";
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signingSecret() {
  const configured = process.env.THESIS_RECOMPUTE_SIGNING_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new RecomputeReceiptError("THESIS_RECOMPUTE_SIGNING_SECRET is required for production economics reuse.");
  }
  return "local-development-only-recompute-secret";
}

export function assertRecomputeSigningConfigured() {
  signingSecret();
}

function receiptPayload(instrument: Instrument, snapshot: MarketSnapshot) {
  return stableJson({ instrument, snapshot });
}

function receiptParts(instrument: Instrument, snapshot: MarketSnapshot) {
  const payloadHash = sha256(receiptPayload(instrument, snapshot));
  const signature = createHmac("sha256", signingSecret()).update(payloadHash).digest("base64url");
  return { payloadHash, signature };
}

export function createRecomputeToken(instrument: Instrument, snapshot: MarketSnapshot) {
  const { payloadHash, signature } = receiptParts(instrument, snapshot);
  return `${RECEIPT_VERSION}.${payloadHash}.${signature}`;
}

export function verifyRecomputeToken(token: string, instrument: Instrument, snapshot: MarketSnapshot) {
  const match = RECEIPT_PATTERN.exec(token);
  if (!match) return false;
  const { payloadHash, signature } = receiptParts(instrument, snapshot);
  if (match[1] !== payloadHash) return false;
  const received = Buffer.from(match[2], "utf8");
  const expected = Buffer.from(signature, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
