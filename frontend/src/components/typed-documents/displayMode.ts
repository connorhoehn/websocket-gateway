// Phase 51 Phase E — display-mode visibility helpers.
//
// A field's `displayModes` is an opt-in object. Defaults:
//   - `full`   ⇒ true   (every field is visible in detail view by default)
//   - `teaser` ⇒ false  (compact summary card; admin opts in)
//   - `list`   ⇒ false  (dense one-line list; admin opts in)
//
// A field with no `displayModes` at all behaves as { full: true }.

import type {
  ApiDisplayMode,
  ApiDocumentType,
  ApiDocumentTypeField,
  ApiFieldDisplayModes,
} from '../../hooks/useTypedDocuments';

const DEFAULT_VISIBILITY: Record<ApiDisplayMode, boolean> = {
  full: true,
  teaser: false,
  list: false,
};

export function isFieldVisibleInMode(field: ApiDocumentTypeField, mode: ApiDisplayMode): boolean {
  const dm: ApiFieldDisplayModes | undefined = field.displayModes;
  if (!dm || dm[mode] === undefined) return DEFAULT_VISIBILITY[mode];
  return dm[mode] === true;
}

export function visibleFieldsForMode(type: ApiDocumentType, mode: ApiDisplayMode): ApiDocumentTypeField[] {
  return type.fields.filter((f) => isFieldVisibleInMode(f, mode));
}

export const ALL_DISPLAY_MODES: ApiDisplayMode[] = ['full', 'teaser', 'list'];
