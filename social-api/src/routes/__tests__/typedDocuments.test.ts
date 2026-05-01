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

  it('rejects values as array with 400', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: [1, 2, 3] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects values as null with 400', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: null },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects empty string for required text field', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': '' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts long_text field type', async () => {
    const longText = { fieldId: 'f-bio', name: 'Bio', fieldType: 'long_text', cardinality: 1, required: false };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-lt', fields: [longText] });
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-lt', values: { 'f-bio': 'A long biography...' } },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects boolean with unlimited cardinality', async () => {
    const multiBool = { fieldId: 'f-flags', name: 'Flags', fieldType: 'boolean', cardinality: 'unlimited', required: false };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-mb', fields: [multiBool] });
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-mb', values: { 'f-flags': [true, false] } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects required multi-value field with empty array', async () => {
    const reqMulti = { ...MULTI_TEXT, required: true };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-rm', fields: [reqMulti] });
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-rm', values: { 'f-tags': [] } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('applies validation rules — string max length', async () => {
    const maxField = { ...TEXT_FIELD, validation: { max: 5 } };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-v', fields: [maxField] });
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-v', values: { 'f-name': 'toolong' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts empty reference field when not required', async () => {
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-r', fields: [REF_FIELD] });
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-r', values: {} },
    });
    expect(res.statusCode).toBe(201);
  });

  it('validates multi-value reference array', async () => {
    const multiRef = { ...REF_FIELD, cardinality: 'unlimited' };
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-mr', fields: [multiRef] });
    mockTypedDocGet
      .mockResolvedValueOnce({ documentId: 'doc-1', typeId: 'type-parent' })
      .mockResolvedValueOnce(null);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-mr', values: { 'f-parent': ['doc-1', 'doc-missing'] } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects NaN for number field', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': 'Alice', 'f-age': NaN } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects Infinity for number field', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-name': 'Alice', 'f-age': Infinity } },
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

// ---------------------------------------------------------------------------
// Bulk CSV import — multer needs real multipart, so we spin up a test server
// ---------------------------------------------------------------------------
import http from 'http';

function buildAppWithUser(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => {
    (_req as unknown as { user: { sub: string } }).user = { sub: 'tester' };
    next();
  });
  app.use('/api/typed-documents', typedDocumentsRouter);
  app.use(errorHandler);
  return app;
}

function multipartBody(filename: string, csv: string): { body: Buffer; boundary: string } {
  const boundary = '----TestBoundary' + Date.now();
  const parts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`,
    'Content-Type: text/csv\r\n\r\n',
    csv,
    `\r\n--${boundary}--\r\n`,
  ];
  return { body: Buffer.from(parts.join('')), boundary };
}

async function postMultipart(
  server: http.Server,
  path: string,
  csv: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { body, boundary } = multipartBody('import.csv', csv);
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path, method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try { resolve({ status: res.statusCode!, json: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode!, json: { raw: data } as Record<string, unknown> }); }
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('POST /api/typed-documents/bulk-import', () => {
  let server: http.Server;

  beforeAll((done) => {
    server = buildAppWithUser().listen(0, '127.0.0.1', done);
  });
  afterAll((done) => { server.close(done); });

  it('imports valid CSV rows and returns counts', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const csv = 'Name,Age\nAlice,30\nBob,25\n';
    const res = await postMultipart(server, '/api/typed-documents/bulk-import?typeId=type-1', csv);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ imported: 2, failed: 0 });
    expect(mockTypedDocCreate).toHaveBeenCalledTimes(2);
  });

  it('maps by field name (case-sensitive)', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const csv = 'name,Age\nalice,30\n'; // lowercase 'name' doesn't match 'Name'
    const res = await postMultipart(server, '/api/typed-documents/bulk-import?typeId=type-1', csv);
    // 'name' is unknown, so only Age is mapped; required field f-name missing → row fails
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ imported: 0, failed: 1 });
  });

  it('reports row errors without aborting the batch', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const csv = 'Name,Age\nAlice,thirty\nBob,25\n';
    const res = await postMultipart(server, '/api/typed-documents/bulk-import?typeId=type-1', csv);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ imported: 1, failed: 1 });
    expect((res.json as { errors: unknown[] }).errors).toHaveLength(1);
  });

  it('returns 200 with zero counts for empty CSV', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const csv = 'Name,Age\n';
    const res = await postMultipart(server, '/api/typed-documents/bulk-import?typeId=type-1', csv);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ imported: 0, failed: 0, errors: [] });
  });

  it('rejects missing typeId with 400', async () => {
    const csv = 'Name\nAlice\n';
    const res = await postMultipart(server, '/api/typed-documents/bulk-import', csv);
    expect(res.status).toBe(400);
  });

  it('returns 404 when type not found', async () => {
    mockDocTypeGet.mockResolvedValue(null);
    const csv = 'Name\nAlice\n';
    const res = await postMultipart(server, '/api/typed-documents/bulk-import?typeId=nope', csv);
    expect(res.status).toBe(404);
  });

  it('coerces boolean values from CSV strings', async () => {
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-b', fields: [TEXT_FIELD, BOOL_FIELD] });
    const csv = 'Name,Active\nAlice,yes\nBob,0\n';
    const res = await postMultipart(server, '/api/typed-documents/bulk-import?typeId=type-b', csv);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ imported: 2, failed: 0 });
    const call1 = mockTypedDocCreate.mock.calls[0][0];
    const call2 = mockTypedDocCreate.mock.calls[1][0];
    expect(call1.values['f-active']).toBe(true);
    expect(call2.values['f-active']).toBe(false);
  });

  it('handles multi-value fields split on semicolons', async () => {
    mockDocTypeGet.mockResolvedValue({ typeId: 'type-m', fields: [MULTI_TEXT] });
    const csv = 'Tags\nred;green;blue\n';
    const res = await postMultipart(server, '/api/typed-documents/bulk-import?typeId=type-m', csv);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ imported: 1, failed: 0 });
    expect(mockTypedDocCreate.mock.calls[0][0].values['f-tags']).toEqual(['red', 'green', 'blue']);
  });

  it('skips unknown CSV columns silently', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const csv = 'Name,Notes\nAlice,some note\n';
    const res = await postMultipart(server, '/api/typed-documents/bulk-import?typeId=type-1', csv);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ imported: 1, failed: 0 });
  });

  it('validates enum values in CSV rows', async () => {
    mockDocTypeGet.mockResolvedValue(BASIC_TYPE);
    const csv = 'Name,Status\nAlice,deleted\n';
    const res = await postMultipart(server, '/api/typed-documents/bulk-import?typeId=type-1', csv);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ imported: 0, failed: 1 });
  });
});
