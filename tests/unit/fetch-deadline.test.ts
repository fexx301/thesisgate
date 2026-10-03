import { afterEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "../../src/server/fetch-text";
afterEach(() => vi.useRealTimers());

describe("optional source deadlines", () => {
  it("rejects the awaited operation when a timeout handler throws, rather than throwing outside its promise", async () => {
    vi.useFakeTimers();
    const pending = withDeadline(new Promise<never>(() => {}), 8000, () => { throw new Error("source timed out"); });
    const assertion = expect(pending).rejects.toThrow("source timed out");
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
  });
  it("still supports an explicit unavailable fallback", async () => {
    vi.useFakeTimers();
    const pending = withDeadline(new Promise<null>(() => {}), 8000, () => null);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toBeNull();
  });
});
