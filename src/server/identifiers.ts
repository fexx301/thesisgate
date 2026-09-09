import "server-only";

import { createHash, randomUUID } from "node:crypto";

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function newId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(value);
}
