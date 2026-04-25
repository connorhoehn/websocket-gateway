// Tests for the schedule evaluator.
//
// Focus:
//   - cron grammar coverage: *, exact, comma list, A-B range, *\/N step
//   - five-field validation (reject 4 / 6 fields)
//   - evaluateOnce filters by status === 'published' && triggerBinding.event === 'schedule'
//   - tick() suppresses double-fires within the same minute
//   - triggerNow() bypasses the schedule filter

import {
  ScheduleEvaluator,
  createScheduleEvaluator,
  parseCronExpression,
  cronMatches,
  type PipelineForSchedule,
} from '../scheduleEvaluator';

function pipeline(over: Partial<PipelineForSchedule> = {}): PipelineForSchedule {
  return {
    id: 'p-1',
    status: 'published',
    triggerBinding: { event: 'schedule', schedule: '* * * * *' },
    ...over,
  };
}

describe('parseCronExpression', () => {
  test('accepts five-field "* * * * *"', () => {
    const c = parseCronExpression('* * * * *');
    expect(c).not.toBeNull();
    expect(c!.minute.match).toBe('*');
  });

  test('accepts exact values "30 14 1 * *"', () => {
    const c = parseCronExpression('30 14 1 * *');
    expect(c).not.toBeNull();
    expect(Array.from(c!.minute.match as Set<number>)).toEqual([30]);
    expect(Array.from(c!.hour.match as Set<number>)).toEqual([14]);
    expect(Array.from(c!.dayOfMonth.match as Set<number>)).toEqual([1]);
  });

  test('accepts comma list "0,15,30,45 * * * *"', () => {
    const c = parseCronExpression('0,15,30,45 * * * *');
    expect(c).not.toBeNull();
    const minutes = Array.from(c!.minute.match as Set<number>).sort((a, b) => a - b);
    expect(minutes).toEqual([0, 15, 30, 45]);
  });

  test('accepts dash range "0 9 * * 1-5"', () => {
    const c = parseCronExpression('0 9 * * 1-5');
    expect(c).not.toBeNull();
    const dows = Array.from(c!.dayOfWeek.match as Set<number>).sort((a, b) => a - b);
    expect(dows).toEqual([1, 2, 3, 4, 5]);
  });

  test('accepts step "*/15 * * * *"', () => {
    const c = parseCronExpression('*/15 * * * *');
    expect(c).not.toBeNull();
    expect(c!.minute.match).toBe('*');
    expect(c!.minute.step).toBe(15);
  });

  test('rejects 4 fields', () => {
    expect(parseCronExpression('* * * *')).toBeNull();
  });

  test('rejects 6 fields', () => {
    expect(parseCronExpression('0 * * * * *')).toBeNull();
  });

  test('rejects out-of-range values', () => {
    expect(parseCronExpression('60 * * * *')).toBeNull();
    expect(parseCronExpression('* 24 * * *')).toBeNull();
    expect(parseCronExpression('* * 32 * *')).toBeNull();
    expect(parseCronExpression('* * * 13 *')).toBeNull();
    expect(parseCronExpression('* * * * 7')).toBeNull();
  });

  test('rejects exotic patterns', () => {
    expect(parseCronExpression('1-30/2 * * * *')).toBeNull(); // step on range
    expect(parseCronExpression('? * * * *')).toBeNull();
    expect(parseCronExpression('L * * * *')).toBeNull();
  });
});

describe('cronMatches', () => {
  test('"* * * * *" matches every minute', () => {
    const c = parseCronExpression('* * * * *')!;
    expect(cronMatches(c, new Date('2026-04-23T10:30:00'))).toBe(true);
    expect(cronMatches(c, new Date('2026-04-23T10:31:00'))).toBe(true);
  });

  test('"0 9 * * 1-5" weekday 9am — Mon match, Sat no match', () => {
    const c = parseCronExpression('0 9 * * 1-5')!;
    // 2026-04-20 is a Monday.
    expect(cronMatches(c, new Date(2026, 3, 20, 9, 0))).toBe(true);
    // Saturday (2026-04-25) — should not match.
    expect(cronMatches(c, new Date(2026, 3, 25, 9, 0))).toBe(false);
    // Right hour but wrong minute on a weekday.
    expect(cronMatches(c, new Date(2026, 3, 20, 9, 1))).toBe(false);
  });

  test('"*/15 * * * *" matches at :00, :15, :30, :45 only', () => {
    const c = parseCronExpression('*/15 * * * *')!;
    expect(cronMatches(c, new Date(2026, 3, 23, 10, 0))).toBe(true);
    expect(cronMatches(c, new Date(2026, 3, 23, 10, 15))).toBe(true);
    expect(cronMatches(c, new Date(2026, 3, 23, 10, 30))).toBe(true);
    expect(cronMatches(c, new Date(2026, 3, 23, 10, 45))).toBe(true);
    expect(cronMatches(c, new Date(2026, 3, 23, 10, 1))).toBe(false);
    expect(cronMatches(c, new Date(2026, 3, 23, 10, 14))).toBe(false);
  });

  test('"30 14 1 * *" matches the 1st of any month at 14:30', () => {
    const c = parseCronExpression('30 14 1 * *')!;
    expect(cronMatches(c, new Date(2026, 3, 1, 14, 30))).toBe(true);   // Apr 1
    expect(cronMatches(c, new Date(2026, 4, 1, 14, 30))).toBe(true);   // May 1
    expect(cronMatches(c, new Date(2026, 3, 2, 14, 30))).toBe(false);  // Apr 2
    expect(cronMatches(c, new Date(2026, 3, 1, 14, 29))).toBe(false);  // Apr 1 14:29
  });
});

describe('ScheduleEvaluator.evaluateOnce', () => {
  test('returns ids only for published schedule pipelines whose cron matches now', () => {
    const pipelines: PipelineForSchedule[] = [
      pipeline({ id: 'a', triggerBinding: { event: 'schedule', schedule: '* * * * *' } }),
      pipeline({ id: 'b', status: 'draft', triggerBinding: { event: 'schedule', schedule: '* * * * *' } }),
      pipeline({ id: 'c', triggerBinding: { event: 'manual' } }),
      pipeline({ id: 'd', triggerBinding: { event: 'schedule', schedule: '0 0 1 1 *' } }), // Jan 1, 00:00
    ];
    const evaluator = new ScheduleEvaluator({
      listPipelines: () => pipelines,
      trigger: async () => {},
    });
    const ids = evaluator.evaluateOnce(new Date(2026, 3, 23, 10, 30));
    expect(ids).toEqual(['a']);
  });

  test('skips pipelines with invalid cron strings', () => {
    const pipelines: PipelineForSchedule[] = [
      pipeline({ id: 'a', triggerBinding: { event: 'schedule', schedule: 'not-a-cron' } }),
      pipeline({ id: 'b', triggerBinding: { event: 'schedule', schedule: '* * * * *' } }),
    ];
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const evaluator = new ScheduleEvaluator({
      listPipelines: () => pipelines,
      trigger: async () => {},
    });
    const ids = evaluator.evaluateOnce(new Date(2026, 3, 23, 10, 30));
    expect(ids).toEqual(['b']);
    errSpy.mockRestore();
  });
});

describe('ScheduleEvaluator.tick double-fire suppression', () => {
  test('does not fire the same pipeline twice within the same minute', async () => {
    const fired: Array<{ id: string; at: string }> = [];
    const evaluator = createScheduleEvaluator({
      listPipelines: () => [pipeline({ id: 'a' })],
      trigger: async (id, payload) => {
        fired.push({ id, at: String(payload.firedAt) });
      },
    });
    const t1 = new Date(2026, 3, 23, 10, 30, 5);
    const t2 = new Date(2026, 3, 23, 10, 30, 30);
    const t3 = new Date(2026, 3, 23, 10, 31, 0);
    evaluator.tick(t1);
    evaluator.tick(t2);
    evaluator.tick(t3);
    // Wait a microtask so pending promises resolve.
    await Promise.resolve();
    expect(fired.map(f => f.id)).toEqual(['a', 'a']);
    // First two ticks are in the same minute -> only one firing for that minute.
    expect(fired[0].at).toBe(t1.toISOString());
    expect(fired[1].at).toBe(t3.toISOString());
  });
});

describe('ScheduleEvaluator.triggerNow', () => {
  test('fires regardless of schedule', async () => {
    const fired: string[] = [];
    const evaluator = createScheduleEvaluator({
      listPipelines: () => [pipeline({ id: 'x', triggerBinding: { event: 'schedule', schedule: '0 0 1 1 *' } })],
      trigger: async (id) => { fired.push(id); },
    });
    evaluator.triggerNow('x');
    await Promise.resolve();
    expect(fired).toEqual(['x']);
  });
});
