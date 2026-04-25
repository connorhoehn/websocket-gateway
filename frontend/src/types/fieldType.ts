// frontend/src/types/fieldType.ts
//
// User-defined data types — custom primitive types created through the Data Types admin page.
// Stored in localStorage via useCustomFieldTypes.
// At startup these are registered with the renderer registry so they appear
// in the document type wizard alongside the built-in section types.

export interface CustomFieldType {
  id: string;
  name: string;
  icon: string;
  description: string;
  /**
   * Primitive storage type — e.g. 'long_text_and_summary', 'list_text'.
   * Identifies the Drupal-style data storage class the user selected.
   * Optional for backward-compat with records persisted before this field was added.
   */
  primitiveType?: string;
  /**
   * Which built-in renderer to delegate to for display.
   * Derived from primitiveType at creation time.
   */
  baseType: string;
  createdAt: string;
  updatedAt: string;
}

export const CUSTOM_FIELD_TYPE_STORAGE_KEY = 'ws_field_types_v1';

export function isValidCustomFieldType(x: unknown): x is CustomFieldType {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' && o.id.length > 0 &&
    typeof o.name === 'string' && o.name.length > 0 &&
    typeof o.icon === 'string' &&
    typeof o.description === 'string' &&
    typeof o.baseType === 'string' && o.baseType.length > 0 &&
    typeof o.createdAt === 'string' &&
    typeof o.updatedAt === 'string'
    // primitiveType optional for backward-compat with older persisted records
  );
}
