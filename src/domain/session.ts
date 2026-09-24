import type { SessionState } from "./contracts";

// NYSE/Nasdaq full-day closures and 13:00 ET early closes. Dates outside this table are
// treated as ordinary weekdays, so the calendar must be extended before 2028.
const FULL_CLOSURES = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const EARLY_CLOSES = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

const PRE_OPEN_MINUTES = 4 * 60;
const REGULAR_OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const EARLY_CLOSE_MINUTES = 13 * 60;
const POST_CLOSE_MINUTES = 20 * 60;

export const SESSION_CALENDAR_COVERAGE = { from: "2026-01-01", to: "2027-12-31" };

type NewYorkClock = { date: string; weekday: number; minutes: number };

function newYorkClock(instant: Date): NewYorkClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: weekdays[get("weekday")] ?? 0,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function isTradingDay(date: string, weekday: number) {
  return weekday >= 1 && weekday <= 5 && !FULL_CLOSURES.has(date);
}

function regularCloseMinutes(date: string) {
  return EARLY_CLOSES.has(date) ? EARLY_CLOSE_MINUTES : REGULAR_CLOSE_MINUTES;
}

/** Offset (minutes) of America/New_York from UTC at an instant: -240 in EDT, -300 in EST. */
function newYorkOffsetMinutes(instant: Date) {
  const clock = newYorkClock(instant);
  const [year, month, day] = clock.date.split("-").map(Number);
  const asUtc = Date.UTC(year, month - 1, day, Math.floor(clock.minutes / 60), clock.minutes % 60);
  const instantMinute = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - instantMinute) / 60_000);
}

function newYorkWallTimeToUtc(date: string, minutes: number) {
  const [year, month, day] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60));
  // Two passes settle the DST offset for any wall time that exists on that date.
  const firstPass = new Date(guess.getTime() - newYorkOffsetMinutes(guess) * 60_000);
  return new Date(guess.getTime() - newYorkOffsetMinutes(firstPass) * 60_000);
}

export function classifySession(instant: Date): { state: SessionState; underlyingOpen: boolean; label: string; nextRegularOpenAt: string | null } {
  const clock = newYorkClock(instant);
  const tradingDay = isTradingDay(clock.date, clock.weekday);
  let state: SessionState;
  if (!tradingDay) {
    state = clock.weekday === 0 || clock.weekday === 6 ? "weekend" : "holiday";
  } else if (clock.minutes >= REGULAR_OPEN_MINUTES && clock.minutes < regularCloseMinutes(clock.date)) {
    state = "regular";
  } else if (clock.minutes >= PRE_OPEN_MINUTES && clock.minutes < REGULAR_OPEN_MINUTES) {
    state = "pre_market";
  } else if (clock.minutes >= regularCloseMinutes(clock.date) && clock.minutes < POST_CLOSE_MINUTES) {
    state = "post_market";
  } else {
    state = "overnight";
  }
  const labels: Record<SessionState, string> = {
    regular: "US regular session is open",
    pre_market: "US pre-market: thin extended-hours trading only",
    post_market: "US after-hours: thin extended-hours trading only",
    overnight: "US market closed overnight",
    weekend: "US market closed for the weekend",
    holiday: "US market closed for a holiday",
  };
  return {
    state,
    underlyingOpen: state === "regular",
    label: labels[state],
    nextRegularOpenAt: state === "regular" ? null : nextRegularOpen(instant)?.toISOString() ?? null,
  };
}

export function nextRegularOpen(instant: Date): Date | null {
  const clock = newYorkClock(instant);
  const [year, month, day] = clock.date.split("-").map(Number);
  for (let offset = 0; offset < 10; offset += 1) {
    const candidate = new Date(Date.UTC(year, month - 1, day + offset, 12));
    const date = candidate.toISOString().slice(0, 10);
    const weekday = candidate.getUTCDay();
    if (!isTradingDay(date, weekday)) continue;
    const open = newYorkWallTimeToUtc(date, REGULAR_OPEN_MINUTES);
    if (open.getTime() > instant.getTime()) return open;
  }
  return null;
}

/** The UTC instant of a session date's regular close (16:00 ET, or 13:00 ET on early-close days). */
export function regularCloseInstant(date: string) {
  return newYorkWallTimeToUtc(date, regularCloseMinutes(date)).toISOString();
}

/** The New York calendar date of the latest completed regular session at or before an instant. */
export function lastCompletedSessionDate(instant: Date): string | null {
  const clock = newYorkClock(instant);
  const [year, month, day] = clock.date.split("-").map(Number);
  for (let offset = 0; offset < 10; offset += 1) {
    const candidate = new Date(Date.UTC(year, month - 1, day - offset, 12));
    const date = candidate.toISOString().slice(0, 10);
    if (!isTradingDay(date, candidate.getUTCDay())) continue;
    const close = newYorkWallTimeToUtc(date, regularCloseMinutes(date));
    if (close.getTime() <= instant.getTime()) return date;
  }
  return null;
}
