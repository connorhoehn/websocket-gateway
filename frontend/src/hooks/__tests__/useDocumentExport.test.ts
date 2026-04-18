// frontend/src/hooks/__tests__/useDocumentExport.test.ts

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useDocumentExport } from '../useDocumentExport';

describe('useDocumentExport', () => {
  it('returns null when ydoc is null', () => {
    const { result } = renderHook(() => useDocumentExport(null));
    expect(result.current.exportJSON()).toBeNull();
  });

  it('returns null when meta is empty', () => {
    const ydoc = new Y.Doc();
    const { result } = renderHook(() => useDocumentExport(ydoc));
    expect(result.current.exportJSON()).toBeNull();
  });

  it('exports meta + sections (with nested items) as plain JS', () => {
    const ydoc = new Y.Doc();

    ydoc.transact(() => {
      const meta = ydoc.getMap('meta');
      meta.set('id', 'd1');
      meta.set('title', 'Doc');
      meta.set('sourceType', 'notes');
      meta.set('sourceId', 's1');
      meta.set('createdBy', 'u1');
      meta.set('createdAt', '2020-01-01');
      meta.set('aiModel', 'test');
      meta.set('status', 'draft');

      const sections = ydoc.getArray<Y.Map<unknown>>('sections');
      const section = new Y.Map<unknown>();
      section.set('id', 'sec1');
      section.set('type', 'tasks');
      section.set('title', 'T');
      section.set('collapsed', false);

      const items = new Y.Array<Y.Map<unknown>>();
      const item = new Y.Map<unknown>();
      item.set('id', 'i1');
      item.set('text', 'hello');
      item.set('status', 'pending');
      items.push([item]);
      section.set('items', items);
      sections.push([section]);
    });

    const { result } = renderHook(() => useDocumentExport(ydoc));
    const exported = result.current.exportJSON();

    expect(exported).not.toBeNull();
    expect(exported!.meta).toMatchObject({ id: 'd1', title: 'Doc' });
    expect(exported!.sections).toHaveLength(1);
    expect(exported!.sections[0]).toMatchObject({
      id: 'sec1',
      type: 'tasks',
      title: 'T',
    });
    expect(exported!.sections[0].items).toHaveLength(1);
    expect(exported!.sections[0].items[0]).toMatchObject({
      id: 'i1',
      text: 'hello',
    });
  });
});
