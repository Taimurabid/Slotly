import { describe, expect, it } from 'vitest';
import { isSlotConflict } from '../../src/modules/bookings/bookings.service.js';

function errorWithCause(code: unknown): Error {
  const err = new Error('Failed query');
  (err as Error & { cause?: unknown }).cause = code === undefined ? undefined : { code };
  return err;
}

describe('isSlotConflict', () => {
  it('recognizes a Postgres exclusion_violation (23P01)', () => {
    expect(isSlotConflict(errorWithCause('23P01'))).toBe(true);
  });

  it('recognizes a Postgres deadlock_detected (40P01) the same way', () => {
    // Under heavy write contention, Postgres's lock manager can report a
    // deadlock between concurrent inserts into the GiST-indexed column
    // before the exclusion check itself runs. A deadlock victim did no
    // work and was rolled back automatically, so it's exactly as safe to
    // treat as "lost the race for the slot" as a real exclusion violation.
    expect(isSlotConflict(errorWithCause('40P01'))).toBe(true);
  });

  it('does not treat an unrelated Postgres error as a slot conflict', () => {
    expect(isSlotConflict(errorWithCause('23505'))).toBe(false); // unique_violation
  });

  it('does not treat a plain error with no cause as a slot conflict', () => {
    expect(isSlotConflict(new Error('boom'))).toBe(false);
  });

  it('does not throw on a non-Error value', () => {
    expect(isSlotConflict('not an error')).toBe(false);
    expect(isSlotConflict(null)).toBe(false);
    expect(isSlotConflict(undefined)).toBe(false);
  });
});
