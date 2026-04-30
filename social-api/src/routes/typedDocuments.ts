// Phase 51 Phase A — REST API for TypedDocument instances.
//
// Endpoints:
//   POST  /api/typed-documents              → create (validates against schema)
//   GET   /api/typed-documents/:documentId  → fetch one
//   GET   /api/typed-documents?typeId=<id>  → list instances of a type
//
// Validation: every required field on the type must have a value; values
// shape must match cardinality (string for cardinality=1, string[] for
// cardinality='unlimited'); unknown fields are rejected.

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { documentTypeRepo, typedDocumentRepo } from '../repositories';
import type {
  TypedDocumentItem,
  TypedDocumentValue,
  DocumentTypeFieldItem,
} from '../repositories';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/error-handler';

export const typedDocumentsRouter = Router();

// ---------------------------------------------------------------------------
// Schema-aware value validation
// ---------------------------------------------------------------------------

// Permissive ISO-8601 date or date-time parser — accepts "YYYY-MM-DD" or any
// string Date.parse() can read. Returns the canonical ISO string for storage.
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T.*)?$/;
function parseDate(raw: string, fieldName: string): string {
  if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new ValidationError(`field "${fieldName}" expects an ISO date (YYYY-MM-DD or ISO datetime)`);
  }
  return raw;
}

function validatePrimitive(
  field: DocumentTypeFieldItem,
  raw: unknown,
): string | number | boolean {
  switch (field.fieldType) {
    case 'text':
    case 'long_text':
      if (typeof raw !== 'string') {
        throw new ValidationError(`field "${field.name}" expects a string value`);
      }
      return raw;
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new ValidationError(`field "${field.name}" expects a finite number`);
      }
      return raw;
    case 'date':
      if (typeof raw !== 'string') {
        throw new ValidationError(`field "${field.name}" expects a string ISO date`);
      }
      return parseDate(raw, field.name);
    case 'boolean':
      if (typeof raw !== 'boolean') {
        throw new ValidationError(`field "${field.name}" expects a boolean`);
      }
      return raw;
  }
}

function validateValueAgainstField(
  field: DocumentTypeFieldItem,
  raw: unknown,
): TypedDocumentValue {
  if (field.cardinality === 1) {
    const v = validatePrimitive(field, raw);
    // Required-empty check applies to strings; numbers/booleans/dates are
    // present-or-absent. (Booleans defaulting to false are "set", which is
    // the right semantics — operator can model "must be checked" via a
    // separate validation rule in Phase D.)
    if (field.required && typeof v === 'string' && v.length === 0) {
      throw new ValidationError(`field "${field.name}" is required`);
    }
    return v;
  }
  // cardinality === 'unlimited'
  if (field.fieldType === 'boolean') {
    throw new ValidationError(
      `field "${field.name}": boolean fields cannot have unlimited cardinality`,
    );
  }
  if (!Array.isArray(raw)) {
    throw new ValidationError(`field "${field.name}" expects an array of values`);
  }
  const out: (string | number)[] = [];
  for (const item of raw) {
    const v = validatePrimitive(field, item);
    out.push(v as string | number);
  }
  if (field.required && out.length === 0) {
    throw new ValidationError(`field "${field.name}" is required (at least one value)`);
  }
  return out as string[] | number[];
}

function validateValuesAgainstSchema(
  fields: DocumentTypeFieldItem[],
  rawValues: unknown,
): Record<string, TypedDocumentValue> {
  if (typeof rawValues !== 'object' || rawValues === null || Array.isArray(rawValues)) {
    throw new ValidationError('values must be an object keyed by fieldId');
  }
  const valuesObj = rawValues as Record<string, unknown>;
  const knownIds = new Set(fields.map((f) => f.fieldId));

  for (const incomingId of Object.keys(valuesObj)) {
    if (!knownIds.has(incomingId)) {
      throw new ValidationError(`unknown field "${incomingId}" — not in type schema`);
    }
  }

  const out: Record<string, TypedDocumentValue> = {};
  for (const field of fields) {
    const raw = valuesObj[field.fieldId];
    if (raw === undefined) {
      if (field.required) {
        throw new ValidationError(`field "${field.name}" is required`);
      }
      continue;
    }
    out[field.fieldId] = validateValueAgainstField(field, raw);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

typedDocumentsRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const typeId = body.typeId;
  if (typeof typeId !== 'string' || !typeId) {
    throw new ValidationError('typeId is required');
  }
  const type = await documentTypeRepo.get(typeId);
  if (!type) throw new NotFoundError(`document type ${typeId} not found`);

  const values = validateValuesAgainstSchema(type.fields, body.values ?? {});

  const now = new Date().toISOString();
  const item: TypedDocumentItem = {
    documentId: randomUUID(),
    typeId,
    values,
    createdBy: req.user!.sub,
    createdAt: now,
    updatedAt: now,
  };
  await typedDocumentRepo.create(item);
  res.status(201).json(item);
}));

typedDocumentsRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const typeId = typeof req.query.typeId === 'string' ? req.query.typeId : '';
  if (!typeId) throw new ValidationError('typeId query parameter is required');
  const items = await typedDocumentRepo.listByType(typeId);
  res.status(200).json({ items });
}));

typedDocumentsRouter.get('/:documentId', asyncHandler(async (req: Request, res: Response) => {
  const params = req.params as { documentId: string };
  const item = await typedDocumentRepo.get(params.documentId);
  if (!item) throw new NotFoundError(`typed document ${params.documentId} not found`);
  res.status(200).json(item);
}));
