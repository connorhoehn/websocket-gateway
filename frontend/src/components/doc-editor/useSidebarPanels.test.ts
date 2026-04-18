// frontend/src/components/doc-editor/useSidebarPanels.test.ts
//
// Unit tests for the useSidebarPanels hook — a mutually-exclusive
// activePanel state machine across four sidebar panels.

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebarPanels } from './useSidebarPanels';

describe('useSidebarPanels', () => {
  it('initial state has no active panel and all show* flags false', () => {
    const { result } = renderHook(() => useSidebarPanels());

    expect(result.current.activePanel).toBeNull();
    expect(result.current.showHistory).toBe(false);
    expect(result.current.showMyItems).toBe(false);
    expect(result.current.showWorkflows).toBe(false);
    expect(result.current.showVideoHistory).toBe(false);
  });

  it('accepts initialPanel option and reflects it', () => {
    const { result } = renderHook(() =>
      useSidebarPanels({ initialPanel: 'history' }),
    );

    expect(result.current.activePanel).toBe('history');
    expect(result.current.showHistory).toBe(true);
    expect(result.current.showMyItems).toBe(false);
    expect(result.current.showWorkflows).toBe(false);
    expect(result.current.showVideoHistory).toBe(false);
  });

  it('accepts each of the four initialPanel values', () => {
    const panels = ['history', 'myItems', 'workflows', 'videoHistory'] as const;
    for (const p of panels) {
      const { result } = renderHook(() => useSidebarPanels({ initialPanel: p }));
      expect(result.current.activePanel).toBe(p);
    }
  });

  it('toggleHistory() once sets showHistory true with all other flags false', () => {
    const { result } = renderHook(() => useSidebarPanels());

    act(() => {
      result.current.toggleHistory();
    });

    expect(result.current.activePanel).toBe('history');
    expect(result.current.showHistory).toBe(true);
    expect(result.current.showMyItems).toBe(false);
    expect(result.current.showWorkflows).toBe(false);
    expect(result.current.showVideoHistory).toBe(false);
  });

  it('toggleHistory() twice returns to all-false state', () => {
    const { result } = renderHook(() => useSidebarPanels());

    act(() => {
      result.current.toggleHistory();
    });
    act(() => {
      result.current.toggleHistory();
    });

    expect(result.current.activePanel).toBeNull();
    expect(result.current.showHistory).toBe(false);
    expect(result.current.showMyItems).toBe(false);
    expect(result.current.showWorkflows).toBe(false);
    expect(result.current.showVideoHistory).toBe(false);
  });

  it('opening a different panel while another is open switches (mutual exclusion)', () => {
    const { result } = renderHook(() => useSidebarPanels());

    act(() => {
      result.current.toggleHistory();
    });
    expect(result.current.showHistory).toBe(true);
    expect(result.current.showMyItems).toBe(false);

    act(() => {
      result.current.toggleMyItems();
    });

    expect(result.current.activePanel).toBe('myItems');
    expect(result.current.showHistory).toBe(false);
    expect(result.current.showMyItems).toBe(true);
    expect(result.current.showWorkflows).toBe(false);
    expect(result.current.showVideoHistory).toBe(false);
  });

  it('toggleWorkflows and toggleVideoHistory participate in mutual exclusion', () => {
    const { result } = renderHook(() => useSidebarPanels());

    act(() => {
      result.current.toggleWorkflows();
    });
    expect(result.current.showWorkflows).toBe(true);

    act(() => {
      result.current.toggleVideoHistory();
    });
    expect(result.current.showWorkflows).toBe(false);
    expect(result.current.showVideoHistory).toBe(true);
    expect(result.current.activePanel).toBe('videoHistory');
  });

  it('openPanel("workflows") sets activePanel regardless of prior state', () => {
    const { result } = renderHook(() => useSidebarPanels());

    // From null
    act(() => {
      result.current.openPanel('workflows');
    });
    expect(result.current.activePanel).toBe('workflows');
    expect(result.current.showWorkflows).toBe(true);

    // From another open panel
    act(() => {
      result.current.openPanel('history');
    });
    act(() => {
      result.current.openPanel('workflows');
    });
    expect(result.current.activePanel).toBe('workflows');
    expect(result.current.showWorkflows).toBe(true);
    expect(result.current.showHistory).toBe(false);
  });

  it('closePanel() sets activePanel back to null', () => {
    const { result } = renderHook(() =>
      useSidebarPanels({ initialPanel: 'myItems' }),
    );
    expect(result.current.activePanel).toBe('myItems');

    act(() => {
      result.current.closePanel();
    });

    expect(result.current.activePanel).toBeNull();
    expect(result.current.showMyItems).toBe(false);
  });

  it('closePanel() when nothing is open is a no-op', () => {
    const { result } = renderHook(() => useSidebarPanels());
    expect(result.current.activePanel).toBeNull();

    act(() => {
      result.current.closePanel();
    });

    expect(result.current.activePanel).toBeNull();
  });

  it('returned callbacks are stable across renders (useCallback)', () => {
    const { result, rerender } = renderHook(() => useSidebarPanels());

    const before = {
      toggleHistory: result.current.toggleHistory,
      toggleMyItems: result.current.toggleMyItems,
      toggleWorkflows: result.current.toggleWorkflows,
      toggleVideoHistory: result.current.toggleVideoHistory,
      openPanel: result.current.openPanel,
      closePanel: result.current.closePanel,
    };

    rerender();

    expect(result.current.toggleHistory).toBe(before.toggleHistory);
    expect(result.current.toggleMyItems).toBe(before.toggleMyItems);
    expect(result.current.toggleWorkflows).toBe(before.toggleWorkflows);
    expect(result.current.toggleVideoHistory).toBe(before.toggleVideoHistory);
    expect(result.current.openPanel).toBe(before.openPanel);
    expect(result.current.closePanel).toBe(before.closePanel);
  });

  it('callbacks remain stable even after state changes', () => {
    const { result } = renderHook(() => useSidebarPanels());

    const beforeToggleHistory = result.current.toggleHistory;
    const beforeOpenPanel = result.current.openPanel;
    const beforeClosePanel = result.current.closePanel;

    act(() => {
      result.current.toggleHistory();
    });

    expect(result.current.toggleHistory).toBe(beforeToggleHistory);
    expect(result.current.openPanel).toBe(beforeOpenPanel);
    expect(result.current.closePanel).toBe(beforeClosePanel);
  });
});
