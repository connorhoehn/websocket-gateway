// frontend/src/hooks/__tests__/useDocumentMetadata.test.ts

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useDocumentMetadata } from '../useDocumentMetadata';

describe('useDocumentMetadata', () => {
  it('returns null meta when ydoc is null', () => {
    const { result } = renderHook(() => useDocumentMetadata(null));
    expect(result.current.meta).toBeNull();
  });

  it('emits meta on Y.Map change', () => {
    const ydoc = new Y.Doc();
    const { result } = renderHook(() => useDocumentMetadata(ydoc));

    expect(result.current.meta).toBeNull();

    act(() => {
      const yMeta = ydoc.getMap('meta');
      ydoc.transact(() => {
        yMeta.set('id', 'abc');
        yMeta.set('title', 'Hello');
        yMeta.set('sourceType', 'notes');
      });
    });

    expect(result.current.meta).toMatchObject({
      id: 'abc',
      title: 'Hello',
      sourceType: 'notes',
    });
  });

  it('updateMeta writes to the correct Y.Map', () => {
    const ydoc = new Y.Doc();
    const { result } = renderHook(() => useDocumentMetadata(ydoc));

    act(() => {
      result.current.updateMeta({ id: 'x', title: 'T' });
    });

    const yMeta = ydoc.getMap('meta');
    expect(yMeta.get('id')).toBe('x');
    expect(yMeta.get('title')).toBe('T');
    expect(result.current.meta).toMatchObject({ id: 'x', title: 'T' });
  });

  it('updateMeta is a no-op when ydoc is null (does not throw)', () => {
    const { result } = renderHook(() => useDocumentMetadata(null));
    expect(() =>
      act(() => {
        result.current.updateMeta({ title: 'nope' });
      }),
    ).not.toThrow();
  });
});
