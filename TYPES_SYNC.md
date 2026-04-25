## Cross-Repo Type Synchronization

Pipelines feature types live in two places:

| Repo | Canonical file |
|---|---|
| websocket-gateway | `frontend/src/types/pipeline.ts` |
| distributed-core | `src/applications/pipeline/types.ts` |

**Both are treated as authoritative in their own tree.** No cross-project imports — the repos are independent. This doc exists so drift doesn't cause silent incompatibility.

## The rule (Phase 3–5)

**Any change to either file MUST be applied in both repos in the same PR cycle.** Recipe:

1. Decide which repo "owns" the change (usually whichever side is driving the feature).
2. Edit both `pipeline.ts` files in parallel — keep the shape identical.
3. Run the full test suite in both repos. The `pipelineExecutor.contract.test.ts` is the shared behavioral contract and must pass on both.
4. Open parallel PRs referencing each other. Merge within the same deploy window.

## Promotion to a shared package (post-Phase-5)

Once pipeline types have stabilized (Phase 5+), extract into a shared package `@hoehn/pipeline-types` to eliminate drift mechanically:

- New repo / workspace: `pipeline-types/` with `package.json`, `tsconfig.json`, the canonical types file
- Both projects add it as a dependency (via workspace link or npm publish)
- The dual `pipeline.ts` files become thin re-exports
- Type changes happen via a PR to `pipeline-types/` that downstream consumers pull in

**Why not now?** Types are still evolving rapidly (events being added, node shapes being refined). A shared package is optimal when types are stable; during flux it creates more PR ceremony than it saves. Promote when the event map + node-data shapes go a month without change.

## Types covered by this sync

Anything under `PipelineEventMap`, the `NodeData` discriminated union (all 8 variants), `PipelineDefinition`, `PipelineRun`, `StepExecution`, `ValidationResult`, `ValidationCode`, `ValidationIssue`, `PipelineWireEvent` (the wire envelope).

- `LLMClient`, `LLMChunk`, `LLMStreamOptions` — interface contract for LLM providers. Canonical in distributed-core (`src/applications/pipeline/LLMClient.ts`); mirrored locally at `social-api/src/pipeline/LLMClient.ts` until distributed-core is a dep. Concrete provider implementations (AnthropicLLMClient, BedrockLLMClient) live only in websocket-gateway — kernel stays SDK-free.

UI-only helpers (render styles, icon pickers, form state) live only in `websocket-gateway` and are not in scope.

## Automated guardrails (optional, low-priority)

A CI script that diffs the two files and fails if shapes diverge. Naive approach: strip whitespace + comments + export keywords, AST-compare via TypeScript compiler API. Leave this for later — the human rule suffices while the team is small.

## Contract test

`frontend/src/components/pipelines/__tests__/pipelineExecutor.contract.test.ts` in websocket-gateway is the behavioral source of truth for how both executors must behave. It's ported verbatim to distributed-core's `src/applications/pipeline/__tests__/pipelineExecutor.contract.test.ts` with a fake LLMClient. When executor semantics change, update both copies + verify both pass.

## Changelog

Each type change appends a line here (date, one-line description, commit SHA placeholder):

- 2026-04-24 — Initial split. Both copies shape-equal.
- 2026-04-24 — Added `PipelineWireEvent` envelope type — both repos updated. (commit TBD)
- 2026-04-23 — Added cron parser duplicates: `frontend/src/components/pipelines/cron/cronUtils.ts` (parseCron / matchesCron / nextFires) and `social-api/src/services/scheduleEvaluator.ts` (parseCronExpression / cronMatches). Same 5-field grammar (`*`, `N`, `N,M,...`, `A-B`, `*\/N`). Cross-project module sharing isn't possible yet — keep both copies in lockstep. (commit TBD)
