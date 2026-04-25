// frontend/src/types/documentType.ts
//
// Data model for document type definitions — the schema builder that drives
// how new documents are structured (sections, view-mode renderers, workflows).
// Persisted in localStorage via useDocumentTypes.
//
// Section type metadata (labels, icons, renderer manifests) lives in
// src/renderers — each type ships its own definition.ts. Query with
// getFieldTypes() / getFieldType() after importing the renderer barrel.

import type { SectionType, ViewMode } from './document';
export type { SectionType, ViewMode };

import { getFieldType } from '../renderers/registry';

// ---------------------------------------------------------------------------
// Icon palette for document type picker
// ---------------------------------------------------------------------------

export const DOCUMENT_TYPE_ICONS = [
  '📄', '📋', '📊', '📈', '📉', '🗒️', '📁', '🗂️', '📌', '📎',
  '🔖', '🏃', '🎯', '🚀', '⚡', '🔥', '💡', '🛠️', '⚙️', '🔍',
  '🧪', '🤝', '💼', '🌟', '✨',
];

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface DocumentTypeField {
  id: string;
  name: string;
  sectionType: string; // built-in SectionType or user-defined field type ID
  required: boolean;
  defaultCollapsed: boolean;
  placeholder: string;
  hiddenInModes: ViewMode[];
  rendererOverrides: Partial<Record<ViewMode, string>>;
}

export interface DocumentType {
  id: string;
  name: string;
  description: string;
  icon: string;
  fields: DocumentTypeField[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function makeEmptyField(sectionType: string): DocumentTypeField {
  // getFieldType is a runtime call — registry is populated by the time any
  // caller invokes this (the wizard barrel import runs first).
  const def = getFieldType(sectionType);
  return {
    id: crypto.randomUUID(),
    name: def?.label ?? sectionType,
    sectionType,
    required: false,
    defaultCollapsed: false,
    placeholder: '',
    hiddenInModes: [],
    rendererOverrides: {},
  };
}
