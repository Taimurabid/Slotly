import type { Database } from '../../db/client.js';
import {
  addDaysToDateString,
  compareDateStrings,
  dayOfWeekFromDateString,
  toDateString,
  zonedTimeToUtc,
} from '../../lib/time.js';
import { getProviderProfile } from '../providers/providers.service.js';
import {
  listBlockedRangesInWindow,
  listConfirmedBookingsInWindow,
  listRulesForProvider,
} from './slots.repository.js';

export interface SlotRule {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface BusyRange {
  startsAt: Date;
  endsAt: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

export interface ComputeOpenSlotsInput {
  timezone: string;
  sessionLengthMinutes: number;
  rules: SlotRule[];
  busyRanges: BusyRange[];
  from: Date;
  to: Date;
  /** Slots starting before `now` are excluded. Defaults to the real clock; injectable for tests. */
  now?: Date;
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Pure slot computation: weekly rules -> concrete UTC slots on each matching
 * calendar date in range, minus anything that overlaps a busy range (an
 * existing confirmed booking or a one-off block), minus anything in the
 * past. No I/O, so this is unit-tested directly without a database.
 *
 * Rules are scanned per *local calendar date* (one extra day is padded on
 * each side of the requested window before converting to UTC) because a
 * provider's local day doesn't line up with the UTC day of `from`/`to` -
 * padding guarantees we never miss a day near that boundary; anything
 * outside the real window is dropped by the final from/to filter anyway.
 */
export function computeOpenSlots(input: ComputeOpenSlotsInput): Slot[] {
  const { timezone, sessionLengthMinutes, rules, busyRanges, from, to } = input;
  const now = input.now ?? new Date();
  const sessionMs = sessionLengthMinutes * 60_000;

  const candidates: Slot[] = [];
  let cursor = addDaysToDateString(toDateString(from), -1);
  const lastDate = addDaysToDateString(toDateString(to), 1);

  while (compareDateStrings(cursor, lastDate) <= 0) {
    const weekday = dayOfWeekFromDateString(cursor);
    for (const rule of rules) {
      if (rule.dayOfWeek !== weekday) continue;

      const windowStartMs = zonedTimeToUtc(cursor, rule.startMinute, timezone).getTime();
      const windowEndMs = zonedTimeToUtc(cursor, rule.endMinute, timezone).getTime();

      let slotStartMs = windowStartMs;
      while (slotStartMs + sessionMs <= windowEndMs) {
        candidates.push({
          startsAt: new Date(slotStartMs),
          endsAt: new Date(slotStartMs + sessionMs),
        });
        slotStartMs += sessionMs;
      }
    }
    cursor = addDaysToDateString(cursor, 1);
  }

  const fromMs = from.getTime();
  const toMs = to.getTime();
  const nowMs = now.getTime();

  return candidates
    .filter((slot) => slot.startsAt.getTime() >= fromMs && slot.startsAt.getTime() < toMs)
    .filter((slot) => slot.startsAt.getTime() >= nowMs)
    .filter(
      (slot) =>
        !busyRanges.some((busy) =>
          rangesOverlap(slot.startsAt, slot.endsAt, busy.startsAt, busy.endsAt),
        ),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export async function getOpenSlotsForProvider(
  db: Database,
  providerId: string,
  from: Date,
  to: Date,
  now?: Date,
): Promise<Slot[]> {
  const provider = await getProviderProfile(db, providerId);
  const [rules, blocked, confirmedBookings] = await Promise.all([
    listRulesForProvider(db, providerId),
    listBlockedRangesInWindow(db, providerId, from, to),
    listConfirmedBookingsInWindow(db, providerId, from, to),
  ]);

  const busyRanges: BusyRange[] = [...blocked, ...confirmedBookings].map((range) => ({
    startsAt: range.startsAt,
    endsAt: range.endsAt,
  }));

  return computeOpenSlots({
    timezone: provider.timezone,
    sessionLengthMinutes: provider.sessionLengthMinutes,
    rules: rules.map((rule) => ({
      dayOfWeek: rule.dayOfWeek,
      startMinute: rule.startMinute,
      endMinute: rule.endMinute,
    })),
    busyRanges,
    from,
    to,
    now,
  });
}
