// Phase 51 Phase A.5 — translate the wizard's localStorage `DocumentType`
// shape (renderer-driven `sectionType`) into the Phase A backend shape
// (`fieldType` + `widget` + `cardinality`).
//
// The translation is best-effort. A `sectionType` is a renderer ID and can
// be anything the renderer registry exposes; the API only understands a
// fixed enum. Unrecognized renderers fall back to `text` / `text_field`
// at cardinality=1 so the type still reaches the server.

import type { DocumentType, DocumentTypeField } from '../types/documentType';
import type {
  ApiFieldKind,
  ApiFieldWidget,
  ApiFieldCardinality,
} from '../hooks/useTypedDocuments';

export interface ApiDocumentTypeFieldCreatePayload {
  name: string;
  fieldType: ApiFieldKind;
  widget: ApiFieldWidget;
  cardinality: ApiFieldCardinality;
  required: boolean;
  helpText: string;
}

export interface ApiDocumentTypeCreatePayload {
  name: string;
  description: string;
  icon: string;
  fields: ApiDocumentTypeFieldCreatePayload[];
}

// Map a wizard sectionType (renderer ID) to the Phase A backend field shape.
// Update as new renderers gain Phase B/C/D backend equivalents.
function translateField(field: DocumentTypeField): ApiDocumentTypeFieldCreatePayload {
  let fieldType: ApiFieldKind;
  let widget: ApiFieldWidget;

  switch (field.sectionType) {
    case 'rich-text':
    case 'long-text':
    case 'long_text':
      fieldType = 'long_text';
      widget = 'textarea';
      break;
    case 'number':
      fieldType = 'number';
      widget = 'number_input';
      break;
    case 'date':
      fieldType = 'date';
      widget = 'date_picker';
      break;
    case 'boolean':
    case 'checkbox':
      fieldType = 'boolean';
      widget = 'checkbox';
      break;
    case 'text':
    default:
      // Unknown renderer falls back to plain text. The wizard will still
      // edit the section using its renderer locally; the server-side API
      // representation simplifies to text for now.
      fieldType = 'text';
      widget = 'text_field';
      break;
  }

  return {
    name: field.name,
    fieldType,
    widget,
    cardinality: 1,
    required: field.required,
    helpText: field.placeholder ?? '',
  };
}

export function translateForApi(local: DocumentType): ApiDocumentTypeCreatePayload {
  return {
    name: local.name,
    description: local.description,
    icon: local.icon,
    fields: local.fields.map(translateField),
  };
}

// ---------------------------------------------------------------------------
// Sync helpers — best-effort POST/PUT, never throws into the caller.
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
  return (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';
}

/**
 * Map of localStorage type id → server-side typeId after a successful
 * POST. We use this so subsequent edits of the same local type can target
 * the right server resource without an extra round-trip lookup.
 *
 * In-memory only — operator restarts the tab and the map empties; that's
 * fine, the next edit re-creates a server-side row (which is harmless;
 * only the most recent server row "wins" from a UX standpoint until A.5b
 * lands list-merging).
 */
const localToServerId = new Map<string, string>();

export function _resetLocalToServerIdForTests(): void {
  localToServerId.clear();
}

export interface SyncResult {
  ok: boolean;
  serverTypeId?: string;
  error?: string;
}

export async function syncDocumentTypeCreate(
  local: DocumentType,
  idToken: string,
): Promise<SyncResult> {
  try {
    const payload = translateForApi(local);
    const res = await fetch(`${getBaseUrl()}/api/document-types`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: `POST failed: ${res.status}` };
    const created = await res.json() as { typeId: string };
    localToServerId.set(local.id, created.typeId);
    return { ok: true, serverTypeId: created.typeId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function syncDocumentTypeUpdate(
  local: DocumentType,
  idToken: string,
): Promise<SyncResult> {
  const serverTypeId = localToServerId.get(local.id);
  if (!serverTypeId) {
    // We never synced this type; treat the update as a fresh create.
    return syncDocumentTypeCreate(local, idToken);
  }
  try {
    const payload = translateForApi(local);
    const res = await fetch(`${getBaseUrl()}/api/document-types/${serverTypeId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 404) {
      // Server-side row vanished — re-create it.
      localToServerId.delete(local.id);
      return syncDocumentTypeCreate(local, idToken);
    }
    if (!res.ok) return { ok: false, error: `PUT failed: ${res.status}` };
    return { ok: true, serverTypeId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function syncDocumentTypeDelete(
  localId: string,
  idToken: string,
): Promise<SyncResult> {
  const serverTypeId = localToServerId.get(localId);
  if (!serverTypeId) return { ok: true }; // never synced; nothing to do
  try {
    const res = await fetch(`${getBaseUrl()}/api/document-types/${serverTypeId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok && res.status !== 404) {
      return { ok: false, error: `DELETE failed: ${res.status}` };
    }
    localToServerId.delete(localId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
