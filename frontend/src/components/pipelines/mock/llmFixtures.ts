// frontend/src/components/pipelines/mock/llmFixtures.ts
//
// Prompt-aware LLM response library used by MockExecutor during development.
// Rather than emitting a random generic response, the mock scores every fixture
// against the combined (systemPrompt + userPromptTemplate) text and streams the
// highest-scoring response. This makes the UI feel real: a prompt asking for a
// summary produces a summary, a prompt asking for JSON produces JSON, etc.

export interface LLMFixture {
  id: string;
  /** Keywords whose presence in systemPrompt + userPromptTemplate score this fixture. */
  matchers: string[];
  /** Produced response text. */
  response: string;
  /** Rough simulated latency profile (overrides node defaults). */
  latencyProfileMs?: { mean: number; stdev: number };
}

export const LLM_FIXTURES: LLMFixture[] = [
  {
    id: 'summary-short',
    matchers: ['summarize', 'summary', 'tl;dr'],
    response:
      'The document outlines the team\'s Q2 progress across the three core initiatives, highlighting the successful rollout of the pipelines feature and ongoing work on the approval workflow. Overall, delivery is on track with modest schedule slippage in one area.',
    latencyProfileMs: { mean: 2200, stdev: 800 },
  },
  {
    id: 'summary-long',
    matchers: ['summarize', 'long-form', 'detailed', 'comprehensive'],
    response:
      'The report covers three major initiatives delivered during the quarter. The pipelines feature shipped on schedule with full editor parity, contract-test coverage across the executor surface, and a chaos panel for deterministic failure injection during demos.\n\nThe approval workflow is partially complete: the request/record event path is wired end-to-end, but the escalation policy and timeout auditing still need work. Two engineers are currently assigned and the remaining scope is estimated at roughly three sprints.\n\nFinally, the observability overhaul moved from design into implementation. Initial dashboards are in staging and early feedback from on-call has been positive, though retention tuning and alert thresholds remain open items for next quarter.',
    latencyProfileMs: { mean: 4200, stdev: 1200 },
  },
  {
    id: 'json-extract',
    matchers: ['extract', 'json', 'structured', 'schema'],
    response:
      '{\n  "title": "Q2 Engineering Review",\n  "author": "platform-team",\n  "publishedAt": "2026-04-15T10:00:00Z",\n  "topics": ["pipelines", "approvals", "observability"],\n  "wordCount": 1248,\n  "language": "en"\n}',
    latencyProfileMs: { mean: 1800, stdev: 600 },
  },
  {
    id: 'json-tags',
    matchers: ['tags', 'categorize', 'classify', 'label'],
    response: '{"tags": ["productivity", "report", "internal"]}',
    latencyProfileMs: { mean: 900, stdev: 300 },
  },
  {
    id: 'translate',
    matchers: ['translate', 'translation', 'spanish', 'french', 'german', 'japanese'],
    response:
      'El equipo ha completado con exito el despliegue de la funcionalidad de pipelines y continua trabajando en el flujo de aprobaciones. El progreso general es satisfactorio.',
    latencyProfileMs: { mean: 1500, stdev: 500 },
  },
  {
    id: 'sentiment',
    matchers: ['sentiment', 'mood', 'tone', 'emotion'],
    response:
      '{"sentiment": "positive", "confidence": 0.87, "reason": "The text emphasizes successful delivery, on-track progress, and positive feedback from stakeholders, with only mild notes about minor slippage."}',
    latencyProfileMs: { mean: 1100, stdev: 400 },
  },
  {
    id: 'action-items',
    matchers: ['action items', 'tasks', 'todos', 'action item'],
    response:
      '- Finalize the approval escalation policy and write integration tests for the timeout path\n- Tune observability alert thresholds based on staging feedback and the last week of canary data\n- Publish the Q2 retrospective to the internal engineering channel by end of week\n- Schedule a cross-team sync to align on Q3 pipeline roadmap priorities\n- Update the onboarding doc to reflect the new chaos panel workflow',
    latencyProfileMs: { mean: 2000, stdev: 700 },
  },
  {
    id: 'critique',
    matchers: ['critique', 'review', 'feedback', 'evaluate'],
    response:
      '- Strengths: the proposal is well-scoped, the acceptance criteria are crisp, and the rollout plan includes realistic milestones with named owners.\n- Gaps: the risk section underweights the impact of a failed migration; consider adding an explicit rollback rehearsal before the go/no-go checkpoint.\n- Suggestion: move the metrics definition section ahead of the implementation plan so reviewers can evaluate observability requirements before committing to the design.',
    latencyProfileMs: { mean: 2600, stdev: 900 },
  },
  {
    id: 'email-draft',
    matchers: ['email', 'draft', 'reply', 'message'],
    response:
      'Subject: Q2 review follow-up\n\nHi team,\n\nThanks for the thorough Q2 write-up. The pipelines delivery is impressive and the observability plan looks solid. Could you share the rollback rehearsal timeline by Friday so we can lock in the go/no-go date?\n\nAppreciate all the work on this.\n\nBest,\nSam',
    latencyProfileMs: { mean: 1700, stdev: 500 },
  },
  {
    id: 'code-review',
    matchers: ['code', 'lgtm', 'pr', 'pull request', 'diff'],
    response:
      '- The new executor dispatch switch is clean, but consider extracting the per-node latency sampling into a single helper so future node types pick it up automatically.\n- Nit: the `pickFixture` call site could memoize by (systemPrompt, userPromptTemplate) — cheap win on repeated streams.\n- The fixture matcher regex builds a new RegExp per call; fine for mock-scale traffic, but worth caching if this ever moves to a hot path.\n- Overall LGTM once the latency-helper refactor lands.',
    latencyProfileMs: { mean: 2400, stdev: 800 },
  },
  {
    id: 'moderation',
    matchers: ['moderate', 'safe', 'toxic', 'content policy', 'moderation'],
    response: '{"safe": true, "flags": []}',
    latencyProfileMs: { mean: 700, stdev: 200 },
  },
  {
    id: 'markdown-doc',
    matchers: ['markdown', 'doc', 'readme', 'documentation'],
    response:
      '# Pipelines Module\n\n## Overview\n\nThe pipelines module provides an in-browser workflow executor with a React Flow editor, a chaos panel for deterministic failure injection, and a contract-test suite shared with the Phase 3 distributed core.\n\n## Usage\n\n```ts\nimport { MockExecutor } from "./mock/MockExecutor";\n\nconst exec = new MockExecutor({ definition, onEvent });\nawait exec.run();\n```\n\n## Events\n\n- `pipeline.run.started`\n- `pipeline.step.started`\n- `pipeline.llm.token`\n- `pipeline.run.completed`',
    latencyProfileMs: { mean: 3200, stdev: 1000 },
  },
  {
    id: 'question-answer',
    matchers: ['answer', 'question', 'explain', 'what is', 'how does'],
    response:
      'Q: How does the mock executor simulate LLM latency?\n\nA: It draws a total stream budget from a normal distribution (mean ~3.5s, stdev ~1.5s) and paces per-token emission at roughly 40 tokens per second with jitter. Cancellation is cooperative — the stream loop checks a flag each tick and breaks early, resolving the containing step as cancelled.',
    latencyProfileMs: { mean: 2100, stdev: 700 },
  },
  {
    id: 'generic',
    matchers: [],
    response:
      'The analysis completed without issue; the provided input appears consistent with the expected schema and produced no notable warnings.',
    latencyProfileMs: { mean: 1500, stdev: 500 },
  },
];

/**
 * Score a single fixture against the lowercased combined prompt text.
 *
 * Scoring:
 *   +1.0 per substring match
 *   +0.5 bonus per word-boundary match (stronger signal than substring)
 *
 * Fixtures with no matchers (i.e. `generic`) always score 0, so they only win
 * when nothing else matches.
 */
function score(fixture: LLMFixture, text: string): number {
  let s = 0;
  for (const m of fixture.matchers) {
    const needle = m.toLowerCase();
    if (text.includes(needle)) s += 1;
    // Escape regex metacharacters in the matcher before building the boundary
    // pattern so multi-word matchers like "action items" still work.
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`);
    if (re.test(text)) s += 0.5;
  }
  return s;
}

/**
 * Score every fixture against the combined (systemPrompt + userPromptTemplate)
 * text. Returns the highest-scoring one. Ties are broken by response length
 * (longer wins — more interesting output). Falls back to the generic fixture
 * when nothing matches.
 */
export function pickFixture(systemPrompt: string, userPrompt: string): LLMFixture {
  const text = `${systemPrompt} ${userPrompt}`.toLowerCase();

  let best: LLMFixture | undefined;
  let bestScore = -Infinity;
  for (const fixture of LLM_FIXTURES) {
    const s = score(fixture, text);
    if (
      s > bestScore ||
      (s === bestScore && best && fixture.response.length > best.response.length)
    ) {
      best = fixture;
      bestScore = s;
    }
  }

  if (!best || bestScore <= 0) {
    return LLM_FIXTURES.find((f) => f.id === 'generic') ?? LLM_FIXTURES[LLM_FIXTURES.length - 1]!;
  }
  return best;
}
