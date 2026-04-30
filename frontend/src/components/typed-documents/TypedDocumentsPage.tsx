// Phase 51 Phase A — page that lists API-side document types, lets the
// end-user pick one, renders an auto-generated form for that type, and
// shows the resulting persisted instances below the form.
//
// Phase A scope: read-only on types (CRUD on types is the wizard's job).
// Phase A.5 will unify the type-creation surface; until then this page
// simply consumes whatever types the backend has.

import { useEffect, useState } from 'react';
import { TypedDocumentForm } from './TypedDocumentForm';
import {
  useTypedDocuments,
  type ApiDocumentType,
  type TypedDocument,
} from '../../hooks/useTypedDocuments';

interface Props {
  idToken: string | null;
}

function getBaseUrl(): string {
  return (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';
}

export function TypedDocumentsPage({ idToken }: Props): JSX.Element {
  const [types, setTypes] = useState<ApiDocumentType[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);

  // Fetch the list of document types from the backend.
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    setTypesLoading(true);
    setTypesError(null);
    fetch(`${getBaseUrl()}/api/document-types`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load types (${res.status})`);
        return res.json() as Promise<{ items: ApiDocumentType[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setTypes(data.items ?? []);
        if ((data.items ?? []).length > 0 && !selectedTypeId) {
          setSelectedTypeId(data.items[0].typeId);
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setTypesError(err.message);
      })
      .finally(() => {
        if (!cancelled) setTypesLoading(false);
      });
    return () => { cancelled = true; };
  }, [idToken]);

  const selectedType = types.find((t) => t.typeId === selectedTypeId) ?? null;

  const { documents, loading: docsLoading, error: docsError, createDocument } = useTypedDocuments({
    idToken,
    typeId: selectedTypeId,
  });

  return (
    <div data-testid="typed-documents-page" style={{ display: 'flex', height: '100%', overflow: 'hidden', fontFamily: 'inherit' }}>

      <aside style={{ width: 240, flexShrink: 0, borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fafbfc' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0', fontSize: 13, fontWeight: 700, color: '#374151' }}>
          Document Types
        </div>
        <div data-testid="types-list" style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {typesLoading && <div style={{ color: '#94a3b8', fontSize: 13, padding: 12 }}>Loading…</div>}
          {typesError && (
            <div data-testid="types-error" role="alert" style={{ color: '#dc2626', fontSize: 13, padding: 12 }}>
              {typesError}
            </div>
          )}
          {!typesLoading && !typesError && types.length === 0 && (
            <div data-testid="types-empty" style={{ color: '#94a3b8', fontSize: 13, padding: 12 }}>
              No types yet. Use the wizard to create one.
            </div>
          )}
          {types.map((t) => (
            <button
              key={t.typeId}
              data-testid={`type-${t.typeId}`}
              onClick={() => setSelectedTypeId(t.typeId)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', textAlign: 'left',
                padding: '8px 10px', borderRadius: 7, marginBottom: 2,
                background: selectedTypeId === t.typeId ? '#ede9fe' : 'transparent',
                border: selectedTypeId === t.typeId ? '1px solid #c4b5fd' : '1px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
              }}
            >
              <span style={{ fontSize: 18 }}>{t.icon}</span>
              <span style={{ flex: 1, color: '#0f172a' }}>{t.name}</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px' }} data-testid="typed-documents-main">
        {!selectedType && (
          <div data-testid="empty-detail" style={{ color: '#94a3b8', fontSize: 14 }}>
            Select a document type to start creating documents.
          </div>
        )}

        {selectedType && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <TypedDocumentForm
              key={selectedType.typeId}
              type={selectedType}
              onSubmit={async (values) => { await createDocument(values); }}
            />

            <section data-testid="documents-list">
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
                {selectedType.name} documents ({documents.length})
              </div>
              {docsLoading && <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</div>}
              {docsError && (
                <div data-testid="documents-error" role="alert" style={{ color: '#dc2626', fontSize: 13 }}>
                  {docsError}
                </div>
              )}
              {!docsLoading && !docsError && documents.length === 0 && (
                <div data-testid="documents-empty" style={{ color: '#94a3b8', fontSize: 13 }}>
                  No documents yet. Fill the form above to add one.
                </div>
              )}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {documents.map((doc: TypedDocument) => (
                  <li
                    key={doc.documentId}
                    data-testid={`document-${doc.documentId}`}
                    style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, background: '#fff' }}
                  >
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                      {doc.createdAt} · by {doc.createdBy}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {selectedType.fields.map((f) => {
                        const v = doc.values[f.fieldId];
                        if (v === undefined) return null;
                        return (
                          <div key={f.fieldId} style={{ fontSize: 13 }}>
                            <span style={{ fontWeight: 500, color: '#374151' }}>{f.name}: </span>
                            <span style={{ color: '#0f172a' }}>
                              {Array.isArray(v) ? v.join(', ') : v}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
