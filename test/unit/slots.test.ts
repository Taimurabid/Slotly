import { describe, expect, it } from 'vitest';
import { computeOpenSlots } from '../../src/modules/slots/slots.service.js';

function iso(
  slots: { startsAt: Date; endsAt: Date }[],
): Array<{ startsAt: string; endsAt: string }> {
  return slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }));
}

describe('computeOpenSlots', () => {
  it('generates back-to-back slots filling a single rule window', () => {
    const slots = computeOpenSlots({
      timezone: 'UTC',
      sessionLengthMinutes: 60,
      rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }], // Monday 9-12
      busyRanges: [],
      from: new Date('2026-03-09T00:00:00Z'), // Monday
      to: new Date('2026-03-10T00:00:00Z'),
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(iso(slots)).toEqual([
      { startsAt: '2026-03-09T09:00:00.000Z', endsAt: '2026-03-09T10:00:00.000Z' },
      { startsAt: '2026-03-09T10:00:00.000Z', endsAt: '2026-03-09T11:00:00.000Z' },
      { startsAt: '2026-03-09T11:00:00.000Z', endsAt: '2026-03-09T12:00:00.000Z' },
    ]);
  });

  it('drops a remainder shorter than one full session', () => {
    const slots = computeOpenSlots({
      timezone: 'UTC',
      sessionLengthMinutes: 45,
      rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 9 * 60 + 70 }], // 70 minutes
      busyRanges: [],
      from: new Date('2026-03-09T00:00:00Z'),
      to: new Date('2026-03-10T00:00:00Z'),
      now: new Date('2026-01-01T00:00:00Z'),
    });

    // Only one 45-minute slot fits; the remaining 25 minutes is not offered.
    expect(slots).toHaveLength(1);
    expect(slots[0]?.startsAt.toISOString()).toBe('2026-03-09T09:00:00.000Z');
    expect(slots[0]?.endsAt.toISOString()).toBe('2026-03-09T09:45:00.000Z');
  });

  it('respects a gap between two rules on the same day', () => {
    const slots = computeOpenSlots({
      timezone: 'UTC',
      sessionLengthMinutes: 60,
      rules: [
        { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60 }, // 9-11
        { dayOfWeek: 1, startMinute: 14 * 60, endMinute: 16 * 60 }, // 14-16
      ],
      busyRanges: [],
      from: new Date('2026-03-09T00:00:00Z'),
      to: new Date('2026-03-10T00:00:00Z'),
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(iso(slots)).toEqual([
      { startsAt: '2026-03-09T09:00:00.000Z', endsAt: '2026-03-09T10:00:00.000Z' },
      { startsAt: '2026-03-09T10:00:00.000Z', endsAt: '2026-03-09T11:00:00.000Z' },
      { startsAt: '2026-03-09T14:00:00.000Z', endsAt: '2026-03-09T15:00:00.000Z' },
      { startsAt: '2026-03-09T15:00:00.000Z', endsAt: '2026-03-09T16:00:00.000Z' },
    ]);
  });

  it('removes a slot that overlaps an existing confirmed booking, even partially', () => {
    const slots = computeOpenSlots({
      timezone: 'UTC',
      sessionLengthMinutes: 60,
      rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
      busyRanges: [
        { startsAt: new Date('2026-03-09T10:30:00Z'), endsAt: new Date('2026-03-09T10:45:00Z') },
      ],
      from: new Date('2026-03-09T00:00:00Z'),
      to: new Date('2026-03-10T00:00:00Z'),
      now: new Date('2026-01-01T00:00:00Z'),
    });

    // The 10:00-11:00 slot overlaps the 15-minute booking and is dropped;
    // 9:00-10:00 and 11:00-12:00 are untouched.
    expect(iso(slots)).toEqual([
      { startsAt: '2026-03-09T09:00:00.000Z', endsAt: '2026-03-09T10:00:00.000Z' },
      { startsAt: '2026-03-09T11:00:00.000Z', endsAt: '2026-03-09T12:00:00.000Z' },
    ]);
  });

  it('removes every slot covered by a multi-day blocked range', () => {
    const slots = computeOpenSlots({
      timezone: 'UTC',
      sessionLengthMinutes: 60,
      rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 11 * 60 }],
      busyRanges: [
        { startsAt: new Date('2026-03-08T00:00:00Z'), endsAt: new Date('2026-03-17T00:00:00Z') },
      ],
      from: new Date('2026-03-09T00:00:00Z'),
      to: new Date('2026-03-18T00:00:00Z'), // covers two Mondays: 3/9 and 3/16
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(slots).toHaveLength(0);
  });

  it('excludes slots that start before `now`', () => {
    const slots = computeOpenSlots({
      timezone: 'UTC',
      sessionLengthMinutes: 60,
      rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
      busyRanges: [],
      from: new Date('2026-03-09T00:00:00Z'),
      to: new Date('2026-03-10T00:00:00Z'),
      now: new Date('2026-03-09T10:30:00Z'), // mid-morning on the same day
    });

    expect(iso(slots)).toEqual([
      { startsAt: '2026-03-09T11:00:00.000Z', endsAt: '2026-03-09T12:00:00.000Z' },
    ]);
  });

  it('only returns slots whose start falls within [from, to)', () => {
    const slots = computeOpenSlots({
      timezone: 'UTC',
      sessionLengthMinutes: 60,
      rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
      busyRanges: [],
      from: new Date('2026-03-09T10:00:00Z'), // excludes the 9:00 slot
      to: new Date('2026-03-09T11:00:00Z'), // excludes the 11:00 slot
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(iso(slots)).toEqual([
      { startsAt: '2026-03-09T10:00:00.000Z', endsAt: '2026-03-09T11:00:00.000Z' },
    ]);
  });

  it('produces no slots on a day with no matching rule', () => {
    const slots = computeOpenSlots({
      timezone: 'UTC',
      sessionLengthMinutes: 60,
      rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }], // Monday only
      busyRanges: [],
      from: new Date('2026-03-10T00:00:00Z'), // Tuesday
      to: new Date('2026-03-11T00:00:00Z'),
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(slots).toHaveLength(0);
  });

  describe('DST', () => {
    it('shifts the UTC instant by one hour across the spring-forward transition, keeping wall-clock time fixed', () => {
      const ruleBefore = computeOpenSlots({
        timezone: 'America/New_York',
        sessionLengthMinutes: 60,
        rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 }],
        busyRanges: [],
        from: new Date('2026-03-02T00:00:00Z'), // Monday before spring-forward (EST)
        to: new Date('2026-03-03T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
      });
      const ruleAfter = computeOpenSlots({
        timezone: 'America/New_York',
        sessionLengthMinutes: 60,
        rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 }],
        busyRanges: [],
        from: new Date('2026-03-09T00:00:00Z'), // Monday after spring-forward (EDT)
        to: new Date('2026-03-10T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
      });

      // Same local 9:00 AM both weeks, but EST is UTC-5 and EDT is UTC-4.
      expect(ruleBefore[0]?.startsAt.toISOString()).toBe('2026-03-02T14:00:00.000Z');
      expect(ruleAfter[0]?.startsAt.toISOString()).toBe('2026-03-09T13:00:00.000Z');
    });

    it('shifts the UTC instant by one hour across the fall-back transition', () => {
      const ruleBefore = computeOpenSlots({
        timezone: 'America/New_York',
        sessionLengthMinutes: 60,
        rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 }],
        busyRanges: [],
        from: new Date('2026-10-26T00:00:00Z'), // Monday before fall-back (EDT)
        to: new Date('2026-10-27T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
      });
      const ruleAfter = computeOpenSlots({
        timezone: 'America/New_York',
        sessionLengthMinutes: 60,
        rules: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 10 * 60 }],
        busyRanges: [],
        from: new Date('2026-11-02T00:00:00Z'), // Monday after fall-back (EST)
        to: new Date('2026-11-03T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
      });

      expect(ruleBefore[0]?.startsAt.toISOString()).toBe('2026-10-26T13:00:00.000Z');
      expect(ruleAfter[0]?.startsAt.toISOString()).toBe('2026-11-02T14:00:00.000Z');
    });
  });
});
