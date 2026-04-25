// Tests for cronUtils — kept in lockstep with social-api scheduleEvaluator's
// cron parser. See TYPES_SYNC.md.

import { describe, test, expect } from 'vitest';
import { parseCron, matchesCron, nextFires } from '../cron/cronUtils';

describe('parseCron', () => {
  test('"* * * * *" parses', () => {
    const c = parseCron('* * * * *');
    expect(c).not.toBeNull();
    expect(c!.minute.match).toBe('*');
  });

  test('"30 14 1 * *" parses to exact values', () => {
    const c = parseCron('30 14 1 * *')!;
    expect(c.minute.match).toEqual([30]);
    expect(c.hour.match).toEqual([14]);
    expect(c.dayOfMonth.match).toEqual([1]);
  });

  test('"0,15,30,45 * * * *" parses comma list', () => {
    const c = parseCron('0,15,30,45 * * * *')!;
    expect(c.minute.match).toEqual([0, 15, 30, 45]);
  });

  test('"0 9 * * 1-5" parses weekday range', () => {
    const c = parseCron('0 9 * * 1-5')!;
    expect(c.dayOfWeek.match).toEqual([1, 2, 3, 4, 5]);
  });

  test('"*/15 * * * *" parses step', () => {
    const c = parseCron('*/15 * * * *')!;
    expect(c.minute.match).toBe('*');
    expect(c.minute.step).toBe(15);
  });

  test('rejects 4 fields', () => {
    expect(parseCron('* * * *')).toBeNull();
  });

  test('rejects 6 fields', () => {
    expect(parseCron('0 * * * * *')).toBeNull();
  });

  test('rejects out-of-range values', () => {
    expect(parseCron('60 * * * *')).toBeNull();
    expect(parseCron('* * 0 * *')).toBeNull();
  });

  test('rejects exotic syntax', () => {
    expect(parseCron('1-30/2 * * * *')).toBeNull();
    expect(parseCron('? * * * *')).toBeNull();
  });
});

describe('matchesCron', () => {
  test('"* * * * *" matches everything', () => {
    const c = parseCron('* * * * *')!;
    expect(matchesCron(c, new Date(2026, 3, 23, 10, 30))).toBe(true);
  });

  test('"0 9 * * 1-5" weekday 9am only', () => {
    const c = parseCron('0 9 * * 1-5')!;
    // Mon 2026-04-20 9:00
    expect(matchesCron(c, new Date(2026, 3, 20, 9, 0))).toBe(true);
    // Sat 2026-04-25 9:00
    expect(matchesCron(c, new Date(2026, 3, 25, 9, 0))).toBe(false);
  });

  test('"*/15 * * * *" matches quarter-hour marks', () => {
    const c = parseCron('*/15 * * * *')!;
    expect(matchesCron(c, new Date(2026, 3, 23, 10, 0))).toBe(true);
    expect(matchesCron(c, new Date(2026, 3, 23, 10, 15))).toBe(true);
    expect(matchesCron(c, new Date(2026, 3, 23, 10, 14))).toBe(false);
  });

  test('"30 14 1 * *" first-of-month 14:30', () => {
    const c = parseCron('30 14 1 * *')!;
    expect(matchesCron(c, new Date(2026, 3, 1, 14, 30))).toBe(true);
    expect(matchesCron(c, new Date(2026, 3, 2, 14, 30))).toBe(false);
  });
});

describe('nextFires', () => {
  test('every minute → next 3 are consecutive minutes', () => {
    const c = parseCron('* * * * *')!;
    const start = new Date(2026, 3, 23, 10, 30, 25);
    const fires = nextFires(c, start, 3);
    expect(fires).toHaveLength(3);
    // First fire is the next whole minute strictly after `start`.
    expect(fires[0]).toEqual(new Date(2026, 3, 23, 10, 31, 0, 0));
    expect(fires[1]).toEqual(new Date(2026, 3, 23, 10, 32, 0, 0));
    expect(fires[2]).toEqual(new Date(2026, 3, 23, 10, 33, 0, 0));
  });

  test('every 15 minutes → next 3 at quarter-hour marks', () => {
    const c = parseCron('*/15 * * * *')!;
    const start = new Date(2026, 3, 23, 10, 5, 0);
    const fires = nextFires(c, start, 3);
    expect(fires).toEqual([
      new Date(2026, 3, 23, 10, 15, 0, 0),
      new Date(2026, 3, 23, 10, 30, 0, 0),
      new Date(2026, 3, 23, 10, 45, 0, 0),
    ]);
  });

  test('weekday 9am → never fires on a weekend', () => {
    const c = parseCron('0 9 * * 1-5')!;
    // Saturday 2026-04-25 evening — next fire is Mon 2026-04-27 09:00.
    const start = new Date(2026, 3, 25, 23, 0);
    const fires = nextFires(c, start, 1);
    expect(fires).toHaveLength(1);
    expect(fires[0]).toEqual(new Date(2026, 3, 27, 9, 0, 0, 0));
    expect(fires[0].getDay()).toBe(1); // Monday
  });

  test('returns empty when count is 0', () => {
    const c = parseCron('* * * * *')!;
    expect(nextFires(c, new Date(), 0)).toEqual([]);
  });

  test('caps at one year — impossible cron returns []', () => {
    // Feb 31 doesn't exist. Should return [] without infinite-looping.
    const c = parseCron('0 0 31 2 *')!;
    const fires = nextFires(c, new Date(2026, 0, 1), 1);
    expect(fires).toEqual([]);
  });
});
