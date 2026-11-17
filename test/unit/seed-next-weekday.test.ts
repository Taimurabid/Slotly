import { describe, expect, it } from 'vitest';
import { dayOfWeekFromDateString } from '../../src/lib/time.js';
import { nextWeekday } from '../../src/db/seed.js';

describe('nextWeekday (used by the seed script)', () => {
  it('returns a date that is at least minDaysAhead days out', () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (let target = 0; target <= 6; target++) {
      const result = nextWeekday(target, 5);
      const resultDate = new Date(`${result}T00:00:00Z`);
      const daysAhead = (resultDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000);
      expect(daysAhead).toBeGreaterThanOrEqual(5);
    }
  });

  it('returns a date that actually falls on the requested weekday', () => {
    for (let target = 0; target <= 6; target++) {
      const result = nextWeekday(target, 5);
      expect(dayOfWeekFromDateString(result)).toBe(target);
    }
  });

  it('never returns more than 6 days beyond the minimum (it is the *next* occurrence)', () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    for (let target = 0; target <= 6; target++) {
      const result = nextWeekday(target, 3);
      const resultDate = new Date(`${result}T00:00:00Z`);
      const daysAhead = (resultDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000);
      expect(daysAhead).toBeGreaterThanOrEqual(3);
      expect(daysAhead).toBeLessThan(3 + 7);
    }
  });
});
