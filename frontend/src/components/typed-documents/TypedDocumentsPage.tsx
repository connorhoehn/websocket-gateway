// Phase 51 Phase A — page that lists API-side document types, lets the
// end-user pick one, renders an auto-generated form for that type, and
// shows the resulting persisted instances below the form.
//
// Phase A scope: read-only on types (CRUD on types is the wizard's job).
// Phase A.5 will unify the type-creation surface; until then this page
// simply consumes whatever types the backend has.

import { useEffect, useMemo, useState } from 'react';
import { TypedDocumentForm, type ReferenceOption } from './TypedDocumentForm';
import { ALL_DISPLAY_MODES, visibleFieldsForMode } from './displayMode';
import {
  useTypedDocuments,
  type ApiDisplayMode,
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
  const [displayMode, setDisplayMode] = useState<ApiDisplayMode>('full');

  // Phase 51 Phase G — bulk CSV import state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; failed: number; errors: Array<{ row: number; reason: string }> } | null>(null);

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

  const { documents, loading: docsLoading, error: docsError, createDocument, refresh } = useTypedDocuments({
    idToken,
    typeId: selectedTypeId,
  });

  // Phase 51 Phase G — bulk CSV import handler
  const handleBulkImport = async (file: File) => {
    if (!idToken || !selectedTypeId) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${getBaseUrl()}/api/typed-documents/bulk-import?typeId=${encodeURIComponent(selectedTypeId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errorData.error || `Import failed (${res.status})`);
      }
      const result = await res.json() as { imported: number; failed: number; errors: Array<{ row: number; reason: string }> };
      setImportResult(result);
      if (result.imported > 0) {
        refresh();
      }
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  // Phase C — pre-fetch instances of any DocumentType referenced by the
  // selected type's `reference`-kind fields so the picker has a populated
  // option list. Keyed by referenced typeId. Best-effort: failed fetches
  // leave the picker disabled with the "no options" hint.
  const referencedTypeIds = useMemo<string[]>(() => {
    if (!selectedType) return [];
    const ids = new Set<string>();
    for (const f of selectedType.fields) {
      if (f.fieldType === 'reference' && f.referenceTypeId) ids.add(f.referenceTypeId);
    }
    return Array.from(ids);
  }, [selectedType]);

  const [referenceOptions, setReferenceOptions] = useState<Record<string, ReferenceOption[]>>({});

  useEffect(() => {
    if (!idToken || referencedTypeIds.length === 0) {
      setReferenceOptions({});
      return;
    }
    let cancelled = false;
    Promise.all(
      referencedTypeIds.map(async (refTypeId) => {
        const res = await fetch(
          `${getBaseUrl()}/api/typed-documents?typeId=${encodeURIComponent(refTypeId)}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        );
        if (!res.ok) return [refTypeId, []] as const;
        const data = (await res.json()) as { items: TypedDocument[] };
        const refTypeMeta = types.find((t) => t.typeId === refTypeId);
        const labelField = refTypeMeta?.fields.find((f) => f.fieldType === 'text');
        const opts: ReferenceOption[] = (data.items ?? []).map((d) => ({
          value: d.documentId,
          label: (labelField && (d.values[labelField.fieldId] as string)) || d.documentId,
        }));
        return [refTypeId, opts] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setReferenceOptions(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [idToken, referencedTypeIds, types]);

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
              referenceOptions={referenceOptions}
            />

            <section data-testid="documents-list">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                  {selectedType.name} documents ({documents.length})
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                    Display:
                    <select
                      data-testid="display-mode-picker"
                      value={displayMode}
                      onChange={(e) => setDisplayMode(e.target.value as ApiDisplayMode)}
                      style={{ fontFamily: 'inherit', fontSize: 12, padding: '3px 6px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff' }}
                    >
                      {ALL_DISPLAY_MODES.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <label
                    style={{
                      cursor: importing ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                      padding: '5px 12px', borderRadius: 5,
                      background: '#fff', color: '#646cff', border: '1px solid #646cff',
                      opacity: importing ? 0.5 : 1,
                    }}
                  >
                    {importing ? 'Importing…' : 'Bulk Import'}
                    <input
                      type="file"
                      accept=".csv"
                      disabled={importing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleBulkImport(file);
                        e.target.value = '';
                      }}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>
              {importResult && (
                <div
                  data-testid="import-result"
                  style={{
                    marginBottom: 12, padding: 12, borderRadius: 8,
                    background: importResult.failed > 0 ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${importResult.failed > 0 ? '#fca5a5' : '#86efac'}`,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: importResult.failed > 0 ? '#dc2626' : '#16a34a', marginBottom: 6 }}>
                    Import {importResult.failed > 0 ? 'Partially' : 'Successfully'} Completed
                  </div>
                  <div style={{ fontSize: 12, color: '#0f172a' }}>
                    {importResult.imported} imported, {importResult.failed} failed
                  </div>
                  {importResult.errors.length > 0 && (
                    <details style={{ marginTop: 8, fontSize: 12 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#dc2626' }}>
                        {importResult.errors.length} error{importResult.errors.length !== 1 ? 's' : ''}
                      </summary>
                      <ul style={{ margin: '6px 0 0 0', padding: '0 0 0 20px', maxHeight: 150, overflowY: 'auto' }}>
                        {importResult.errors.map((err, i) => (
                          <li key={i} style={{ marginTop: 4 }}>
                            <span style={{ fontWeight: 600 }}>Row {err.row}:</span> {err.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <button
                    onClick={() => setImportResult(null)}
                    style={{
                      marginTop: 8, fontSize: 11, padding: '3px 8px', borderRadius: 4,
                      background: 'none', border: '1px solid #cbd5e1', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
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
                      {visibleFieldsForMode(selectedType, displayMode).map((f) => {
                        const v = doc.values[f.fieldId];
                        if (v === undefined) return null;
                        let display: string;
                        if (Array.isArray(v)) {
                          display = v.join(', ');
                        } else if (typeof v === 'boolean') {
                          display = v ? '✓' : '—';
                        } else {
                          display = String(v);
                        }
                        return (
                          <div key={f.fieldId} style={{ fontSize: 13 }}>
                            <span style={{ fontWeight: 500, color: '#374151' }}>{f.name}: </span>
                            <span style={{ color: '#0f172a' }}>{display}</span>
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
