// Integration tests for /api/typed-documents routes.
//
// Mocks documentTypeRepo and typedDocumentRepo at module level so we
// exercise schema-aware validation (type coercion, required fields,
// enum/reference checks, showWhen, validation rules, cardinality) and
// CRUD + bulk CSV import without touching DDB.

import express, { type NextFunction, type Request, type Response } from 'express';

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: () => 'test-uuid-1234',
}));

const mockDocTypeGet = jest.fn();
const mockTypedDocGet = jest.fn();
const mockTypedDocCreate = jest.fn();
const mockTypedDocListByType = jest.fn();

jest.mock('../../repositories', () => ({
  documentTypeRepo: { get: mockDocTypeGet },
  typedDocumentRepo: {
    get: mockTypedDocGet,
    create: mockTypedDocCreate,
    listByType: mockTypedDocListByType,
  },
}));

import { typedDocumentsRouter } from '../typedDocuments';
import { errorHandler } from '../../middleware/error-handler';

interface MockRes {
  statusCode: number;
  body: unknown;
  ended: boolean;
  finished: Promise<void>;
  status(code: number): MockRes;
  json(body: unknown): MockRes;
  send(body?: unknown): MockRes;
  setHeader(_n: string, _v: unknown): MockRes;
  getHeader(_n: string): unknown;
  end(...args: unknown[]): MockRes;
}

function mockRes(): MockRes {
  let resolve!: () => void;
  const finished = new Promise<void>((r) => { resolve = r; });
  const r: MockRes = {
    statusCode: 200, body: undefined, ended: false, finished,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; resolve(); return this; },
    send(body) { this.body = body; this.ended = true; resolve(); return this; },
    setHeader() { return this; },
    getHeader() { return undefined; },
    end(..._args) { this.ended = true; resolve(); return this; },
  };
  return r;
}

interface RunOpts { body?: unknown; userId?: string }

async function run(
  app: express.Express,
  method: string,
  url: string,
  opts: RunOpts = {},
): Promise<MockRes> {
  const res = mockRes();
  const qIdx = url.indexOf('?');
  const query: Record<string, string> = {};
  if (qIdx >= 0) {
    const params = new URLSearchParams(url.slice(qIdx + 1));
    for (const [k, v] of params.entries()) query[k] = v;
  }
  const req = {
    method: method.toUpperCase(),
    url,
    originalUrl: url,
    path: qIdx >= 0 ? url.slice(0, qIdx) : url,
    headers: { 'content-type': 'application/json' },
    query,
    body: opts.body,
    user: { sub: opts.userId ?? 'tester' },
    params: {},
    ip: '127.0.0.1',
  } as unknown as Request;
  await new Promise<void>((resolveOuter, reject) => {
    const finalHandler = (err?: unknown): void => {
      if (err) { reject(err); return; }
      if (!res.ended) res.status(404).json({ error: 'route not found' });
      resolveOuter();
    };
    (app as unknown as (req: Request, res: Response, next: NextFunction) => void)(
      req, res as unknown as Response, finalHandler,
    );
    res.finished.then(() => resolveOuter()).catch(reject);
  });
  return res;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/typed-documents', typedDocumentsRouter);
  app.use(errorHandler);
  return app;
}

const TEXT_FIELD = { fieldId: 'f-name', name: 'Name', fieldType: 'text', cardinality: 1, required: true };
const NUM_FIELD = { fieldId: 'f-age', name: 'Age', fieldType: 'number', cardinality: 1, required: false };
const BOOL_FIELD = { fieldId: 'f-active', name: 'Active', fieldType: 'boolean', cardinality: 1, required: false };
const DATE_FIELD = { fieldId: 'f-dob', name: 'DOB', fieldType: 'date', cardinality: 1, required: false };
const ENUM_FIELD = { fieldId: 'f-status', name: 'Status', fieldType: 'enum', cardinality: 1, required: false, options: ['draft', 'published', 'archived'] };
const REF_FIELD = { fieldId: 'f-parent', name: 'Parent', fieldType: 'reference', cardinality: 1, required: false, referenceTypeId: 'type-parent' };
const MULTI_TEXT = { fieldId: 'f-tags', name: 'Tags', fieldType: 'text', cardinality: 'unlimited', required: false };

const BASIC_TYPE = {
  typeId: 'type-1',
  name: 'Basic',
  fields: [TEXT_FIELD, NUM_FIELD, BOOL_FIELD, DATE_FIELD, ENUM_FIELD],
};

beforeEach(() => {
  mockDocTypeGet.mockReset();
  mockTypedDocGet.mockReset();
  mockTypedDocCreate.mockReset().mockResolvedValue(undefined);
  mockTypedDocListByType.mockReset();
});

describe('POST /api/typed-documents', () => {
  it('returns 201 with valid values', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);

    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': 'Alice', 'f-age': 30 } },
    });
    expect(res.statusCode).toBe(201);
    expect(mockTypedDocCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects missing typeId with 400', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { values: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when type not found', async () => {
    mockDocTypeGet.mockResolvedValue(null);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'nope', values: {} },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects missing required field with 400', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-age': 25 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unknown field with 400', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': 'Alice', 'f-bogus': 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects wrong type for number field', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': 'Alice', 'f-age': 'thirty' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects wrong type for boolean field', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': 'Alice', 'f-active': 'yes' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid date format', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': 'Alice', 'f-dob': 'not-a-date' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid ISO date', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': 'Alice', 'f-dob': '2025-06-15' } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects invalid enum value', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': 'Alice', 'f-status': 'deleted' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid enum value', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': 'Alice', 'f-status': 'draft' } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('validates reference field — rejects when target not found', async () => {
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-r', fields: [REF_FIELD] });
    mockTypedDocGet.mockResolvedValue(null);

    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-r', values: { 'f-parent': 'nonexistent-id' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('validates reference field — rejects wrong target type', async () => {
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-r', fields: [REF_FIELD] });
    mockTypedDocGet.mockResolvedValue({ documentId: 'doc-99', typeId: 'wrong-type' });

    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-r', values: { 'f-parent': 'doc-99' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid reference', async () => {
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-r', fields: [REF_FIELD] });
    mockTypedDocGet.mockResolvedValue({ documentId: 'doc-99', typeId: 'type-parent' });

    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-r', values: { 'f-parent': 'doc-99' } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('handles unlimited cardinality — array of strings', async () => {
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-m', fields: [MULTI_TEXT] });
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-m', values: { 'f-tags': ['a', 'b', 'c'] } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects non-array for unlimited cardinality', async () => {
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-m', fields: [MULTI_TEXT] });
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-m', values: { 'f-tags': 'not-an-array' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('respects showWhen — hidden required field does not trigger 400', async () => {
    const condField = {
      fieldId: 'f-detail', name: 'Detail', fieldType: 'text', cardinality: 1, required: true,
      showWhen: { fieldId: 'f-status', equals: 'published' },
    };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-sw', fields: [ENUM_FIELD, condField] });

    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-sw', values: { 'f-status': 'draft' } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('respects showWhen — visible required field triggers 400 when missing', async () => {
    const condField = {
      fieldId: 'f-detail', name: 'Detail', fieldType: 'text', cardinality: 1, required: true,
      showWhen: { fieldId: 'f-status', equals: 'published' },
    };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-sw', fields: [ENUM_FIELD, condField] });

    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-sw', values: { 'f-status': 'published' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('applies validation rules — min length', async () => {
    const validatedField = {
      ...TEXT_FIELD,
      validation: { min: 3 },
    };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-v', fields: [validatedField] });

    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-v', values: { 'f-name': 'AB' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('applies validation rules — number max', async () => {
    const validatedNum = {
      ...NUM_FIELD, required: true,
      validation: { max: 100 },
    };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-v', fields: [validatedNum] });

    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-v', values: { 'f-age': 150 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('applies validation rules — regex', async () => {
    const regexField = {
      ...TEXT_FIELD,
      validation: { regex: '^[A-Z]+$' },
    };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-v', fields: [regexField] });

    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-v', values: { 'f-name': 'lowercase' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('applies validation rules — requireTrue for boolean', async () => {
    const reqTrue = {
      ...BOOL_FIELD, required: true,
      validation: { requireTrue: true },
    };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-v', fields: [reqTrue] });

    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-v', values: { 'f-active': false } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/typed-documents', () => {
  it('returns 200 with items for typeId', async () => {
    mockTypedDocListByType.mockResolvedValue([{ documentId: 'd-1' }]);

    const res = await run(buildApp(), 'GET', '/api/typed-documents?typeId=type-1');
    expect(res.statusCode).toBe(200);
    expect((res.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it('rejects missing typeId with 400', async () => {
    const res = await run(buildApp(), 'GET', '/api/typed-documents');
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/typed-documents/:documentId', () => {
  it('returns 200 with the document', async () => {
    mockTypedDocGet.mockResolvedValue({ documentId: 'd-1', typeId: 'type-1' });

    const res = await run(buildApp(), 'GET', '/api/typed-documents/d-1');
    expect(res.statusCode).toBe(200);
    expect((res.body as { documentId: string }).documentId).toBe('d-1');
  });

  it('returns 404 when not found', async () => {
    mockTypedDocGet.mockResolvedValue(null);
    const res = await run(buildApp(), 'GET', '/api/typed-documents/nope');
    expect(res.statusCode).toBe(404);
  });
});
