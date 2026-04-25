// frontend/src/components/pipelines/persistence/pipelineStorageRemote.ts
//
// Phase 4 stub: thin REST client mirroring the API surface of the local
// `pipelineStorage.ts`. Not consumed by any UI path in Phase 1 — exists so
// Phase 4 can flip a feature flag and wire event-sourced write-through
// (localStorage authoritative, flush to remote) without further plumbing.
//
// Backend contract lives at:
//   social-api/src/routes/pipelineDefinitions.ts
// mounted at `/api/pipelines/defs` (see routes/index.ts — mounted after
// `/api/pipelines/metrics` to avoid a static-vs-:pipelineId collision).
//
// All functions require a Cognito idToken (Bearer). They throw on non-2xx
// except `loadPipelineRemote` / `publishPipelineRemote`, which resolve to
// `null` on 404 to match the local module's "missing returns null" habit.

import type { PipelineDefinition } from '../../../types/pipeline';
import {
  deletePipeline as deletePipelineLocal,
  listPipelines as listPipelinesLocal,
  loadPipeline as loadPipelineLocal,
  savePipeline as savePipelineLocal,
  type PipelineIndexEntry,
} from './pipelineStorage';

// ---------------------------------------------------------------------------
// Base URL / headers
// ---------------------------------------------------------------------------

function apiBase(): string {
  return (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';
}

function defsUrl(path = ''): string {
  return `${apiBase()}/api/pipelines/defs${path}`;
}

function authHeaders(idToken: string, withBody = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${idToken}` };
  if (withBody) h['Content-Type'] = 'application/json';
  return h;
}

// ---------------------------------------------------------------------------
// Public API — mirrors pipelineStorage.ts (async variants)
// ---------------------------------------------------------------------------

export async function listPipelinesRemote(idToken: string): Promise<PipelineIndexEntry[]> {
  const res = await fetch(defsUrl('/'), { headers: authHeaders(idToken) });
  if (!res.ok) throw new Error(`listPipelinesRemote failed (${res.status})`);
  const body = (await res.json()) as { pipelines: PipelineDefinition[] };
  // Project server's full defs into the lightweight index shape the UI uses.
  return (body.pipelines ?? []).map((def): PipelineIndexEntry => {
    const entry: PipelineIndexEntry = {
      id: def.id,
      name: def.name,
      status: def.status,
      updatedAt: def.updatedAt,
    };
    if (def.icon) entry.icon = def.icon;
    if (def.tags && def.tags.length > 0) entry.tags = [...def.tags];
    return entry;
  });
}

export async function loadPipelineRemote(
  idToken: string,
  id: string,
): Promise<PipelineDefinition | null> {
  const res = await fetch(defsUrl(`/${encodeURIComponent(id)}`), {
    headers: authHeaders(idToken),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`loadPipelineRemote failed (${res.status})`);
  return (await res.json()) as PipelineDefinition;
}

export async function savePipelineRemote(
  idToken: string,
  def: PipelineDefinition,
): Promise<void> {
  const res = await fetch(defsUrl(`/${encodeURIComponent(def.id)}`), {
    method: 'PUT',
    headers: authHeaders(idToken, true),
    body: JSON.stringify(def),
  });
  if (!res.ok) throw new Error(`savePipelineRemote failed (${res.status})`);
}

export async function deletePipelineRemote(idToken: string, id: string): Promise<void> {
  const res = await fetch(defsUrl(`/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: authHeaders(idToken),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deletePipelineRemote failed (${res.status})`);
  }
}

export async function publishPipelineRemote(
  idToken: string,
  id: string,
): Promise<PipelineDefinition | null> {
  const res = await fetch(defsUrl(`/${encodeURIComponent(id)}/publish`), {
    method: 'POST',
    headers: authHeaders(idToken),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`publishPipelineRemote failed (${res.status})`);
  return (await res.json()) as PipelineDefinition;
}

// ---------------------------------------------------------------------------
// Fallback variants — gracefully drop to localStorage when the backend is
// unreachable (404 on collection, network error, 5xx) so dev still works
// without social-api running. These are the recommended entry points for UI
// code; the strict variants above remain available for tests + diagnostics.
// ---------------------------------------------------------------------------

function isBackendDownError(err: unknown): boolean {
  // Network errors (fetch rejection) and 5xx-throws bubble through here. The
  // strict variants tag their failures with the function name + status code;
  // we treat anything we cannot positively identify as "backend reachable
  // but errored" as backend-down for fallback purposes.
  if (!err) return true;
  const msg = (err as Error).message || String(err);
  // Known transient / unreachable signatures.
  return (
    msg.includes('NetworkError') ||
    msg.includes('Failed to fetch') ||
    msg.includes('network') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  );
}

export async function listPipelinesWithFallback(
  idToken: string | null | undefined,
): Promise<PipelineIndexEntry[]> {
  if (!idToken) return listPipelinesLocal();
  try {
    return await listPipelinesRemote(idToken);
  } catch (err) {
    if (isBackendDownError(err)) return listPipelinesLocal();
    throw err;
  }
}

export async function loadPipelineWithFallback(
  idToken: string | null | undefined,
  id: string,
): Promise<PipelineDefinition | null> {
  if (!idToken) return loadPipelineLocal(id);
  try {
    const remote = await loadPipelineRemote(idToken, id);
    // 404 already returns null from the strict variant — fall back to local
    // so an offline-first edit is still recoverable.
    return remote ?? loadPipelineLocal(id);
  } catch (err) {
    if (isBackendDownError(err)) return loadPipelineLocal(id);
    throw err;
  }
}

export async function savePipelineWithFallback(
  idToken: string | null | undefined,
  def: PipelineDefinition,
): Promise<void> {
  // Always write through to local first — offline-first edits stay durable
  // even if the remote write later fails.
  savePipelineLocal(def);
  if (!idToken) return;
  try {
    await savePipelineRemote(idToken, def);
  } catch (err) {
    if (isBackendDownError(err)) return;
    throw err;
  }
}

export async function deletePipelineWithFallback(
  idToken: string | null | undefined,
  id: string,
): Promise<void> {
  deletePipelineLocal(id);
  if (!idToken) return;
  try {
    await deletePipelineRemote(idToken, id);
  } catch (err) {
    if (isBackendDownError(err)) return;
    throw err;
  }
}
