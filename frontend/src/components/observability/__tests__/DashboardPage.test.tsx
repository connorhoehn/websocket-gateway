// frontend/src/components/observability/__tests__/DashboardPage.test.tsx
//
// Coverage for the DashboardPage `formatMs` helper that drives the
// "Avg first-token latency" KPI card. The helper applies the FE1 em-dash
// rule for null/non-finite inputs and switches between "ms" and "s" units
// at the 1000ms boundary.

import { describe, test, expect } from 'vitest';
import { formatMs } from '../DashboardPage';

const EM_DASH = '\u2014';

describe('DashboardPage / formatMs (Avg first-token latency)', () => {
  test('renders em-dash for null', () => {
    expect(formatMs(null)).toBe(EM_DASH);
  });

  test('renders em-dash for undefined (older bridge omits the field)', () => {
    expect(formatMs(undefined)).toBe(EM_DASH);
  });

  test('renders em-dash for NaN / non-finite', () => {
    expect(formatMs(Number.NaN)).toBe(EM_DASH);
    expect(formatMs(Number.POSITIVE_INFINITY)).toBe(EM_DASH);
  });

  test('renders "0 ms" for an explicit zero (genuine zero, not unknown)', () => {
    // Distinct from null — a measured zero must NOT collapse to em-dash.
    expect(formatMs(0)).toBe('0 ms');
  });

  test('renders sub-second values in milliseconds, rounded', () => {
    expect(formatMs(234)).toBe('234 ms');
    expect(formatMs(999)).toBe('999 ms');
    expect(formatMs(123.4)).toBe('123 ms');
  });

  test('switches to seconds at >= 1000 ms with one decimal place', () => {
    expect(formatMs(1000)).toBe('1.0s');
    expect(formatMs(1234)).toBe('1.2s');
    expect(formatMs(12345)).toBe('12.3s');
  });
});
