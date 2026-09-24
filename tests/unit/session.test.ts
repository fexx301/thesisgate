import { describe, expect, it } from "vitest";
import { classifySession, lastCompletedSessionDate, nextRegularOpen, regularCloseInstant } from "../../src/domain/session";

describe("US session calendar", () => {
  it("classifies the captured Sep 8 capture as after-hours with the next open on Sep 9", () => {
    const session = classifySession(new Date("2026-09-08T21:51:19Z"));
    expect(session.state).toBe("post_market");
    expect(session.underlyingOpen).toBe(false);
    expect(session.nextRegularOpenAt).toBe("2026-09-09T13:30:00.000Z");
  });

  it("recognizes the regular session, weekends, overnight and holidays", () => {
    expect(classifySession(new Date("2026-09-24T14:30:00Z")).state).toBe("regular");
    expect(classifySession(new Date("2026-09-26T15:00:00Z")).state).toBe("weekend");
    expect(classifySession(new Date("2026-09-25T03:00:00Z")).state).toBe("overnight");
    expect(classifySession(new Date("2026-09-24T12:00:00Z")).state).toBe("pre_market");
    // Labor Day 2026.
    expect(classifySession(new Date("2026-09-07T15:00:00Z")).state).toBe("holiday");
  });

  it("skips weekends and holidays when finding the next open", () => {
    // Saturday Sep 5 -> Labor Day Monday Sep 7 closed -> Tuesday Sep 8 09:30 EDT.
    expect(nextRegularOpen(new Date("2026-09-05T15:00:00Z"))?.toISOString()).toBe("2026-09-08T13:30:00.000Z");
  });

  it("handles the DST change: after November 1, 09:30 ET is 14:30 UTC", () => {
    expect(nextRegularOpen(new Date("2026-11-01T12:00:00Z"))?.toISOString()).toBe("2026-11-02T14:30:00.000Z");
    expect(regularCloseInstant("2026-11-02")).toBe("2026-11-02T21:00:00.000Z");
    expect(regularCloseInstant("2026-11-27")).toBe("2026-11-27T18:00:00.000Z");
  });

  it("returns the latest completed session date, not a session still in progress", () => {
    expect(lastCompletedSessionDate(new Date("2026-09-24T14:30:00Z"))).toBe("2026-09-23");
    expect(lastCompletedSessionDate(new Date("2026-09-24T20:00:01Z"))).toBe("2026-09-24");
    expect(lastCompletedSessionDate(new Date("2026-09-27T12:00:00Z"))).toBe("2026-09-25");
  });
});
