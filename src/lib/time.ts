/**
 * Checks that a string is a real IANA timezone name (e.g. "America/New_York"),
 * not just any string. Providers store their timezone this way rather than a
 * fixed UTC offset, because an offset is wrong for half the year wherever
 * daylight saving time applies.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** A calendar date with no time or zone attached, e.g. "2026-03-09". */
export type DateString = string;

export function toDateString(date: Date): DateString {
  return date.toISOString().slice(0, 10);
}

export function addDaysToDateString(dateStr: DateString, days: number): DateString {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return toDateString(new Date(Date.UTC(y, m - 1, d + days)));
}

export function compareDateStrings(a: DateString, b: DateString): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The weekday (0 = Sunday ... 6 = Saturday) of a calendar date, independent
 * of any timezone - a date string like "2026-03-09" is Monday everywhere,
 * so this is plain calendar arithmetic, not a timezone conversion.
 */
export function dayOfWeekFromDateString(dateStr: DateString): number {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The UTC offset of `timeZone`, in minutes east of UTC, as observed at the
 * given instant. Positive east of UTC (e.g. +300 is wrong; UTC+5 is +300,
 * America/New_York standard time is -300), matching ISO 8601 offset sign.
 */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  // The wall-clock reading in `timeZone`, reinterpreted as if it were itself
  // a UTC timestamp. The gap between that and the real UTC instant is the
  // zone's offset at this moment.
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return (asIfUtc - utcMs) / 60_000;
}

/**
 * Converts a wall-clock local time (a calendar date plus minutes-from-midnight)
 * in `timeZone` into the UTC instant it refers to. This is where DST is
 * actually resolved: the same "9:00 AM" wall-clock rule maps to a different
 * UTC instant depending on which side of a DST transition the date falls on.
 *
 * Standard offset-guessing technique: the zone's offset can only be
 * discovered by looking it up at a specific instant, but the instant is what
 * we're trying to compute. We guess, look up the offset there, and correct -
 * which converges immediately except within the one hour of a DST
 * transition itself, where two iterations settle it.
 */
export function zonedTimeToUtc(
  dateStr: DateString,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  const wallClockAsUtcMs = Date.UTC(y, m - 1, d, hour, minute);

  let guessMs = wallClockAsUtcMs;
  for (let i = 0; i < 2; i++) {
    const offset = offsetMinutesAt(guessMs, timeZone);
    const nextGuessMs = wallClockAsUtcMs - offset * 60_000;
    if (nextGuessMs === guessMs) break;
    guessMs = nextGuessMs;
  }
  return new Date(guessMs);
}
