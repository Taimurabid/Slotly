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
