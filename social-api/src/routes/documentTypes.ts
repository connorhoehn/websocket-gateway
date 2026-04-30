// Phase 51 Phase A — REST API for document type schemas.
//
// Endpoints:
//   POST   /api/document-types               → create
//   GET    /api/document-types               → list (capped)
//   GET    /api/document-types/:typeId       → fetch one
//   PUT    /api/document-types/:typeId       → update name/description/icon/fields
//   DELETE /api/document-types/:typeId       → delete (instances unaffected)
//
// Request/response shape mirrors `DocumentTypeItem` from the repository.
// All routes require auth; `req.user.sub` becomes `createdBy` on create.

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { documentTypeRepo } from '../repositories';
import type {
  DocumentTypeItem,
  DocumentTypeFieldItem,
  DocumentTypeFieldKind,
  DocumentTypeFieldWidget,
  DocumentTypeFieldCardinality,
} from '../repositories';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/error-handler';

export const documentTypesRouter = Router();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_FIELD_TYPES = new Set<DocumentTypeFieldKind>([
  'text', 'long_text', 'number', 'date', 'boolean',
]);
const VALID_WIDGETS = new Set<DocumentTypeFieldWidget>([
  'text_field', 'textarea', 'number_input', 'date_picker', 'checkbox',
]);

function parseField(raw: unknown): DocumentTypeFieldItem {
  if (typeof raw !== 'object' || raw === null) {
    throw new ValidationError('field must be an object');
  }
  const r = raw as Record<string, unknown>;

  const fieldType = r.fieldType;
  if (typeof fieldType !== 'string' || !VALID_FIELD_TYPES.has(fieldType as DocumentTypeFieldKind)) {
    throw new ValidationError(`fieldType must be one of: ${[...VALID_FIELD_TYPES].join(', ')}`);
  }
  const widget = r.widget;
  if (typeof widget !== 'string' || !VALID_WIDGETS.has(widget as DocumentTypeFieldWidget)) {
    throw new ValidationError(`widget must be one of: ${[...VALID_WIDGETS].join(', ')}`);
  }
  const cardinalityRaw = r.cardinality;
  let cardinality: DocumentTypeFieldCardinality;
  if (cardinalityRaw === 1 || cardinalityRaw === 'unlimited') {
    cardinality = cardinalityRaw;
  } else {
    throw new ValidationError('cardinality must be 1 or "unlimited"');
  }
  if (typeof r.name !== 'string' || r.name.trim().length === 0) {
    throw new ValidationError('field.name is required');
  }

  return {
    fieldId: typeof r.fieldId === 'string' && r.fieldId ? r.fieldId : randomUUID(),
    name: r.name,
    fieldType: fieldType as DocumentTypeFieldKind,
    widget: widget as DocumentTypeFieldWidget,
    cardinality,
    required: r.required === true,
    helpText: typeof r.helpText === 'string' ? r.helpText : '',
  };
}

function parseFields(raw: unknown): DocumentTypeFieldItem[] {
  if (!Array.isArray(raw)) throw new ValidationError('fields must be an array');
  if (raw.length > 100) throw new ValidationError('fields cap is 100 per type');
  return raw.map(parseField);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

documentTypesRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = body.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('name is required');
  }
  const fields = parseFields(body.fields ?? []);

  const now = new Date().toISOString();
  const item: DocumentTypeItem = {
    typeId: randomUUID(),
    name: name.trim(),
    description: typeof body.description === 'string' ? body.description : '',
    icon: typeof body.icon === 'string' ? body.icon : '📄',
    fields,
    createdBy: req.user!.sub,
    createdAt: now,
    updatedAt: now,
  };
  await documentTypeRepo.create(item);
  res.status(201).json(item);
}));

documentTypesRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const items = await documentTypeRepo.list();
  res.status(200).json({ items });
}));

documentTypesRouter.get('/:typeId', asyncHandler(async (req: Request, res: Response) => {
  const params = req.params as { typeId: string };
  const item = await documentTypeRepo.get(params.typeId);
  if (!item) throw new NotFoundError(`document type ${params.typeId} not found`);
  res.status(200).json(item);
}));

documentTypesRouter.put('/:typeId', asyncHandler(async (req: Request, res: Response) => {
  const params = req.params as { typeId: string };
  const body = (req.body ?? {}) as Record<string, unknown>;

  const existing = await documentTypeRepo.get(params.typeId);
  if (!existing) throw new NotFoundError(`document type ${params.typeId} not found`);

  const patch: Partial<Pick<DocumentTypeItem, 'name' | 'description' | 'icon' | 'fields'>> = {};
  if (typeof body.name === 'string') {
    if (body.name.trim().length === 0) throw new ValidationError('name cannot be empty');
    patch.name = body.name.trim();
  }
  if (typeof body.description === 'string') patch.description = body.description;
  if (typeof body.icon === 'string') patch.icon = body.icon;
  if (body.fields !== undefined) patch.fields = parseFields(body.fields);

  const updated = await documentTypeRepo.update(params.typeId, patch);
  res.status(200).json(updated);
}));

documentTypesRouter.delete('/:typeId', asyncHandler(async (req: Request, res: Response) => {
  const params = req.params as { typeId: string };
  await documentTypeRepo.delete(params.typeId);
  res.status(204).end();
}));
