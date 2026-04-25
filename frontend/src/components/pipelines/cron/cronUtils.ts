// frontend/src/components/pipelines/cron/cronUtils.ts
//
// Minimal cron parser + matcher for the schedule-trigger config preview.
// Mirrors `social-api/src/services/scheduleEvaluator.ts` (parseCronExpression /
// cronMatches) — keep the two in sync. Drift policy: see TYPES_SYNC.md.
//
// Supported grammar (5-field expression: minute hour day-of-month month dow):
//   `*` | `N` | `N,M,...` | `* /N` | `A-B`
// Any other shape returns `null` from parseCron.

export interface ParsedField {
  match: '*' | number[];
  /** Step value for `*\/N`; only meaningful when match === '*'. */
  step?: number;
}

export interface ParsedCron {
  minute: ParsedField;
  hour: ParsedField;
  dayOfMonth: ParsedField;
  month: ParsedField;
  dayOfWeek: ParsedField;
}

const FIELD_RANGES: Array<{ name: keyof ParsedCron; min: number; max: number }> = [
  { name: 'minute',     min: 0, max: 59 },
  { name: 'hour',       min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month',      min: 1, max: 12 },
  { name: 'dayOfWeek',  min: 0, max: 6  },
];

function parseField(raw: string, min: number, max: number): ParsedField | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const stepMatch = /^\*\/(\d+)$/.exec(trimmed);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (!Number.isFinite(step) || step <= 0) return null;
    return { match: '*', step };
  }

  if (trimmed === '*') return { match: '*' };

  const rangeMatch = /^(\d+)-(\d+)$/.exec(trimmed);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a < min || b > max || a > b) return null;
    const out: number[] = [];
    for (let i = a; i <= b; i++) out.push(i);
    return { match: out };
  }

  if (trimmed.includes(',')) {
    const parts = trimmed.split(',');
    const seen = new Set<number>();
    const out: number[] = [];
    for (const p of parts) {
      const n = Number(p.trim());
      if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
      if (n < min || n > max) return null;
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    if (out.length === 0) return null;
    return { match: out };
  }

  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return { match: [n] };
}

export function parseCron(expr: string): ParsedCron | null {
  if (typeof expr !== 'string') return null;
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const out: Partial<ParsedCron> = {};
  for (let i = 0; i < 5; i++) {
    const spec = FIELD_RANGES[i];
    const parsed = parseField(fields[i], spec.min, spec.max);
    if (!parsed) return null;
    out[spec.name] = parsed;
  }
  return out as ParsedCron;
}

function fieldMatches(field: ParsedField, value: number, fieldMin: number): boolean {
  if (field.match === '*') {
    if (!field.step || field.step === 1) return true;
    return ((value - fieldMin) % field.step) === 0;
  }
  return field.match.includes(value);
}

export function matchesCron(cron: ParsedCron, date: Date): boolean {
  return (
    fieldMatches(cron.minute,     date.getMinutes(),  0) &&
    fieldMatches(cron.hour,       date.getHours(),    0) &&
    fieldMatches(cron.dayOfMonth, date.getDate(),     1) &&
    fieldMatches(cron.month,      date.getMonth() + 1, 1) &&
    fieldMatches(cron.dayOfWeek,  date.getDay(),      0)
  );
}

/**
 * Walk forward minute-by-minute from `from`, collecting matches until we have
 * `count` of them. Capped at one year of lookups; returns whatever was found
 * if the cap is reached (this avoids infinite loops on impossible expressions
 * like `0 0 31 2 *`).
 */
export function nextFires(cron: ParsedCron, from: Date, count: number): Date[] {
  if (count <= 0) return [];
  const out: Date[] = [];
  // Start from the next whole minute strictly after `from` so we don't return
  // the current minute (caller has already seen it).
  const start = new Date(from.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const maxMinutes = 60 * 24 * 366; // one year
  const cursor = new Date(start.getTime());
  for (let i = 0; i < maxMinutes && out.length < count; i++) {
    if (matchesCron(cron, cursor)) {
      out.push(new Date(cursor.getTime()));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return out;
}
