import { describe, expect, it } from 'vitest';
import {
  addDaysToDateString,
  compareDateStrings,
  dayOfWeekFromDateString,
  isValidTimeZone,
  toDateString,
  zonedTimeToUtc,
} from '../../src/lib/time.js';

describe('isValidTimeZone', () => {
  it('accepts a real IANA zone', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects a made-up zone', () => {
    expect(isValidTimeZone('Mars/Phobos')).toBe(false);
    expect(isValidTimeZone('not a timezone')).toBe(false);
  });
});

describe('date string helpers', () => {
  it('toDateString extracts the calendar date', () => {
    expect(toDateString(new Date('2026-03-09T13:00:00Z'))).toBe('2026-03-09');
  });

  it('addDaysToDateString adds/subtracts across month and year boundaries', () => {
    expect(addDaysToDateString('2026-02-27', 2)).toBe('2026-03-01');
    expect(addDaysToDateString('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('dayOfWeekFromDateString matches the real calendar', () => {
    // 2026-03-09 is a Monday.
    expect(dayOfWeekFromDateString('2026-03-09')).toBe(1);
    // 2026-03-08 is a Sunday.
    expect(dayOfWeekFromDateString('2026-03-08')).toBe(0);
  });

  it('compareDateStrings orders lexically (works because of zero-padded ISO format)', () => {
    expect(compareDateStrings('2026-03-01', '2026-03-02')).toBeLessThan(0);
    expect(compareDateStrings('2026-03-02', '2026-03-01')).toBeGreaterThan(0);
    expect(compareDateStrings('2026-03-01', '2026-03-01')).toBe(0);
  });
});

describe('zonedTimeToUtc', () => {
  it('converts a plain UTC wall-clock time with no offset', () => {
    expect(zonedTimeToUtc('2026-06-15', 9 * 60, 'UTC').toISOString()).toBe(
      '2026-06-15T09:00:00.000Z',
    );
  });

  it('converts 9:00 AM America/New_York during standard time (EST, UTC-5)', () => {
    // 2026-03-02 is before that year's spring-forward (March 8), so still EST.
    expect(zonedTimeToUtc('2026-03-02', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-03-02T14:00:00.000Z',
    );
  });

  it('converts 9:00 AM America/New_York during daylight time (EDT, UTC-4)', () => {
    // 2026-03-09 is the Monday right after that year's spring-forward.
    expect(zonedTimeToUtc('2026-03-09', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
  });

  it('picks up the DST-end transition (fall back, EDT -> EST)', () => {
    // 2026-11-01 is that year's fall-back Sunday; the Monday before is EDT,
    // the Monday after is EST, one hour apart for the same wall-clock time.
    expect(zonedTimeToUtc('2026-10-26', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-10-26T13:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-11-02', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-11-02T14:00:00.000Z',
    );
  });

  it('handles a southern-hemisphere zone with the opposite DST direction', () => {
    // Australia/Sydney is UTC+11 in southern-hemisphere summer (Jan) and
    // UTC+10 in winter (Jul) - the reverse of the northern hemisphere.
    expect(zonedTimeToUtc('2026-01-15', 9 * 60, 'Australia/Sydney').toISOString()).toBe(
      '2026-01-14T22:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-07-15', 9 * 60, 'Australia/Sydney').toISOString()).toBe(
      '2026-07-14T23:00:00.000Z',
    );
  });
});
