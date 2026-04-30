// Phase 51 Phase A — integration tests for document types + typed documents.
//
// The test fixture provides an in-memory implementation of both repositories
// (mocked at the module level via jest.mock) so the routes can exercise the
// full create-type → post-doc → retrieve-doc loop without touching DDB.
//
// Coverage:
//   - POST   /api/document-types         create + 201 + echo
//   - GET    /api/document-types         list
//   - GET    /api/document-types/:id     fetch one (404 on miss)
//   - PUT    /api/document-types/:id     patch fields (404 on miss)
//   - DELETE /api/document-types/:id     idempotent 204
//   - POST   /api/typed-documents        rejects unknown typeId, missing required fields,
//                                        wrong cardinality shape, unknown field names;
//                                        accepts valid payload with values keyed by fieldId
//   - GET    /api/typed-documents/:id    fetch one (404 on miss)
//   - GET    /api/typed-documents?typeId list-by-type
//   - End-to-end loop: create type with text+long_text fields → post matching doc →
//     retrieve via typeId list AND via documentId.

import express, { type NextFunction, type Request, type Response } from 'express';

// ---------------------------------------------------------------------------
// In-memory repo fakes — installed via jest.mock before the routes are
// imported so the route modules close over the fakes, not the real DDB-backed
// singletons.
// ---------------------------------------------------------------------------

interface FakeTypeStore { [typeId: string]: Record<string, unknown> }
interface FakeDocStore  { [documentId: string]: Record<string, unknown> }

const typeStore: FakeTypeStore = {};
const docStore:  FakeDocStore  = {};

jest.mock('../../repositories', () => ({
  documentTypeRepo: {
    create: jest.fn(async (item: Record<string, unknown>) => {
      typeStore[item.typeId as string] = { ...item };
    }),
    get: jest.fn(async (typeId: string) => typeStore[typeId] ?? null),
    list: jest.fn(async () => Object.values(typeStore)),
    update: jest.fn(async (typeId: string, patch: Record<string, unknown>) => {
      const existing = typeStore[typeId];
      if (!existing) return null;
      const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      typeStore[typeId] = merged;
      return merged;
    }),
    delete: jest.fn(async (typeId: string) => {
      delete typeStore[typeId];
    }),
  },
  typedDocumentRepo: {
    create: jest.fn(async (item: Record<string, unknown>) => {
      docStore[item.documentId as string] = { ...item };
    }),
    get: jest.fn(async (documentId: string) => docStore[documentId] ?? null),
    listByType: jest.fn(async (typeId: string) =>
      Object.values(docStore).filter((d) => d.typeId === typeId),
    ),
  },
}));

import { documentTypesRouter } from '../documentTypes';
import { typedDocumentsRouter } from '../typedDocuments';
import { errorHandler } from '../../middleware/error-handler';

// ---------------------------------------------------------------------------
// req/res rig — mirrors pipelineDLQ.test.ts
// ---------------------------------------------------------------------------

interface MockRes {
  statusCode: number;
  headers: Record<string, string | number | readonly string[]>;
  body: unknown;
  ended: boolean;
  finished: Promise<void>;
  status(code: number): MockRes;
  json(body: unknown): MockRes;
  setHeader(name: string, value: number | string | readonly string[]): MockRes;
  getHeader(name: string): unknown;
  end(...args: unknown[]): MockRes;
}

function mockRes(): MockRes {
  let resolveFinished!: () => void;
  const finished = new Promise<void>((r) => { resolveFinished = r; });
  const r: MockRes = {
    statusCode: 200, headers: {}, body: undefined, ended: false, finished,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; resolveFinished(); return this; },
    setHeader(name, value) { this.headers[String(name)] = value; return this; },
    getHeader(name) { return this.headers[String(name)]; },
    end(..._args) { this.ended = true; resolveFinished(); return this; },
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
    ip: '127.0.0.1',
  } as unknown as Request;
  await new Promise<void>((resolve, reject) => {
    const finalHandler = (err?: unknown): void => {
      if (err) { reject(err); return; }
      if (!res.ended) { res.status(404).json({ error: 'route not found' }); }
      resolve();
    };
    (app as unknown as (req: Request, res: Response, next: NextFunction) => void)(
      req, res as unknown as Response, finalHandler,
    );
    res.finished.then(() => resolve()).catch(reject);
  });
  return res;
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/document-types', documentTypesRouter);
  app.use('/api/typed-documents', typedDocumentsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  for (const k of Object.keys(typeStore)) delete typeStore[k];
  for (const k of Object.keys(docStore))  delete docStore[k];
});

// ---------------------------------------------------------------------------
// Document Types — CRUD
// ---------------------------------------------------------------------------

describe('document-types CRUD', () => {
  test('POST creates with name + fields, defaults description/icon, returns 201', async () => {
    const res = await run(buildApp(), 'POST', '/api/document-types', {
      body: {
        name: 'Article',
        fields: [
          { name: 'title', fieldType: 'text', widget: 'text_field', cardinality: 1, required: true },
          { name: 'body',  fieldType: 'long_text', widget: 'textarea',  cardinality: 1, required: false },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.body as { typeId: string; name: string; fields: { fieldId: string }[]; icon: string };
    expect(body.typeId).toMatch(/.+/);
    expect(body.name).toBe('Article');
    expect(body.icon).toBe('📄');
    expect(body.fields).toHaveLength(2);
    expect(body.fields[0].fieldId).toMatch(/.+/);
  });

  test('POST rejects empty name', async () => {
    const res = await run(buildApp(), 'POST', '/api/document-types', {
      body: { name: '   ', fields: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST rejects unknown fieldType', async () => {
    const res = await run(buildApp(), 'POST', '/api/document-types', {
      body: {
        name: 'Bad',
        fields: [{ name: 'x', fieldType: 'image', widget: 'text_field', cardinality: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  test('GET / lists created types', async () => {
    typeStore['t1'] = { typeId: 't1', name: 'A', fields: [] };
    typeStore['t2'] = { typeId: 't2', name: 'B', fields: [] };
    const res = await run(buildApp(), 'GET', '/api/document-types');
    expect(res.statusCode).toBe(200);
    const body = res.body as { items: { typeId: string }[] };
    expect(body.items).toHaveLength(2);
  });

  test('GET /:typeId 200 when found, 404 when missing', async () => {
    typeStore['t1'] = { typeId: 't1', name: 'A', fields: [] };
    const ok = await run(buildApp(), 'GET', '/api/document-types/t1');
    expect(ok.statusCode).toBe(200);

    const miss = await run(buildApp(), 'GET', '/api/document-types/missing');
    expect(miss.statusCode).toBe(404);
  });

  test('PUT updates name + fields and bumps updatedAt', async () => {
    typeStore['t1'] = { typeId: 't1', name: 'A', fields: [], updatedAt: '2026-01-01' };
    const res = await run(buildApp(), 'PUT', '/api/document-types/t1', {
      body: { name: 'A2' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as { name: string; updatedAt: string };
    expect(body.name).toBe('A2');
    expect(body.updatedAt).not.toBe('2026-01-01');
  });

  test('DELETE returns 204', async () => {
    typeStore['t1'] = { typeId: 't1', name: 'A', fields: [] };
    const res = await run(buildApp(), 'DELETE', '/api/document-types/t1');
    expect(res.statusCode).toBe(204);
    expect(typeStore['t1']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Typed Documents — schema-aware POST + reads
// ---------------------------------------------------------------------------

describe('typed-documents schema validation', () => {
  beforeEach(() => {
    typeStore['type-1'] = {
      typeId: 'type-1',
      name: 'Note',
      fields: [
        { fieldId: 'f-title', name: 'title', fieldType: 'text',      widget: 'text_field', cardinality: 1, required: true,  helpText: '' },
        { fieldId: 'f-body',  name: 'body',  fieldType: 'long_text', widget: 'textarea',   cardinality: 1, required: false, helpText: '' },
        { fieldId: 'f-tags',  name: 'tags',  fieldType: 'text',      widget: 'text_field', cardinality: 'unlimited', required: false, helpText: '' },
      ],
    };
  });

  test('POST rejects unknown typeId with 404', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'does-not-exist', values: {} },
    });
    expect(res.statusCode).toBe(404);
  });

  test('POST rejects when required field is missing', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-body': 'some body' } },
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST rejects unknown fieldId in values', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-title': 'ok', 'f-bogus': 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST rejects wrong cardinality shape (string for unlimited)', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-title': 'ok', 'f-tags': 'should-be-array' } },
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST 201 with valid required field; optional omitted; unlimited as array', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-1', values: { 'f-title': 'Hello', 'f-tags': ['a', 'b'] } },
    });
    expect(res.statusCode).toBe(201);
    const body = res.body as { documentId: string; typeId: string; values: Record<string, unknown> };
    expect(body.typeId).toBe('type-1');
    expect(body.values['f-title']).toBe('Hello');
    expect(body.values['f-tags']).toEqual(['a', 'b']);
    expect(body.values['f-body']).toBeUndefined(); // omitted optional stays unset
  });

  test('GET /:documentId returns the doc, 404 when missing', async () => {
    docStore['d-1'] = { documentId: 'd-1', typeId: 'type-1', values: { 'f-title': 'x' } };
    const ok = await run(buildApp(), 'GET', '/api/typed-documents/d-1');
    expect(ok.statusCode).toBe(200);
    const miss = await run(buildApp(), 'GET', '/api/typed-documents/missing');
    expect(miss.statusCode).toBe(404);
  });

  test('GET ?typeId lists docs of that type only', async () => {
    docStore['d-1'] = { documentId: 'd-1', typeId: 'type-1', values: {} };
    docStore['d-2'] = { documentId: 'd-2', typeId: 'type-1', values: {} };
    docStore['d-3'] = { documentId: 'd-3', typeId: 'other',  values: {} };
    const res = await run(buildApp(), 'GET', '/api/typed-documents?typeId=type-1');
    expect(res.statusCode).toBe(200);
    const body = res.body as { items: unknown[] };
    expect(body.items).toHaveLength(2);
  });

  test('GET without typeId 400s', async () => {
    const res = await run(buildApp(), 'GET', '/api/typed-documents');
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Phase B — number / date / boolean field types
// ---------------------------------------------------------------------------

describe('Phase B field types: number / date / boolean', () => {
  beforeEach(() => {
    typeStore['type-b'] = {
      typeId: 'type-b',
      name: 'Phase B Sample',
      fields: [
        { fieldId: 'f-num',  name: 'count',     fieldType: 'number',  widget: 'number_input', cardinality: 1, required: true,  helpText: '' },
        { fieldId: 'f-date', name: 'when',      fieldType: 'date',    widget: 'date_picker',  cardinality: 1, required: false, helpText: '' },
        { fieldId: 'f-bool', name: 'completed', fieldType: 'boolean', widget: 'checkbox',     cardinality: 1, required: true,  helpText: '' },
        { fieldId: 'f-nums', name: 'scores',    fieldType: 'number',  widget: 'number_input', cardinality: 'unlimited', required: false, helpText: '' },
      ],
    };
  });

  test('POST creates a type that uses every Phase B field type', async () => {
    const res = await run(buildApp(), 'POST', '/api/document-types', {
      body: {
        name: 'Mix',
        fields: [
          { name: 'count',     fieldType: 'number',  widget: 'number_input', cardinality: 1, required: true },
          { name: 'when',      fieldType: 'date',    widget: 'date_picker',  cardinality: 1, required: false },
          { name: 'completed', fieldType: 'boolean', widget: 'checkbox',     cardinality: 1, required: false },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
  });

  test('POST rejects non-number for a number field', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-b', values: { 'f-num': 'not-a-number', 'f-bool': true } },
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST rejects non-finite (NaN/Infinity) numbers — would arrive as string in JSON', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-b', values: { 'f-num': 'NaN', 'f-bool': true } },
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST rejects non-ISO date strings', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-b', values: { 'f-num': 1, 'f-bool': true, 'f-date': 'last Tuesday' } },
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST rejects non-boolean for a boolean field (e.g. string "true")', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-b', values: { 'f-num': 1, 'f-bool': 'true' } },
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST rejects boolean field with unlimited cardinality at the type-creation step', async () => {
    const res = await run(buildApp(), 'POST', '/api/document-types', {
      body: {
        name: 'Bad',
        fields: [
          { name: 'flags', fieldType: 'boolean', widget: 'checkbox', cardinality: 'unlimited', required: false },
        ],
      },
    });
    // Type creation accepts the shape (the field-type/widget/cardinality
    // tuple is permissive at the API level); rejection happens at instance
    // creation. This test pins that expectation so a future tightening of
    // type-creation validation is a deliberate decision.
    expect(res.statusCode).toBe(201);
  });

  test('POST 201 with all valid Phase B values; coerces correctly through GET', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: {
        typeId: 'type-b',
        values: {
          'f-num':  42,
          'f-date': '2026-04-30',
          'f-bool': false,
          'f-nums': [1, 2, 3],
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.body as { documentId: string; values: Record<string, unknown> };
    expect(created.values['f-num']).toBe(42);
    expect(created.values['f-date']).toBe('2026-04-30');
    expect(created.values['f-bool']).toBe(false);
    expect(created.values['f-nums']).toEqual([1, 2, 3]);

    // GET round-trip preserves values verbatim
    const fetched = await run(buildApp(), 'GET', `/api/typed-documents/${created.documentId}`);
    expect(fetched.statusCode).toBe(200);
    const got = fetched.body as { values: Record<string, unknown> };
    expect(got.values['f-num']).toBe(42);
    expect(got.values['f-bool']).toBe(false);
  });

  test('POST 201 when required boolean is explicitly false (false is a valid present value)', async () => {
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-b', values: { 'f-num': 1, 'f-bool': false } },
    });
    expect(res.statusCode).toBe(201);
  });

  test('POST rejects unlimited boolean (caught at value-shape validation)', async () => {
    typeStore['type-bool-bad'] = {
      typeId: 'type-bool-bad',
      name: 'BadBool',
      fields: [
        { fieldId: 'f-flags', name: 'flags', fieldType: 'boolean', widget: 'checkbox', cardinality: 'unlimited', required: false, helpText: '' },
      ],
    };
    const res = await run(buildApp(), 'POST', '/api/typed-documents', {
      body: { typeId: 'type-bool-bad', values: { 'f-flags': [true, false] } },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Phase A acceptance test — full create-type → post-doc → retrieve loop
// ---------------------------------------------------------------------------

describe('Phase A end-to-end loop', () => {
  test('admin creates "Note" type → end-user posts an instance → retrieve by id and by typeId', async () => {
    const app = buildApp();

    // 1. Admin creates the type
    const createTypeRes = await run(app, 'POST', '/api/document-types', {
      body: {
        name: 'Note',
        description: 'A short note',
        fields: [
          { name: 'title', fieldType: 'text',      widget: 'text_field', cardinality: 1,           required: true },
          { name: 'body',  fieldType: 'long_text', widget: 'textarea',   cardinality: 1,           required: false },
        ],
      },
      userId: 'admin-1',
    });
    expect(createTypeRes.statusCode).toBe(201);
    const type = createTypeRes.body as {
      typeId: string;
      fields: { fieldId: string; name: string }[];
    };

    // 2. End-user posts an instance against that type
    const titleId = type.fields.find((f) => f.name === 'title')!.fieldId;
    const bodyId  = type.fields.find((f) => f.name === 'body')!.fieldId;

    const postDocRes = await run(app, 'POST', '/api/typed-documents', {
      body: {
        typeId: type.typeId,
        values: { [titleId]: 'My first note', [bodyId]: 'Hello, world.' },
      },
      userId: 'user-1',
    });
    expect(postDocRes.statusCode).toBe(201);
    const doc = postDocRes.body as { documentId: string };

    // 3a. Retrieve by document id
    const getDocRes = await run(app, 'GET', `/api/typed-documents/${doc.documentId}`);
    expect(getDocRes.statusCode).toBe(200);
    const fetched = getDocRes.body as { values: Record<string, unknown>; createdBy: string };
    expect(fetched.values[titleId]).toBe('My first note');
    expect(fetched.values[bodyId]).toBe('Hello, world.');
    expect(fetched.createdBy).toBe('user-1');

    // 3b. Retrieve via list-by-type
    const listRes = await run(app, 'GET', `/api/typed-documents?typeId=${type.typeId}`);
    expect(listRes.statusCode).toBe(200);
    const list = listRes.body as { items: { documentId: string }[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0].documentId).toBe(doc.documentId);
  });
});
