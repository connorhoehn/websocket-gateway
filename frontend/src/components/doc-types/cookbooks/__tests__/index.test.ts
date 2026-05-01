// Cookbook template tests — verify each template's build() returns valid
// DocumentType shapes and that field IDs are unique within each type.

import { describe, test, expect } from 'vitest';
import { documentTypeCookbooks } from '../index';

describe('Document Type Cookbooks', () => {
  test('all cookbooks have required metadata', () => {
    expect(documentTypeCookbooks.length).toBeGreaterThan(0);
    for (const cookbook of documentTypeCookbooks) {
      expect(cookbook.id).toBeTruthy();
      expect(cookbook.name).toBeTruthy();
      expect(cookbook.description).toBeTruthy();
      expect(cookbook.icon).toBeTruthy();
      expect(cookbook.category).toBeTruthy();
      expect(typeof cookbook.build).toBe('function');
    }
  });

  test('each cookbook builds a valid DocumentType', () => {
    for (const cookbook of documentTypeCookbooks) {
      const built = cookbook.build();
      expect(built.name).toBe(cookbook.name);
      expect(built.description).toBe(cookbook.description);
      expect(built.icon).toBe(cookbook.icon);
      expect(Array.isArray(built.fields)).toBe(true);
      expect(built.fields.length).toBeGreaterThan(0);
    }
  });

  test('field IDs are unique within each built type', () => {
    for (const cookbook of documentTypeCookbooks) {
      const built = cookbook.build();
      const fieldIds = built.fields.map((f) => f.id);
      const uniqueIds = new Set(fieldIds);
      expect(uniqueIds.size).toBe(fieldIds.length);
    }
  });

  test('cookbook IDs are unique', () => {
    const ids = documentTypeCookbooks.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('all categories are valid', () => {
    const validCategories = ['Engineering', 'Operations', 'People', 'Sales & CRM', 'Product', 'Finance', 'Legal', 'General'];
    for (const cookbook of documentTypeCookbooks) {
      expect(validCategories).toContain(cookbook.category);
    }
  });
});
