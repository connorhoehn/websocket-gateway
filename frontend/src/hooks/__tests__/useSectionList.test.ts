// frontend/src/hooks/__tests__/useSectionList.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useSectionList } from '../useSectionList';
import type { Section } from '../../types/document';

function makeSection(overrides: Partial<Section> = {}): Section {
  return {
    id: 's1',
    type: 'notes',
    title: 'Section 1',
    collapsed: false,
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSectionList', () => {
  it('starts with empty sections when ydoc is null', () => {
    const { result } = renderHook(() => useSectionList(null));
    expect(result.current.sections).toEqual([]);
  });

  it('addSection inserts a section; sections state reflects the Y.Array', async () => {
    const ydoc = new Y.Doc();
    const { result } = renderHook(() => useSectionList(ydoc));

    act(() => {
      result.current.addSection(makeSection({ id: 's1', title: 'A' }));
    });

    // Observer is debounced by 16ms — flush timers so state updates.
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.sections).toHaveLength(1);
    expect(result.current.sections[0]).toMatchObject({ id: 's1', title: 'A' });
  });

  it('updateSection mutates an existing section', () => {
    const ydoc = new Y.Doc();
    const { result } = renderHook(() => useSectionList(ydoc));

    act(() => {
      result.current.addSection(makeSection({ id: 's1', title: 'A' }));
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    act(() => {
      result.current.updateSection('s1', { title: 'B' });
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.sections[0]).toMatchObject({ id: 's1', title: 'B' });
  });

  it('addItem pushes an item into the nested items Y.Array', () => {
    const ydoc = new Y.Doc();
    const { result } = renderHook(() => useSectionList(ydoc));

    act(() => {
      result.current.addSection(makeSection({ id: 's1' }));
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    act(() => {
      result.current.addItem('s1', {
        id: 'i1',
        text: 'hi',
        status: 'pending',
        assignee: '',
        ackedBy: '',
        ackedAt: '',
        priority: 'low',
        notes: '',
      });
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.sections[0].items).toHaveLength(1);
    expect(result.current.sections[0].items[0]).toMatchObject({
      id: 'i1',
      text: 'hi',
    });
  });

  it('addComment stores a threaded comment on the section', () => {
    const ydoc = new Y.Doc();
    const { result } = renderHook(() => useSectionList(ydoc));

    act(() => {
      result.current.addSection(makeSection({ id: 's1' }));
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    act(() => {
      result.current.addComment('s1', {
        text: 'hello',
        userId: 'u1',
        displayName: 'Alice',
        color: '#f00',
      });
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.comments['s1']).toHaveLength(1);
    expect(result.current.comments['s1'][0]).toMatchObject({
      text: 'hello',
      userId: 'u1',
    });
  });

  it('getSectionFragment returns null first call, then the XmlFragment after microtask', async () => {
    vi.useRealTimers();
    const ydoc = new Y.Doc();
    const { result } = renderHook(() => useSectionList(ydoc));

    act(() => {
      result.current.addSection(makeSection({ id: 's1' }));
    });
    // Wait for debounced observer
    await new Promise((r) => setTimeout(r, 30));

    // First call returns null but schedules creation
    let frag = result.current.getSectionFragment('s1');
    expect(frag).toBeNull();

    // Flush microtasks
    await Promise.resolve();

    frag = result.current.getSectionFragment('s1');
    expect(frag).toBeInstanceOf(Y.XmlFragment);
  });
});
