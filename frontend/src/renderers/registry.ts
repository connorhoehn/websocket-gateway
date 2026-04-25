// frontend/src/renderers/registry.ts
//
// Dynamic registry keyed by (sectionType × viewMode) for renderer components,
// and a separate field-type registry for metadata (label, icon, renderer manifests).
//
// Renderers and field type definitions register themselves via the barrel (index.ts).
//
// Renderer fallback chain (first match wins):
//   sectionType:viewMode  →  sectionType:*  →  *:viewMode  →  *:*

import type { SectionRenderer } from './types';
import type { ViewMode } from '../types/document';

// ---------------------------------------------------------------------------
// Field type definition — the Drupal-like field type module descriptor
// ---------------------------------------------------------------------------

export interface FieldTypeDefinition {
  /** Unique key — matches SectionType for built-ins; UUID for user-defined types */
  type: string;
  label: string;
  icon: string;
  description: string;
  /** Available renderer keys per view mode, e.g. { editor: ['tasks:editor'] } */
  rendererKeys: Partial<Record<ViewMode, string[]>>;
  /** Human-readable label for each renderer key */
  rendererLabels: Record<string, string>;
  /**
   * When set, renderer resolution uses this type's renderers instead of `type`.
   * User-defined field types set this to the built-in type they wrap.
   */
  rendererType?: string;
}

const _fieldTypes = new Map<string, FieldTypeDefinition>();

export function registerFieldType(def: FieldTypeDefinition): void {
  _fieldTypes.set(def.type, def);
}

export function getFieldTypes(): FieldTypeDefinition[] {
  return Array.from(_fieldTypes.values());
}

export function getFieldType(type: string): FieldTypeDefinition | undefined {
  return _fieldTypes.get(type);
}

// ---------------------------------------------------------------------------
// Renderer registry
// ---------------------------------------------------------------------------

const _renderers = new Map<string, SectionRenderer>();

function registryKey(sectionType: string, viewMode: string): string {
  return `${sectionType}:${viewMode}`;
}

export function registerRenderer(
  sectionType: string,
  viewMode: ViewMode | '*',
  component: SectionRenderer,
): void {
  _renderers.set(registryKey(sectionType, viewMode), component);
}

export function getRenderer(
  sectionType: string | null | undefined,
  viewMode: ViewMode,
): SectionRenderer | null {
  const st = sectionType ?? '*';
  // User-defined field types delegate to their base renderer type
  const def = _fieldTypes.get(st);
  const resolved = def?.rendererType ?? st;
  return (
    _renderers.get(registryKey(resolved, viewMode)) ??
    _renderers.get(registryKey(resolved, '*')) ??
    _renderers.get(registryKey('*', viewMode)) ??
    _renderers.get(registryKey('*', '*')) ??
    null
  );
}

/** Returns all registered (sectionType, viewMode) pairs — useful for debug / config UIs. */
export function listRegisteredRenderers(): Array<{ sectionType: string; viewMode: string; component: SectionRenderer }> {
  return Array.from(_renderers.entries()).map(([k, component]) => {
    const [sectionType, viewMode] = k.split(':');
    return { sectionType, viewMode, component };
  });
}
