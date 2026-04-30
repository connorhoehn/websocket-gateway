// Phase 51 / hub#80 — best-effort sync from the decisions renderer to
// the server-side approval log (POST /api/approvals, hub#62).
//
// Called from DecisionsEditorRenderer when an entry's status transitions
// to a terminal value. Errors are swallowed and logged — the CRDT layer
// stays the source of truth for live editing; this server-side mirror
// is the audit/query surface and must not block the UX.

const TERMINAL_DECISIONS = {
  acked: 'approved',
  done: 'approved',
  rejected: 'rejected',
} as const;

export type TerminalRendererStatus = keyof typeof TERMINAL_DECISIONS;
export type ApprovalDecision = typeof TERMINAL_DECISIONS[TerminalRendererStatus];

function getBaseUrl(): string {
  return (import.meta.env as Record<string, string>).VITE_SOCIAL_API_URL ?? '';
}

// Parses `/documents/<id>` from the current URL. Returns null when the
// path doesn't match — caller treats that as "not in a doc context,
// skip the sync."
export function readDocumentIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/\/documents\/([^/?#]+)/);
  return m ? m[1] : null;
}

export function mapStatusToDecision(status: string): ApprovalDecision | null {
  return (TERMINAL_DECISIONS as Record<string, ApprovalDecision>)[status] ?? null;
}

export interface PostApprovalArgs {
  sectionId: string;
  decision: ApprovalDecision;
  reviewerName?: string;
  comment?: string;
  /** Override for tests; production reads from window.location. */
  documentId?: string | null;
  /** Optional bearer token. Dev (SKIP_AUTH=true) accepts unauthenticated. */
  idToken?: string | null;
}

export async function postApproval(args: PostApprovalArgs): Promise<{ ok: boolean; error?: string }> {
  const documentId = args.documentId ?? readDocumentIdFromUrl();
  if (!documentId) return { ok: false, error: 'no documentId in URL' };
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (args.idToken) headers.Authorization = `Bearer ${args.idToken}`;
    const res = await fetch(`${getBaseUrl()}/api/approvals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        documentId,
        sectionId: args.sectionId,
        decision: args.decision,
        ...(args.reviewerName ? { reviewerName: args.reviewerName } : {}),
        ...(args.comment ? { comment: args.comment } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: `POST failed: ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
