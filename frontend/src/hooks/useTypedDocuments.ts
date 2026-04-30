// Phase 51 Phase A — API client hook for TypedDocument instances.
//
// Wraps fetch(${VITE_SOCIAL_API_URL}/api/typed-documents) with bearer auth
// and surfaces a small, callable API. Mirrors the useRooms convention —
// idToken is passed in by the caller, not read from a context (the codebase
// doesn't centralize auth context yet).

import { useCallback, useEffect, useState } from 'react';

// Phase B value shapes — match the social-api `TypedDocumentValue`. The
// route layer enforces (fieldType, cardinality) → value-shape correspondence.
export type TypedDocumentValue =
  | string
  | string[]
  | number
  | number[]
  | boolean;

// API-side shapes — these mirror the social-api contract for the new
// document-types feature. Distinct from the existing localStorage-backed
// `DocumentType` in `types/documentType.ts` (which uses a renderer-driven
// `sectionType` model). Phase A.5 will unify; for now they live in parallel.

export type ApiFieldKind =
  | 'text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'boolean';
export type ApiFieldWidget =
  | 'text_field'
  | 'textarea'
  | 'number_input'
  | 'date_picker'
  | 'checkbox';
export type ApiFieldCardinality = 1 | 'unlimited';

export interface ApiDocumentTypeField {
  fieldId: string;
  name: string;
  fieldType: ApiFieldKind;
  widget: ApiFieldWidget;
  cardinality: ApiFieldCardinality;
  required: boolean;
  helpText: string;
}

export interface ApiDocumentType {
  typeId: string;
  name: string;
  description: string;
  icon: string;
  fields: ApiDocumentTypeField[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TypedDocument {
  documentId: string;
  typeId: string;
  values: Record<string, TypedDocumentValue>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UseTypedDocumentsOptions {
  idToken: string | null;
  typeId: string | null;
}

export interface UseTypedDocumentsReturn {
  documents: TypedDocument[];
  loading: boolean;
  error: string | null;
  createDocument: (values: Record<string, TypedDocumentValue>) => Promise<TypedDocument>;
  refresh: () => void;
}

function getBaseUrl(): string {
  return (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';
}

export function useTypedDocuments({ idToken, typeId }: UseTypedDocumentsOptions): UseTypedDocumentsReturn {
  const [documents, setDocuments] = useState<TypedDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!idToken || !typeId) {
      setDocuments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${getBaseUrl()}/api/typed-documents?typeId=${encodeURIComponent(typeId)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
        return res.json() as Promise<{ items: TypedDocument[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setDocuments(data.items ?? []);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [idToken, typeId, reloadKey]);

  const createDocument = useCallback(
    async (values: Record<string, TypedDocumentValue>): Promise<TypedDocument> => {
      if (!idToken || !typeId) throw new Error('not ready: missing idToken or typeId');
      const res = await fetch(`${getBaseUrl()}/api/typed-documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ typeId, values }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Create failed (${res.status}): ${text}`);
      }
      const created = await res.json() as TypedDocument;
      setDocuments((prev) => [created, ...prev]);
      return created;
    },
    [idToken, typeId],
  );

  const refresh = useCallback((): void => {
    setReloadKey((k) => k + 1);
  }, []);

  return { documents, loading, error, createDocument, refresh };
}
