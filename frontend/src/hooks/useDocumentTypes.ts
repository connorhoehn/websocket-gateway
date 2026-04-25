// frontend/src/hooks/useDocumentTypes.ts
//
// CRUD hook for document type definitions, persisted in localStorage.
// State is kept in sync with storage so multiple hook instances see consistent
// data within the same tab (cross-tab sync is out of scope for now).

import { useState, useCallback } from 'react';
import type { DocumentType } from '../types/documentType';

export const STORAGE_KEY = 'ws_document_types_v1';

// ---------------------------------------------------------------------------
// Type guard — rejects any entry missing the required DocumentType fields.
// Silently drops stale/corrupt items rather than crashing or surfacing garbage.
// ---------------------------------------------------------------------------

export function isValidDocumentType(x: unknown): x is DocumentType {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id          === 'string' && o.id.length > 0 &&
    typeof o.name        === 'string' && o.name.length > 0 &&
    typeof o.description === 'string' &&
    typeof o.icon        === 'string' &&
    Array.isArray(o.fields) &&
    typeof o.createdAt   === 'string' &&
    typeof o.updatedAt   === 'string'
  );
}

// ---------------------------------------------------------------------------
// Helpers — deliberately separate from React so tests can call them directly
// ---------------------------------------------------------------------------

export function loadTypes(): DocumentType[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidDocumentType);
    // If any entries were invalid, rewrite storage immediately so future reads
    // don't carry the stale data forward.
    if (valid.length !== parsed.length) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(valid)); } catch { /* ignore */ }
    }
    return valid;
  } catch {
    return [];
  }
}

export function persistTypes(types: DocumentType[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
  } catch { /* ignore QuotaExceededError */ }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseDocumentTypesReturn {
  types: DocumentType[];
  createType: (data: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>) => DocumentType;
  updateType: (id: string, patch: Partial<Omit<DocumentType, 'id' | 'createdAt'>>) => void;
  deleteType: (id: string) => void;
  getType: (id: string) => DocumentType | undefined;
}

export function useDocumentTypes(): UseDocumentTypesReturn {
  const [types, setTypes] = useState<DocumentType[]>(loadTypes);

  const save = useCallback((next: DocumentType[]) => {
    persistTypes(next);
    setTypes(next);
  }, []);

  const createType = useCallback(
    (data: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>): DocumentType => {
      const now = new Date().toISOString();
      const newType: DocumentType = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      // Re-read from storage to avoid stale-closure races when multiple creates
      // happen before a re-render flushes the state update.
      save([...loadTypes(), newType]);
      return newType;
    },
    [save],
  );

  const updateType = useCallback(
    (id: string, patch: Partial<Omit<DocumentType, 'id' | 'createdAt'>>): void => {
      save(
        loadTypes().map(t =>
          t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t,
        ),
      );
    },
    [save],
  );

  const deleteType = useCallback(
    (id: string): void => {
      save(loadTypes().filter(t => t.id !== id));
    },
    [save],
  );

  const getType = useCallback(
    (id: string): DocumentType | undefined => types.find(t => t.id === id),
    [types],
  );

  return { types, createType, updateType, deleteType, getType };
}
