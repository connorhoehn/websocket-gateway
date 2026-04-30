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

// Phase 51 / hub#66 — Pages → Sections nested layout.
//
// `pages` is the canonical layout; `fields` is kept as a flat sibling array
// for backwards-compat with code paths that read fields directly. When
// `pages` is absent (older single-page types stored before #66), the
// migration helper `getPagesView` derives a single page wrapping all
// existing fields.

export interface DocumentTypePage {
  id: string;
  title?: string;        // operator-visible label; UI auto-fills "Page N" when absent
  sectionIds: string[];  // ordered references to DocumentTypeField.id
}

export interface DocumentTypePageConfig {
  showTableOfContents: boolean;
}

export interface DocumentType {
  id: string;
  name: string;
  description: string;
  icon: string;
  fields: DocumentTypeField[];
  /** Phase 51 / hub#66 — multi-page layout. Optional; absent = single-page (legacy). */
  pages?: DocumentTypePage[];
  /** Phase 51 / hub#66 — page-level configuration. Only meaningful when pages.length > 1. */
  pageConfig?: DocumentTypePageConfig;
  createdAt: string;
  updatedAt: string;
}

/**
 * Migration helper. Returns the type's `pages` if present, otherwise
 * derives a single page that wraps every field. Pure function — does
 * NOT mutate the input. Existing code paths that don't know about
 * pages can keep reading `fields`; the wizard reads via this helper.
 */
export function getPagesView(type: DocumentType): DocumentTypePage[] {
  if (type.pages && type.pages.length > 0) return type.pages;
  return [{
    id: 'page-default',
    title: undefined,
    sectionIds: type.fields.map((f) => f.id),
  }];
}

/**
 * Returns a fresh page-config (with safe defaults) when the stored
 * config is undefined. Used by the wizard so toggles always have a
 * value to bind to.
 */
export function getPageConfig(type: DocumentType): DocumentTypePageConfig {
  return type.pageConfig ?? { showTableOfContents: false };
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
