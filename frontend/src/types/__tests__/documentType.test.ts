// Phase 51 / hub#66 — schema migration tests for the Pages → Sections layout.
//
// These tests pin the contract between legacy single-page types (no `pages`
// field) and the new pages-aware shape, so future changes to the migration
// helper (`getPagesView`) don't silently regress.

import { describe, it, expect } from 'vitest';
import type { DocumentType } from '../documentType';
import { getPagesView, getPageConfig, makeEmptyField } from '../documentType';

function legacyType(): DocumentType {
  const f1 = makeEmptyField('rich-text');
  const f2 = makeEmptyField('tasks');
  return {
    id: 't-legacy',
    name: 'Legacy',
    description: '',
    icon: '📄',
    fields: [f1, f2],
    // No `pages`, no `pageConfig` — pre-#66 shape.
    createdAt: '2026-04-30T00:00:00Z',
    updatedAt: '2026-04-30T00:00:00Z',
  };
}

describe('getPagesView (Phase 51 / hub#66 migration)', () => {
  it('derives a single page wrapping all fields when `pages` is absent', () => {
    const t = legacyType();
    const pages = getPagesView(t);
    expect(pages).toHaveLength(1);
    expect(pages[0].sectionIds).toHaveLength(2);
    expect(pages[0].sectionIds[0]).toBe(t.fields[0].id);
    expect(pages[0].sectionIds[1]).toBe(t.fields[1].id);
  });

  it('returns the existing pages array verbatim when present', () => {
    const t = legacyType();
    const customPages = [
      { id: 'p-1', title: 'Header', sectionIds: [t.fields[0].id] },
      { id: 'p-2', title: 'Body', sectionIds: [t.fields[1].id] },
    ];
    const next: DocumentType = { ...t, pages: customPages };
    const pages = getPagesView(next);
    expect(pages).toBe(customPages);
  });

  it('does not mutate the input', () => {
    const t = legacyType();
    const before = JSON.stringify(t);
    getPagesView(t);
    expect(JSON.stringify(t)).toBe(before);
  });
});

describe('getPageConfig', () => {
  it('returns safe defaults when pageConfig is absent', () => {
    const cfg = getPageConfig(legacyType());
    expect(cfg).toEqual({ showTableOfContents: false });
  });

  it('returns the stored config when present', () => {
    const t = { ...legacyType(), pageConfig: { showTableOfContents: true } };
    expect(getPageConfig(t)).toEqual({ showTableOfContents: true });
  });
});
