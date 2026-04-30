// frontend/src/components/ApiDegradedBanner.test.tsx
//
// Hub task #4: visual smoke for the degraded-API banner. Asserts the banner
// only renders when the snapshot's status is "degraded", and surfaces the
// list of failing dependency names so operators can see *what* is wrong.

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ApiDegradedBanner } from './ApiDegradedBanner';
import type { ApiHealthSnapshot } from '../hooks/useApiHealth';

const ok: ApiHealthSnapshot = { status: 'ok', checks: {}, failing: [] };
const unknown: ApiHealthSnapshot = { status: 'unknown', checks: {}, failing: [] };
const degraded: ApiHealthSnapshot = {
  status: 'degraded',
  checks: {
    dynamodb: { status: 'error', error: '' },
    redis: { status: 'error', error: 'Redis client unavailable' },
  },
  failing: ['dynamodb', 'redis'],
};

describe('ApiDegradedBanner', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when status is ok', () => {
    render(<ApiDegradedBanner health={ok} />);
    expect(screen.queryByTestId('api-degraded-banner')).not.toBeInTheDocument();
  });

  it('renders nothing while status is unknown (avoids flashing on first load)', () => {
    render(<ApiDegradedBanner health={unknown} />);
    expect(screen.queryByTestId('api-degraded-banner')).not.toBeInTheDocument();
  });

  it('renders the banner with affected dependency names when degraded', () => {
    render(<ApiDegradedBanner health={degraded} />);
    const banner = screen.getByTestId('api-degraded-banner');
    expect(banner).toHaveTextContent(/backend services degraded/i);
    expect(banner).toHaveTextContent(/dynamodb/);
    expect(banner).toHaveTextContent(/redis/);
  });
});
