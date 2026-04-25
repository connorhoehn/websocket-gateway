// frontend/src/hooks/__tests__/useDocumentTypes.test.ts
//
// Coverage for the localStorage-backed document types CRUD hook.
// Tests the pure helpers (loadTypes, persistTypes) and all hook operations.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  loadTypes,
  persistTypes,
  isValidDocumentType,
  useDocumentTypes,
  STORAGE_KEY,
} from '../useDocumentTypes';
import type { DocumentType } from '../../types/documentType';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeType(overrides: Partial<DocumentType> = {}): DocumentType {
  return {
    id: crypto.randomUUID(),
    name: 'Test Type',
    description: 'A test type',
    icon: '📄',
    fields: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function seedStorage(types: DocumentType[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// isValidDocumentType
// ---------------------------------------------------------------------------

describe('isValidDocumentType', () => {
  it('accepts a fully-formed DocumentType', () => {
    expect(isValidDocumentType(makeType())).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidDocumentType(null)).toBe(false);
  });

  it('rejects a plain string', () => {
    expect(isValidDocumentType('hello')).toBe(false);
  });

  it('rejects an object missing id', () => {
    const { id: _id, ...rest } = makeType();
    expect(isValidDocumentType(rest)).toBe(false);
  });

  it('rejects an object with an empty id', () => {
    expect(isValidDocumentType(makeType({ id: '' }))).toBe(false);
  });

  it('rejects an object missing name', () => {
    const { name: _name, ...rest } = makeType();
    expect(isValidDocumentType(rest)).toBe(false);
  });

  it('rejects an object with an empty name', () => {
    expect(isValidDocumentType(makeType({ name: '' }))).toBe(false);
  });

  it('rejects an object where fields is not an array', () => {
    expect(isValidDocumentType({ ...makeType(), fields: 'bad' })).toBe(false);
  });

  it('rejects an object missing createdAt', () => {
    const { createdAt: _c, ...rest } = makeType();
    expect(isValidDocumentType(rest)).toBe(false);
  });

  it('rejects an object missing updatedAt', () => {
    const { updatedAt: _u, ...rest } = makeType();
    expect(isValidDocumentType(rest)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadTypes
// ---------------------------------------------------------------------------

describe('loadTypes', () => {
  it('returns empty array when storage is empty', () => {
    expect(loadTypes()).toEqual([]);
  });

  it('parses a valid JSON array from storage', () => {
    const types = [makeType({ name: 'Alpha' }), makeType({ name: 'Beta' })];
    seedStorage(types);
    expect(loadTypes()).toEqual(types);
  });

  it('returns empty array for corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(loadTypes()).toEqual([]);
  });

  it('returns empty array for a non-array JSON value (string)', () => {
    localStorage.setItem(STORAGE_KEY, '"just a string"');
    expect(loadTypes()).toEqual([]);
  });

  it('returns empty array for a JSON null', () => {
    localStorage.setItem(STORAGE_KEY, 'null');
    expect(loadTypes()).toEqual([]);
  });

  it('filters out entries that are missing required fields', () => {
    const good = makeType({ name: 'Good' });
    const bad  = { id: 'x', title: 'stale pre-schema entry' }; // no name/fields/etc
    localStorage.setItem(STORAGE_KEY, JSON.stringify([good, bad]));
    const result = loadTypes();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Good');
  });

  it('filters out entries where name is empty string', () => {
    const good    = makeType({ name: 'Valid' });
    const unnamed = makeType({ name: '' });
    localStorage.setItem(STORAGE_KEY, JSON.stringify([good, unnamed]));
    expect(loadTypes()).toHaveLength(1);
  });

  it('rewrites storage when invalid entries are stripped', () => {
    const good = makeType({ name: 'Keep' });
    const bad  = { id: 'old', name: '' }; // invalid
    localStorage.setItem(STORAGE_KEY, JSON.stringify([good, bad]));
    loadTypes();
    // Storage should now only contain the valid entry
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Keep');
  });

  it('does not rewrite storage when all entries are valid', () => {
    const types = [makeType({ name: 'A' }), makeType({ name: 'B' })];
    seedStorage(types);
    const originalRaw = localStorage.getItem(STORAGE_KEY);
    loadTypes();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(originalRaw);
  });

  it('returns empty array and does not throw for an empty array in storage', () => {
    localStorage.setItem(STORAGE_KEY, '[]');
    expect(loadTypes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// persistTypes
// ---------------------------------------------------------------------------

describe('persistTypes', () => {
  it('writes a JSON-serialised array to the storage key', () => {
    const types = [makeType({ name: 'Gamma' })];
    persistTypes(types);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!)).toEqual(types);
  });

  it('overwrites any existing value', () => {
    const original = [makeType({ name: 'Old' })];
    const replacement = [makeType({ name: 'New' })];
    seedStorage(original);
    persistTypes(replacement);
    expect(loadTypes()).toEqual(replacement);
  });

  it('persists an empty array', () => {
    seedStorage([makeType()]);
    persistTypes([]);
    expect(loadTypes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// useDocumentTypes — initial state
// ---------------------------------------------------------------------------

describe('useDocumentTypes — initial state', () => {
  it('returns an empty types array when storage is empty', () => {
    const { result } = renderHook(() => useDocumentTypes());
    expect(result.current.types).toEqual([]);
  });

  it('loads pre-existing types from storage on mount', () => {
    const stored = [makeType({ name: 'Loaded' })];
    seedStorage(stored);
    const { result } = renderHook(() => useDocumentTypes());
    expect(result.current.types).toEqual(stored);
  });
});

// ---------------------------------------------------------------------------
// createType
// ---------------------------------------------------------------------------

describe('createType', () => {
  it('returns the new type with an id, createdAt, and updatedAt', () => {
    const { result } = renderHook(() => useDocumentTypes());
    let created: DocumentType;
    act(() => {
      created = result.current.createType({
        name: 'Sprint Planning',
        description: 'Agile sprint template',
        icon: '🚀',
        fields: [],
      });
    });
    expect(created!.id).toBeTruthy();
    expect(created!.createdAt).toBeTruthy();
    expect(created!.updatedAt).toBeTruthy();
    expect(created!.name).toBe('Sprint Planning');
  });

  it('adds the new type to the types array', () => {
    const { result } = renderHook(() => useDocumentTypes());
    act(() => {
      result.current.createType({ name: 'A', description: '', icon: '📄', fields: [] });
    });
    expect(result.current.types).toHaveLength(1);
    expect(result.current.types[0].name).toBe('A');
  });

  it('persists the new type to localStorage', () => {
    const { result } = renderHook(() => useDocumentTypes());
    act(() => {
      result.current.createType({ name: 'Persisted', description: '', icon: '📋', fields: [] });
    });
    const stored = loadTypes();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Persisted');
  });

  it('accumulates multiple creates correctly (stale-closure protection)', () => {
    const { result } = renderHook(() => useDocumentTypes());
    act(() => {
      result.current.createType({ name: 'First',  description: '', icon: '📄', fields: [] });
      result.current.createType({ name: 'Second', description: '', icon: '📋', fields: [] });
    });
    expect(result.current.types).toHaveLength(2);
    expect(loadTypes()).toHaveLength(2);
  });

  it('three rapid creates all survive without re-render between them', () => {
    const { result } = renderHook(() => useDocumentTypes());
    act(() => {
      result.current.createType({ name: 'X', description: '', icon: '📄', fields: [] });
      result.current.createType({ name: 'Y', description: '', icon: '📋', fields: [] });
      result.current.createType({ name: 'Z', description: '', icon: '🗒️', fields: [] });
    });
    expect(result.current.types).toHaveLength(3);
    expect(loadTypes()).toHaveLength(3);
    const names = result.current.types.map(t => t.name);
    expect(names).toContain('X');
    expect(names).toContain('Y');
    expect(names).toContain('Z');
  });
});

// ---------------------------------------------------------------------------
// updateType
// ---------------------------------------------------------------------------

describe('updateType', () => {
  it('applies a patch and updates updatedAt', () => {
    const original = makeType({ name: 'Original', updatedAt: '2020-01-01T00:00:00.000Z' });
    seedStorage([original]);
    const { result } = renderHook(() => useDocumentTypes());

    act(() => {
      result.current.updateType(original.id, { name: 'Renamed' });
    });

    const updated = result.current.types.find(t => t.id === original.id)!;
    expect(updated.name).toBe('Renamed');
    expect(updated.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(updated.createdAt).toBe(original.createdAt);
  });

  it('preserves other types when patching one', () => {
    const a = makeType({ name: 'A' });
    const b = makeType({ name: 'B' });
    seedStorage([a, b]);
    const { result } = renderHook(() => useDocumentTypes());

    act(() => {
      result.current.updateType(a.id, { name: 'A-updated' });
    });

    expect(result.current.types).toHaveLength(2);
    expect(result.current.types.find(t => t.id === b.id)!.name).toBe('B');
  });

  it('persists the patch to localStorage', () => {
    const original = makeType({ name: 'Before' });
    seedStorage([original]);
    const { result } = renderHook(() => useDocumentTypes());

    act(() => {
      result.current.updateType(original.id, { name: 'After', description: 'new desc' });
    });

    const stored = loadTypes().find(t => t.id === original.id)!;
    expect(stored.name).toBe('After');
    expect(stored.description).toBe('new desc');
  });

  it('is a no-op (no error) when id does not exist', () => {
    seedStorage([makeType({ name: 'Existing' })]);
    const { result } = renderHook(() => useDocumentTypes());

    expect(() => {
      act(() => {
        result.current.updateType('nonexistent-id', { name: 'Ghost' });
      });
    }).not.toThrow();

    expect(result.current.types).toHaveLength(1);
    expect(result.current.types[0].name).toBe('Existing');
  });
});

// ---------------------------------------------------------------------------
// deleteType
// ---------------------------------------------------------------------------

describe('deleteType', () => {
  it('removes the type from the types array', () => {
    const toDelete = makeType({ name: 'Delete Me' });
    const toKeep   = makeType({ name: 'Keep Me' });
    seedStorage([toDelete, toKeep]);
    const { result } = renderHook(() => useDocumentTypes());

    act(() => {
      result.current.deleteType(toDelete.id);
    });

    expect(result.current.types).toHaveLength(1);
    expect(result.current.types[0].id).toBe(toKeep.id);
  });

  it('persists the deletion to localStorage', () => {
    const toDelete = makeType();
    seedStorage([toDelete]);
    const { result } = renderHook(() => useDocumentTypes());

    act(() => {
      result.current.deleteType(toDelete.id);
    });

    expect(loadTypes()).toHaveLength(0);
  });

  it('is a no-op (no error) when id does not exist', () => {
    const existing = makeType({ name: 'Keep' });
    seedStorage([existing]);
    const { result } = renderHook(() => useDocumentTypes());

    expect(() => {
      act(() => {
        result.current.deleteType('ghost-id');
      });
    }).not.toThrow();

    expect(result.current.types).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getType
// ---------------------------------------------------------------------------

describe('getType', () => {
  it('returns the matching type by id', () => {
    const target = makeType({ name: 'Target' });
    seedStorage([target, makeType({ name: 'Other' })]);
    const { result } = renderHook(() => useDocumentTypes());
    expect(result.current.getType(target.id)).toMatchObject({ name: 'Target' });
  });

  it('returns undefined for an unknown id', () => {
    const { result } = renderHook(() => useDocumentTypes());
    expect(result.current.getType('not-here')).toBeUndefined();
  });

  it('reflects state after createType', () => {
    const { result } = renderHook(() => useDocumentTypes());
    let created: DocumentType;
    act(() => {
      created = result.current.createType({ name: 'Newly Created', description: '', icon: '📄', fields: [] });
    });
    expect(result.current.getType(created!.id)).toMatchObject({ name: 'Newly Created' });
  });

  it('returns undefined after deleteType', () => {
    const type = makeType();
    seedStorage([type]);
    const { result } = renderHook(() => useDocumentTypes());

    act(() => {
      result.current.deleteType(type.id);
    });

    expect(result.current.getType(type.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// persistence across remount (simulates page refresh)
// ---------------------------------------------------------------------------

describe('persistence across remount', () => {
  it('a second hook instance picks up types created by the first', () => {
    const { result: r1 } = renderHook(() => useDocumentTypes());
    act(() => {
      r1.current.createType({ name: 'Persistent', description: '', icon: '📄', fields: [] });
    });

    const { result: r2 } = renderHook(() => useDocumentTypes());
    expect(r2.current.types).toHaveLength(1);
    expect(r2.current.types[0].name).toBe('Persistent');
  });

  it('deletions are visible to a newly mounted hook', () => {
    const type = makeType();
    seedStorage([type]);

    const { result: r1 } = renderHook(() => useDocumentTypes());
    act(() => {
      r1.current.deleteType(type.id);
    });

    const { result: r2 } = renderHook(() => useDocumentTypes());
    expect(r2.current.types).toHaveLength(0);
  });
});
