// Phase 51 Phase E — display-mode helper tests.

import { describe, it, expect } from 'vitest';
import { isFieldVisibleInMode, visibleFieldsForMode, ALL_DISPLAY_MODES } from './displayMode';
import type { ApiDocumentType, ApiDocumentTypeField } from '../../hooks/useTypedDocuments';

function field(over: Partial<ApiDocumentTypeField> & Pick<ApiDocumentTypeField, 'fieldId' | 'name'>): ApiDocumentTypeField {
  return {
    fieldId: over.fieldId,
    name: over.name,
    fieldType: over.fieldType ?? 'text',
    widget: over.widget ?? 'text_field',
    cardinality: over.cardinality ?? 1,
    required: over.required ?? false,
    helpText: over.helpText ?? '',
    ...(over.displayModes !== undefined ? { displayModes: over.displayModes } : {}),
  };
}

function makeType(fields: ApiDocumentTypeField[]): ApiDocumentType {
  return {
    typeId: 't', name: 'T', description: '', icon: '📄',
    fields, createdBy: 'admin', createdAt: '2026-04-30T00:00:00Z', updatedAt: '2026-04-30T00:00:00Z',
  };
}

describe('isFieldVisibleInMode', () => {
  it('defaults absent displayModes to full=true, teaser=false, list=false', () => {
    const f = field({ fieldId: 'a', name: 'a' });
    expect(isFieldVisibleInMode(f, 'full')).toBe(true);
    expect(isFieldVisibleInMode(f, 'teaser')).toBe(false);
    expect(isFieldVisibleInMode(f, 'list')).toBe(false);
  });

  it('respects explicit per-mode opt-in / opt-out', () => {
    const f = field({ fieldId: 'a', name: 'a', displayModes: { full: false, teaser: true, list: true } });
    expect(isFieldVisibleInMode(f, 'full')).toBe(false);
    expect(isFieldVisibleInMode(f, 'teaser')).toBe(true);
    expect(isFieldVisibleInMode(f, 'list')).toBe(true);
  });

  it('falls back to default when a specific mode key is unset', () => {
    const f = field({ fieldId: 'a', name: 'a', displayModes: { teaser: true } });
    // full defaulted to true (no override), teaser explicit true, list defaulted to false
    expect(isFieldVisibleInMode(f, 'full')).toBe(true);
    expect(isFieldVisibleInMode(f, 'teaser')).toBe(true);
    expect(isFieldVisibleInMode(f, 'list')).toBe(false);
  });
});

describe('visibleFieldsForMode', () => {
  it('full mode returns every field with default-or-true full', () => {
    const t = makeType([
      field({ fieldId: 'a', name: 'a' }),
      field({ fieldId: 'b', name: 'b', displayModes: { full: false } }),
      field({ fieldId: 'c', name: 'c', displayModes: { full: true, teaser: true } }),
    ]);
    expect(visibleFieldsForMode(t, 'full').map((f) => f.fieldId)).toEqual(['a', 'c']);
  });

  it('teaser mode returns only fields opted in', () => {
    const t = makeType([
      field({ fieldId: 'title', name: 'title', displayModes: { teaser: true, list: true } }),
      field({ fieldId: 'body',  name: 'body' }),
      field({ fieldId: 'date',  name: 'date', displayModes: { teaser: true } }),
    ]);
    expect(visibleFieldsForMode(t, 'teaser').map((f) => f.fieldId)).toEqual(['title', 'date']);
  });

  it('list mode returns empty when no field opts in', () => {
    const t = makeType([
      field({ fieldId: 'a', name: 'a' }),
      field({ fieldId: 'b', name: 'b', displayModes: { teaser: true } }),
    ]);
    expect(visibleFieldsForMode(t, 'list')).toEqual([]);
  });

  it('preserves declaration order', () => {
    const t = makeType([
      field({ fieldId: 'z', name: 'z', displayModes: { teaser: true } }),
      field({ fieldId: 'a', name: 'a', displayModes: { teaser: true } }),
      field({ fieldId: 'm', name: 'm', displayModes: { teaser: true } }),
    ]);
    expect(visibleFieldsForMode(t, 'teaser').map((f) => f.fieldId)).toEqual(['z', 'a', 'm']);
  });
});

describe('ALL_DISPLAY_MODES', () => {
  it('exports the full / teaser / list triple in render-priority order', () => {
    expect(ALL_DISPLAY_MODES).toEqual(['full', 'teaser', 'list']);
  });
});
