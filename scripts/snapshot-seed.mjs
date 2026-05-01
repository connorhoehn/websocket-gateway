#!/usr/bin/env node
//
// Phase 51 / hub#53 — seed sample rows into the local DDB so the snapshot
// captures show real, populated UI instead of empty states. Idempotent:
// each PutCommand is non-conditional, but the items use stable IDs so
// re-runs overwrite-in-place rather than duplicating.

import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { existsSync } from 'node:fs';

// Shared-services precondition: when AGENT_HUB_ROOT is set, the host-side
// shared DDB stack must be running before seeding. Failing fast here saves
// the operator a confusing "connection refused" stack trace later.
if (process.env.AGENT_HUB_ROOT) {
  const stateFile = `${process.env.AGENT_HUB_ROOT}/.shared-services.json`;
  if (!existsSync(stateFile)) {
    console.error('[seed] ERROR: AGENT_HUB_ROOT is set but shared services are not running.');
    console.error(`[seed]        Expected state file at: ${stateFile}`);
    console.error('[seed]        Start them first:');
    console.error(`[seed]          ${process.env.AGENT_HUB_ROOT}/scripts/start-shared-services.sh`);
    process.exit(1);
  }
}

const ENDPOINT = process.env.LOCALSTACK_ENDPOINT ?? 'http://localhost:8000';
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const USER_ID = 'dev-user';
const NOW = '2026-04-30T18:25:00.000Z';

const ddb = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});
const doc = DynamoDBDocumentClient.from(ddb, {
  marshallOptions: { removeUndefinedValues: true },
});

// Local-dev-only DDB table-name prefix (mirrors src/lib/ddb-table-name.js).
// When the gateway runs in shared-services mode, DDB_TABLE_PREFIX=gateway_
// is set so seeded rows land in the same prefixed tables the app reads.
const TABLE_PREFIX = process.env.DDB_TABLE_PREFIX ?? '';

async function put(table, item) {
  const resolved = `${TABLE_PREFIX}${table}`;
  await doc.send(new PutCommand({ TableName: resolved, Item: item }));
  console.log(`[seed] ${resolved} <- ${JSON.stringify(item).slice(0, 80)}…`);
}

async function main() {
  // Profile (the /health canary table — also read by the profile UI).
  await put('social-profiles', {
    userId: USER_ID,
    displayName: 'Dev User',
    bio: 'Local development account',
    avatarUrl: '',
    visibility: 'public',
    createdAt: NOW,
    updatedAt: NOW,
  });

  // Rooms / channels — three sample rooms, each owned by the dev user.
  const rooms = [
    { id: 'room-general',     name: 'General' },
    { id: 'room-engineering', name: 'Engineering' },
    { id: 'room-design',      name: 'Design' },
  ];
  for (const r of rooms) {
    await put('social-rooms', {
      roomId: r.id,
      channelId: r.id,
      name: r.name,
      type: 'standalone',
      ownerId: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await put('social-room-members', {
      roomId: r.id,
      userId: USER_ID,
      role: 'owner',
      joinedAt: NOW,
    });
  }

  // Document types (Phase 51 Phase A schema shape).
  await put('document-types', {
    typeId: 'sample-article',
    name: 'Article',
    description: 'Long-form article post',
    icon: '📄',
    fields: [
      { fieldId: 'f-title', name: 'Title', fieldType: 'text', widget: 'text_field', cardinality: 1, required: true,  helpText: '' },
      { fieldId: 'f-body',  name: 'Body',  fieldType: 'long_text', widget: 'textarea', cardinality: 1, required: false, helpText: '' },
    ],
    createdBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await put('document-types', {
    typeId: 'sample-event',
    name: 'Event',
    description: 'Calendar event',
    icon: '📅',
    fields: [
      { fieldId: 'f-name', name: 'Name', fieldType: 'text', widget: 'text_field', cardinality: 1, required: true, helpText: '' },
      { fieldId: 'f-when', name: 'When', fieldType: 'date', widget: 'date_picker', cardinality: 1, required: true, helpText: '' },
    ],
    createdBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
  });

  // Typed documents — instances of the seeded types.
  await put('typed-documents', {
    documentId: 'sample-doc-1',
    typeId: 'sample-article',
    values: { 'f-title': 'Welcome to the snapshot', 'f-body': 'This is a sample article seeded for snapshot capture.' },
    createdBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await put('typed-documents', {
    documentId: 'sample-doc-2',
    typeId: 'sample-event',
    values: { 'f-name': 'Snapshot demo', 'f-when': '2026-05-01' },
    createdBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
  });

  // Activity log — four entries so the activity sidebar isn't empty.
  const events = [
    { ts: '2026-04-30T18:21:00.000Z#evt-1', type: 'document.created',   detail: { documentId: 'sample-doc-1' } },
    { ts: '2026-04-30T18:22:00.000Z#evt-2', type: 'document.created',   detail: { documentId: 'sample-doc-2' } },
    { ts: '2026-04-30T18:23:00.000Z#evt-3', type: 'room.joined',        detail: { roomId: 'room-engineering' } },
    { ts: '2026-04-30T18:24:00.000Z#evt-4', type: 'document.published', detail: { documentId: 'sample-doc-2' } },
  ];
  for (const e of events) {
    await put('user-activity', {
      userId: USER_ID,
      timestamp: e.ts,
      eventType: e.type,
      detail: JSON.stringify(e.detail),
    });
  }

  console.log('[seed] done');
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
