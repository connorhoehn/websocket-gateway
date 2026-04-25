// frontend/src/hooks/useCustomFieldTypes.ts
//
// CRUD hook for user-defined field types, persisted in localStorage.
// Also exports loadCustomFieldTypes() and registerCustomFieldTypes() so
// App.tsx can register them with the renderer registry at startup.

import { useState, useCallback } from 'react';
import type { CustomFieldType } from '../types/fieldType';
import { CUSTOM_FIELD_TYPE_STORAGE_KEY, isValidCustomFieldType } from '../types/fieldType';
import { registerFieldType, getFieldType } from '../renderers/registry';

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

export function loadCustomFieldTypes(): CustomFieldType[] {
  try {
    const raw = localStorage.getItem(CUSTOM_FIELD_TYPE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidCustomFieldType);
    if (valid.length !== parsed.length) {
      localStorage.setItem(CUSTOM_FIELD_TYPE_STORAGE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

function persistCustomFieldTypes(types: CustomFieldType[]): void {
  localStorage.setItem(CUSTOM_FIELD_TYPE_STORAGE_KEY, JSON.stringify(types));
}

// ---------------------------------------------------------------------------
// Registry integration
// ---------------------------------------------------------------------------

/** Register a single user-defined field type with the renderer registry. */
export function registerCustomFieldType(ft: CustomFieldType): void {
  const baseDef = getFieldType(ft.baseType);
  registerFieldType({
    type: ft.id,
    label: ft.name,
    icon: ft.icon,
    description: ft.description,
    rendererType: ft.baseType,
    rendererKeys: baseDef?.rendererKeys ?? {},
    rendererLabels: baseDef?.rendererLabels ?? {},
  });
}

/** Load from localStorage and register all user-defined field types. Call once at startup. */
export function registerCustomFieldTypes(): void {
  for (const ft of loadCustomFieldTypes()) {
    registerCustomFieldType(ft);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseCustomFieldTypesReturn {
  types: CustomFieldType[];
  createType: (draft: Omit<CustomFieldType, 'id' | 'createdAt' | 'updatedAt'>) => CustomFieldType;
  updateType: (id: string, patch: Partial<Omit<CustomFieldType, 'id' | 'createdAt'>>) => void;
  deleteType: (id: string) => void;
}

export function useCustomFieldTypes(): UseCustomFieldTypesReturn {
  const [types, setTypes] = useState<CustomFieldType[]>(() => loadCustomFieldTypes());

  const createType = useCallback(
    (draft: Omit<CustomFieldType, 'id' | 'createdAt' | 'updatedAt'>): CustomFieldType => {
      const now = new Date().toISOString();
      const newType: CustomFieldType = {
        ...draft,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      const current = loadCustomFieldTypes();
      const updated = [...current, newType];
      persistCustomFieldTypes(updated);
      setTypes(updated);
      registerCustomFieldType(newType);
      return newType;
    },
    [],
  );

  const updateType = useCallback(
    (id: string, patch: Partial<Omit<CustomFieldType, 'id' | 'createdAt'>>) => {
      const now = new Date().toISOString();
      const current = loadCustomFieldTypes();
      const updated = current.map(t =>
        t.id === id ? { ...t, ...patch, updatedAt: now } : t,
      );
      persistCustomFieldTypes(updated);
      setTypes(updated);
      const ft = updated.find(t => t.id === id);
      if (ft) registerCustomFieldType(ft);
    },
    [],
  );

  const deleteType = useCallback((id: string) => {
    const current = loadCustomFieldTypes();
    const updated = current.filter(t => t.id !== id);
    persistCustomFieldTypes(updated);
    setTypes(updated);
  }, []);

  return { types, createType, updateType, deleteType };
}
