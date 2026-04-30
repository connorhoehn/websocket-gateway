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

function validateValueAgainstField(
  field: DocumentTypeFieldItem,
  raw: unknown,
): TypedDocumentValue {
  if (field.cardinality === 1) {
    if (typeof raw !== 'string') {
      throw new ValidationError(`field "${field.name}" expects a string value`);
    }
    if (field.required && raw.length === 0) {
      throw new ValidationError(`field "${field.name}" is required`);
    }
    return raw;
  }
  // cardinality === 'unlimited'
  if (!Array.isArray(raw)) {
    throw new ValidationError(`field "${field.name}" expects an array of values`);
  }
  for (const v of raw) {
    if (typeof v !== 'string') {
      throw new ValidationError(`field "${field.name}" array entries must be strings`);
    }
  }
  if (field.required && raw.length === 0) {
    throw new ValidationError(`field "${field.name}" is required (at least one value)`);
  }
  return raw as string[];
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
