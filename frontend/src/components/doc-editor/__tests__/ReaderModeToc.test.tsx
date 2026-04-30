// Phase 51 / hub#60 — sticky-left TOC tests for ReaderMode.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import ReaderMode from '../ReaderMode';
import type { Section, Participant, DocumentMeta } from '../../../types/document';

afterEach(() => cleanup());

function makeMeta(): DocumentMeta {
  return {
    id: 'd-1',
    title: 'Sample design',
    type: 'design',
    status: 'draft',
    createdBy: 'u1',
    createdByName: 'Author',
    createdAt: '2026-04-30T10:00:00Z',
    updatedAt: '2026-04-30T10:00:00Z',
    icon: '📄',
  } as DocumentMeta;
}

function makeSection(id: string, title: string): Section {
  return {
    id,
    type: 'custom',
    title,
    collapsed: false,
    items: [],
    sectionType: 'rich-text',
  };
}

const noParticipants: Participant[] = [];

describe('ReaderMode TOC (hub#60)', () => {
  it('does NOT render the TOC when there is only one section', () => {
    render(
      <ReaderMode
        sections={[makeSection('s-1', 'Only')]}
        participants={noParticipants}
        meta={makeMeta()}
      />,
    );
    expect(screen.queryByTestId('reader-toc')).not.toBeInTheDocument();
  });

  it('renders a TOC entry per section when there are 2+', () => {
    render(
      <ReaderMode
        sections={[
          makeSection('s-a', 'Action Items'),
          makeSection('s-b', 'Decision Log'),
          makeSection('s-c', 'Body'),
        ]}
        participants={noParticipants}
        meta={makeMeta()}
      />,
    );
    expect(screen.getByTestId('reader-toc')).toBeInTheDocument();
    expect(screen.getByTestId('toc-link-s-a')).toHaveTextContent('Action Items');
    expect(screen.getByTestId('toc-link-s-b')).toHaveTextContent('Decision Log');
    expect(screen.getByTestId('toc-link-s-c')).toHaveTextContent('Body');
  });

  it('TOC links carry section-anchor href so middle-click / open-in-tab still works', () => {
    render(
      <ReaderMode
        sections={[makeSection('s-1', 'A'), makeSection('s-2', 'B')]}
        participants={noParticipants}
        meta={makeMeta()}
      />,
    );
    const link = screen.getByTestId('toc-link-s-1') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#section-s-1');
  });

  it('clicking a TOC link calls scrollIntoView on the matching section', () => {
    render(
      <ReaderMode
        sections={[makeSection('s-x', 'First'), makeSection('s-y', 'Second')]}
        participants={noParticipants}
        meta={makeMeta()}
      />,
    );
    const target = screen.getByTestId('reader-section-s-y');
    const scrollSpy = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', { value: scrollSpy, configurable: true });

    fireEvent.click(screen.getByTestId('toc-link-s-y'));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('section containers expose an id for anchor-fallback navigation', () => {
    render(
      <ReaderMode
        sections={[makeSection('s-id1', 'One'), makeSection('s-id2', 'Two')]}
        participants={noParticipants}
        meta={makeMeta()}
      />,
    );
    expect(document.getElementById('section-s-id1')).not.toBeNull();
    expect(document.getElementById('section-s-id2')).not.toBeNull();
  });
});
