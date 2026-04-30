// frontend/src/hooks/useDocumentTypes.ts
//
// CRUD hook for document type definitions, persisted in localStorage.
// State is kept in sync with storage so multiple hook instances see consistent
// data within the same tab (cross-tab sync is out of scope for now).
//
// Phase 51 Phase A.5: when an `idToken` is supplied via options, every
// successful local save also fires a best-effort POST/PUT/DELETE to the
// new server-side `/api/document-types` endpoint. The local store remains
// authoritative; the server sync is fire-and-forget and never blocks the
// UI. A `lastSync` snapshot exposes the most recent op + outcome so the
// caller can decorate save banners with sync status.

import { useState, useCallback, useRef } from 'react';
import type { DocumentType } from '../types/documentType';
import {
  syncDocumentTypeCreate,
  syncDocumentTypeUpdate,
  syncDocumentTypeDelete,
} from '../lib/documentTypeApiAdapter';

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

export type SyncOp = 'create' | 'update' | 'delete';

export interface SyncStatus {
  /** Operation that triggered the most recent sync. */
  op: SyncOp;
  /** Whether the server round-trip succeeded. */
  ok: boolean;
  /** Increases on every recorded sync so UI keys can react. */
  key: number;
  /** Optional error message for failed syncs. */
  error?: string;
}

export interface UseDocumentTypesOptions {
  /** Cognito ID token. When present, saves dual-write to the server. */
  idToken?: string | null;
}

export interface UseDocumentTypesReturn {
  types: DocumentType[];
  createType: (data: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>) => DocumentType;
  updateType: (id: string, patch: Partial<Omit<DocumentType, 'id' | 'createdAt'>>) => void;
  deleteType: (id: string) => void;
  getType: (id: string) => DocumentType | undefined;
  /** Most recent server-sync outcome. null until the first sync attempt. */
  lastSync: SyncStatus | null;
}

export function useDocumentTypes(options: UseDocumentTypesOptions = {}): UseDocumentTypesReturn {
  const { idToken } = options;
  const idTokenRef = useRef(idToken);
  idTokenRef.current = idToken;

  const [types, setTypes] = useState<DocumentType[]>(loadTypes);
  const [lastSync, setLastSync] = useState<SyncStatus | null>(null);
  const syncKeyRef = useRef(0);

  const recordSync = useCallback((op: SyncOp, ok: boolean, error?: string): void => {
    syncKeyRef.current += 1;
    setLastSync({ op, ok, key: syncKeyRef.current, error });
  }, []);

  const save = useCallback((next: DocumentType[]) => {
    persistTypes(next);
    setTypes(next);
  }, []);

  const createType = useCallback(
    (data: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>): DocumentType => {
      const now = new Date().toISOString();
      const newType: DocumentType = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      save([...loadTypes(), newType]);
      const token = idTokenRef.current;
      if (token) {
        // Best-effort sync — fire-and-forget; surface outcome via lastSync.
        void syncDocumentTypeCreate(newType, token).then((r) => {
          recordSync('create', r.ok, r.error);
        });
      }
      return newType;
    },
    [save, recordSync],
  );

  const updateType = useCallback(
    (id: string, patch: Partial<Omit<DocumentType, 'id' | 'createdAt'>>): void => {
      let updated: DocumentType | null = null;
      const next = loadTypes().map((t) => {
        if (t.id === id) {
          updated = { ...t, ...patch, updatedAt: new Date().toISOString() };
          return updated;
        }
        return t;
      });
      save(next);
      const token = idTokenRef.current;
      if (token && updated) {
        const localCopy = updated;
        void syncDocumentTypeUpdate(localCopy, token).then((r) => {
          recordSync('update', r.ok, r.error);
        });
      }
    },
    [save, recordSync],
  );

  const deleteType = useCallback(
    (id: string): void => {
      save(loadTypes().filter(t => t.id !== id));
      const token = idTokenRef.current;
      if (token) {
        void syncDocumentTypeDelete(id, token).then((r) => {
          recordSync('delete', r.ok, r.error);
        });
      }
    },
    [save, recordSync],
  );

  const getType = useCallback(
    (id: string): DocumentType | undefined => types.find(t => t.id === id),
    [types],
  );

  return { types, createType, updateType, deleteType, getType, lastSync };
}
