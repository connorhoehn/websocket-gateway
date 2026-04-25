// frontend/src/components/pipelines/mock/MockExecutor.ts
//
// In-browser pipeline execution simulator. See PIPELINES_PLAN.md §8 for the
// spec and §17 for edge cases. The event ordering and semantics implemented
// here are the same contract the Phase 3 distributed-core PipelineModule must
// satisfy (shared test suite: `pipelineExecutor.contract.test.ts`).

import type {
  ActionNodeData,
  ApprovalNodeData,
  ApprovalRecord,
  Approver,
  ConditionNodeData,
  ForkNodeData,
  JoinNodeData,
  LLMNodeData,
  NodeType,
  PipelineDefinition,
  PipelineEdge,
  PipelineEventMap,
  PipelineNode,
  PipelineRun,
  StepExecution,
  StepStatus,
  TransformNodeData,
  TriggerNodeData,
} from '../../../types/pipeline';
import { getChaosState } from '../chaos/chaosState';
import { pickFixture } from './llmFixtures';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MockExecutorOptions {
  definition: PipelineDefinition;
  triggerPayload?: Record<string, unknown>;
  failureRateLLM?: number;
  failureRateOther?: number;
  speedMultiplier?: number;
  onEvent: <K extends keyof PipelineEventMap>(
    type: K,
    payload: PipelineEventMap[K],
  ) => void;
}

interface PendingApproval {
  runId: string;
  stepId: string;
  approvers: Approver[];
  requiredCount: number;
  recorded: ApprovalRecord[];
  resolve: (decision: 'approve' | 'reject') => void;
  timer?: ReturnType<typeof setTimeout>;
}

// Result of executing a single step. `sourceHandle` chooses the outgoing edge
// for the traversal — 'out' is the default, 'true'/'false' for Condition,
// 'approved'/'rejected' for Approval, 'error' for failed steps that have an
// error handle wired up.
interface StepOutcome {
  status: 'completed' | 'failed' | 'cancelled';
  output?: unknown;
  sourceHandle?: string;
  error?: string;
}

interface JoinArrival {
  edgeId: string;
  status: 'completed' | 'failed' | 'cancelled';
  context: Record<string, unknown> | undefined;
  sourceStepId: string;
}

interface JoinState {
  arrivals: JoinArrival[];
}

// ---------------------------------------------------------------------------
// MockExecutor
// ---------------------------------------------------------------------------

export class MockExecutor {
  readonly runId: string;

  private readonly definition: PipelineDefinition;
  private readonly onEvent: MockExecutorOptions['onEvent'];
  private readonly triggerPayload: Record<string, unknown>;
  private readonly failureRateLLM: number;
  private readonly failureRateOther: number;
  private readonly speedMultiplier: number;

  private readonly nodesById: Map<string, PipelineNode>;
  private readonly outgoingBySource: Map<string, PipelineEdge[]>;
  private readonly incomingByTarget: Map<string, PipelineEdge[]>;

  private pipelineRun: PipelineRun;
  private readonly currentStepIds = new Set<string>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly joinStates = new Map<string, JoinState>();
  /** Joins that have already fired — late arrivals are dropped silently. */
  private readonly firedJoins = new Set<string>();
  private readonly activeTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly cancelHooks = new Set<() => void>();

  private running = false;
  private cancelled = false;
  private runPromiseResolve?: (run: PipelineRun) => void;

  constructor(opts: MockExecutorOptions) {
    this.definition = opts.definition;
    this.onEvent = opts.onEvent;
    this.triggerPayload = opts.triggerPayload ?? {};
    this.failureRateLLM = opts.failureRateLLM ?? 0.1;
    this.failureRateOther = opts.failureRateOther ?? 0.02;
    this.speedMultiplier = opts.speedMultiplier ?? 1.0;

    this.nodesById = new Map(opts.definition.nodes.map((n) => [n.id, n]));
    this.outgoingBySource = new Map();
    this.incomingByTarget = new Map();
    for (const edge of opts.definition.edges) {
      pushTo(this.outgoingBySource, edge.source, edge);
      pushTo(this.incomingByTarget, edge.target, edge);
    }

    this.runId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    this.pipelineRun = this.initRun();
  }

  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  async run(): Promise<PipelineRun> {
    if (this.running) return this.pipelineRun;
    this.running = true;

    const trigger = this.findTrigger();
    if (!trigger) {
      const at = nowISO();
      this.pipelineRun.status = 'failed';
      this.pipelineRun.error = { nodeId: '(none)', message: 'No trigger node in definition' };
      this.pipelineRun.completedAt = at;
      this.pipelineRun.durationMs = 0;
      this.emit('pipeline.run.failed', {
        runId: this.runId,
        error: this.pipelineRun.error,
        at,
      });
      return this.pipelineRun;
    }

    // §17.6 — manual retry. The caller can pass `_resumeFromStep: <nodeId>`
    // in the triggerPayload; when set we (a) skip every upstream node from
    // trigger to the resume node, (b) emit `pipeline.run.resumeFromStep` so
    // observability surfaces the retry, and (c) seed traversal at the
    // resume node only. The marker is stripped from the persisted run's
    // `context` so it doesn't leak into downstream step inputs.
    const resumeRaw = this.triggerPayload._resumeFromStep;
    const resumeNodeId =
      typeof resumeRaw === 'string' && this.nodesById.has(resumeRaw)
        ? resumeRaw
        : null;

    this.emit('pipeline.run.started', {
      runId: this.runId,
      pipelineId: this.definition.id,
      triggeredBy: this.pipelineRun.triggeredBy,
      at: this.pipelineRun.startedAt,
    });

    // Seed context with the trigger payload and the step-keyed output slot
    // mandated by §17.8. Strip `_resumeFromStep` so the persisted run's
    // context never carries the internal marker.
    const seededContext: Record<string, unknown> = {
      ...this.triggerPayload,
      steps: {},
    };
    delete seededContext._resumeFromStep;
    this.pipelineRun.context = seededContext;

    const runComplete = new Promise<PipelineRun>((resolve) => {
      this.runPromiseResolve = resolve;
    });

    // When resuming, emit upstream skips + the resumeFromStep marker BEFORE
    // any step.started fires — observability (and the contract test) relies
    // on this ordering.
    if (resumeNodeId) {
      this.emitResumeSkips(trigger.id, resumeNodeId);
      this.emit('pipeline.run.resumeFromStep', {
        runId: this.runId,
        fromNodeId: resumeNodeId,
        at: nowISO(),
      });
    }

    const startNodeId = resumeNodeId ?? trigger.id;
    this.executeFromNode(startNodeId, this.pipelineRun.context)
      .then(() => {
        if (this.cancelled || this.pipelineRun.status !== 'running') return;
        const at = nowISO();
        this.pipelineRun.status = 'completed';
        this.pipelineRun.completedAt = at;
        this.pipelineRun.durationMs =
          Date.parse(at) - Date.parse(this.pipelineRun.startedAt);
        this.emit('pipeline.run.completed', {
          runId: this.runId,
          durationMs: this.pipelineRun.durationMs,
          at,
        });
      })
      .catch((err: unknown) => {
        if (this.cancelled || this.pipelineRun.status !== 'running') return;
        const message = err instanceof Error ? err.message : String(err);
        const nodeId = err instanceof BranchFailure ? err.nodeId : '(unknown)';
        const at = nowISO();
        this.pipelineRun.status = 'failed';
        this.pipelineRun.error = { nodeId, message };
        this.pipelineRun.completedAt = at;
        this.pipelineRun.durationMs =
          Date.parse(at) - Date.parse(this.pipelineRun.startedAt);
        this.emit('pipeline.run.failed', {
          runId: this.runId,
          error: this.pipelineRun.error,
          at,
        });
      })
      .finally(() => {
        this.runPromiseResolve?.(this.pipelineRun);
      });

    return runComplete;
  }

  cancel(): void {
    if (this.cancelled || !this.running) return;
    this.cancelled = true;

    // Snapshot frontier before status mutations so the step.cancelled events
    // carry the set of actually-in-flight stepIds.
    const inFlight = Array.from(this.currentStepIds);

    for (const t of this.activeTimers) clearTimeout(t);
    this.activeTimers.clear();

    // Cancel hooks unblock: sleeps resolve early, token streams break, and
    // approval waits reject. Each dispatch site is responsible for returning
    // a 'cancelled' outcome once it's unblocked.
    for (const hook of this.cancelHooks) hook();
    this.cancelHooks.clear();

    const at = nowISO();
    for (const stepId of inFlight) {
      const step = this.pipelineRun.steps[stepId];
      if (step && (step.status === 'running' || step.status === 'awaiting')) {
        step.status = 'cancelled' satisfies StepStatus;
        step.completedAt = at;
        if (step.startedAt) step.durationMs = Date.parse(at) - Date.parse(step.startedAt);
      }
      this.emit('pipeline.step.cancelled', { runId: this.runId, stepId, at });
    }

    // Every node we never reached is reported as skipped per §17.4.
    for (const node of this.definition.nodes) {
      if (!this.pipelineRun.steps[node.id]) {
        this.pipelineRun.steps[node.id] = {
          nodeId: node.id,
          status: 'skipped',
          startedAt: at,
          completedAt: at,
          durationMs: 0,
        };
        this.emit('pipeline.step.skipped', {
          runId: this.runId,
          stepId: node.id,
          reason: 'run_cancelled',
          at,
        });
      }
    }

    this.pipelineRun.status = 'cancelled';
    this.pipelineRun.completedAt = at;
    this.pipelineRun.durationMs =
      Date.parse(at) - Date.parse(this.pipelineRun.startedAt);
    this.emit('pipeline.run.cancelled', { runId: this.runId, at });
    this.runPromiseResolve?.(this.pipelineRun);
  }

  resolveApproval(
    runId: string,
    stepId: string,
    userId: string,
    decision: 'approve' | 'reject',
    comment?: string,
  ): void {
    if (runId !== this.runId) return;
    const pending = this.pendingApprovals.get(stepId);
    if (!pending) return;

    const record: ApprovalRecord = { userId, decision, comment, at: nowISO() };
    pending.recorded.push(record);

    const step = this.pipelineRun.steps[stepId];
    if (step) step.approvals = [...(step.approvals ?? []), record];

    this.emit('pipeline.approval.recorded', {
      runId,
      stepId,
      userId,
      decision,
      at: record.at,
    });

    if (decision === 'reject') {
      if (pending.timer) clearTimeout(pending.timer);
      this.pendingApprovals.delete(stepId);
      pending.resolve('reject');
      return;
    }

    const approveCount = pending.recorded.filter((r) => r.decision === 'approve').length;
    if (approveCount >= pending.requiredCount) {
      if (pending.timer) clearTimeout(pending.timer);
      this.pendingApprovals.delete(stepId);
      pending.resolve('approve');
    }
  }

  getPendingApprovals(): Array<{ runId: string; stepId: string; approvers: Approver[] }> {
    return Array.from(this.pendingApprovals.values()).map((p) => ({
      runId: p.runId,
      stepId: p.stepId,
      approvers: p.approvers,
    }));
  }

  // -------------------------------------------------------------------------
  // Traversal — one coroutine per active branch. Fork spawns, Join awaits.
  // -------------------------------------------------------------------------

  private async executeFromNode(
    nodeId: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    if (this.cancelled) return;

    const node = this.nodesById.get(nodeId);
    if (!node) return;

    const outcome = await this.executeNode(node, context);

    if (this.cancelled || outcome.status === 'cancelled') return;

    if (outcome.status === 'failed') {
      const errorEdges = (this.outgoingBySource.get(nodeId) ?? []).filter(
        (e) => e.sourceHandle === 'error',
      );
      if (errorEdges.length === 0) {
        throw new BranchFailure(nodeId, outcome.error ?? 'step failed');
      }
      await Promise.all(errorEdges.map((e) => this.routeInto(e, context)));
      return;
    }

    const outgoing = this.outgoingBySource.get(nodeId) ?? [];

    // Fork fans out to every non-error edge simultaneously. All other nodes
    // follow only the edges whose sourceHandle matches the chosen output.
    if (node.data.type === 'fork') {
      const branchEdges = outgoing.filter((e) => e.sourceHandle !== 'error');
      if (branchEdges.length === 0) return;

      // §17.1–17.2: a failed fork branch should NOT kill the whole run. It
      // should deliver a `failed` JoinArrival to the nearest downstream Join
      // and let the Join's mode decide. If no Join is on the branch path,
      // the branch silently dies (we already emitted step.failed on the
      // failing node itself).
      const branchResults = await Promise.all(
        branchEdges.map((edge) =>
          this.routeInto(edge, context).then(
            () => ({ edge, failure: null as BranchFailure | null }),
            (err: unknown) => ({
              edge,
              failure: err instanceof BranchFailure ? err : null,
              rethrow: err instanceof BranchFailure ? null : err,
            }),
          ),
        ),
      );

      const unhandled: unknown[] = [];
      for (const result of branchResults) {
        const withRethrow = result as { edge: PipelineEdge; failure: BranchFailure | null; rethrow?: unknown };
        if (withRethrow.rethrow) {
          unhandled.push(withRethrow.rethrow);
          continue;
        }
        if (!result.failure) continue;
        // Walk downstream from the branch edge's target to find a Join. If we
        // hit one, record a `failed` JoinArrival keyed on the edge entering it.
        // Seed with the fork→branch-target edge so that if the branch target
        // IS the Join, we key the arrival by that edge directly.
        const joinHit = this.findDownstreamJoin(result.edge.target, result.edge);
        if (joinHit) {
          await this.deliverFailedJoinArrival(joinHit.joinNode, joinHit.incomingEdge, context, result.failure);
        }
        // else: branch dies silently — step.failed for the failing node was
        // already emitted; the run continues.
      }
      if (unhandled.length > 0) throw unhandled[0];
      return;
    }

    const handle = outcome.sourceHandle ?? 'out';
    const nextEdges = outgoing.filter((e) => e.sourceHandle === handle);

    if (nextEdges.length === 0) return;

    await Promise.all(nextEdges.map((e) => this.routeInto(e, context)));
  }

  /**
   * §17.6 manual-retry helper. Walks forward from `triggerNodeId` via outgoing
   * edges and emits `pipeline.step.skipped` (`reason: 'resumed_forward'`) for
   * every node visited along the way EXCEPT the resume node itself. Visited
   * nodes are also recorded as `skipped` in `pipelineRun.steps` so the run's
   * persisted shape matches the events it emits. Expansion stops at the resume
   * node (we don't traverse past it — that's where forward execution will pick
   * up). The trigger node itself is also skipped: a resumed run never re-runs
   * the trigger.
   */
  private emitResumeSkips(triggerNodeId: string, resumeNodeId: string): void {
    if (triggerNodeId === resumeNodeId) return;
    const at = nowISO();
    const visited = new Set<string>();
    const queue: string[] = [triggerNodeId];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      if (nodeId === resumeNodeId) continue; // don't skip the resume node itself
      // Persist the skip on the run so the post-run shape is consistent with
      // the cancellation path's behavior in `cancel()`.
      this.pipelineRun.steps[nodeId] = {
        nodeId,
        status: 'skipped',
        startedAt: at,
        completedAt: at,
        durationMs: 0,
      };
      this.emit('pipeline.step.skipped', {
        runId: this.runId,
        stepId: nodeId,
        reason: 'resumed_forward',
        at,
      });
      // Don't expand past the resume node — its branch is where forward
      // execution will start, so anything past it is "future work", not skipped.
      const outgoing = this.outgoingBySource.get(nodeId) ?? [];
      for (const edge of outgoing) {
        if (edge.target === resumeNodeId) {
          // Mark resume node visited so we don't try to skip it later, but
          // don't enqueue past it.
          visited.add(resumeNodeId);
          continue;
        }
        if (!visited.has(edge.target)) queue.push(edge.target);
      }
    }
  }

  /**
   * Simple BFS from `startNodeId` following any outgoing edge until the first
   * Join is encountered. Returns the Join node and the incoming edge that
   * reaches it so the caller can key a `JoinArrival` by that edge. Returns
   * null if no Join is reachable.
   */
  private findDownstreamJoin(
    startNodeId: string,
    initialVia: PipelineEdge | null = null,
  ): { joinNode: PipelineNode; incomingEdge: PipelineEdge } | null {
    const visited = new Set<string>();
    // Queue carries (currentNodeId, edgeByWhichWeEnteredCurrent).
    const queue: Array<{ nodeId: string; via: PipelineEdge | null }> = [
      { nodeId: startNodeId, via: initialVia },
    ];

    while (queue.length > 0) {
      const { nodeId, via } = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.nodesById.get(nodeId);
      if (!node) continue;

      if (node.data.type === 'join') {
        // `via` is the edge that reached this Join — keyed arrival slot.
        if (via) return { joinNode: node, incomingEdge: via };
        return null;
      }

      const outgoing = this.outgoingBySource.get(nodeId) ?? [];
      for (const edge of outgoing) {
        if (!visited.has(edge.target)) {
          queue.push({ nodeId: edge.target, via: edge });
        }
      }
    }
    return null;
  }

  private async deliverFailedJoinArrival(
    joinNode: PipelineNode,
    incomingEdge: PipelineEdge,
    context: Record<string, unknown>,
    failure: BranchFailure,
  ): Promise<void> {
    if (joinNode.data.type !== 'join') return;
    await this.handleJoinArrival(joinNode, incomingEdge, context, {
      status: 'failed',
      sourceStepId: failure.nodeId,
    });
  }

  private async routeInto(edge: PipelineEdge, context: Record<string, unknown>): Promise<void> {
    const target = this.nodesById.get(edge.target);
    if (!target) return;

    if (target.data.type === 'join') {
      await this.handleJoinArrival(target, edge, context);
      return;
    }

    await this.executeFromNode(edge.target, context);
  }

  // -------------------------------------------------------------------------
  // Single-node dispatch
  // -------------------------------------------------------------------------

  private async executeNode(
    node: PipelineNode,
    context: Record<string, unknown>,
  ): Promise<StepOutcome> {
    // Chaos: if the observability panel has set `paused`, poll at 100ms and
    // re-check before starting this node. Phase 1 simplification; Phase 3+
    // will use a real event/condvar on the executor.
    await this.waitWhilePaused();
    if (this.cancelled) return { status: 'cancelled' };

    const stepId = node.id;
    const startedAt = nowISO();
    const step: StepExecution = {
      nodeId: node.id,
      status: 'running',
      startedAt,
      input: this.snapshotContext(context),
    };
    this.pipelineRun.steps[stepId] = step;
    this.currentStepIds.add(stepId);
    this.pipelineRun.currentStepIds = Array.from(this.currentStepIds);
    this.emit('pipeline.step.started', {
      runId: this.runId,
      stepId,
      nodeType: node.type satisfies NodeType,
      at: startedAt,
    });

    let outcome: StepOutcome;
    try {
      outcome = await this.dispatch(node, context);
    } catch (err) {
      outcome = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }

    if (this.cancelled) {
      // cancel() has already emitted step.cancelled for this step — don't
      // double-emit a terminal.
      this.currentStepIds.delete(stepId);
      this.pipelineRun.currentStepIds = Array.from(this.currentStepIds);
      return { status: 'cancelled' };
    }

    const completedAt = nowISO();
    step.completedAt = completedAt;
    step.durationMs = Date.parse(completedAt) - Date.parse(startedAt);

    if (outcome.status === 'completed') {
      step.status = 'completed';
      step.output = outcome.output;
      this.accumulateContext(node, context, outcome.output);
      this.emit('pipeline.step.completed', {
        runId: this.runId,
        stepId,
        durationMs: step.durationMs,
        output: outcome.output,
        at: completedAt,
      });
    } else {
      step.status = 'failed';
      step.error = outcome.error;
      this.emit('pipeline.step.failed', {
        runId: this.runId,
        stepId,
        error: outcome.error ?? 'unknown error',
        at: completedAt,
      });
    }

    this.currentStepIds.delete(stepId);
    this.pipelineRun.currentStepIds = Array.from(this.currentStepIds);
    return outcome;
  }

  private async dispatch(
    node: PipelineNode,
    context: Record<string, unknown>,
  ): Promise<StepOutcome> {
    switch (node.data.type) {
      case 'trigger':
        return this.execTrigger(node.data);
      case 'llm':
        return this.execLLM(node.id, node.data);
      case 'transform':
        return this.execTransform(node.data);
      case 'condition':
        return this.execCondition(node.data, context);
      case 'action':
        return this.execAction(node.data);
      case 'fork':
        return this.execFork(node.data);
      case 'join':
        // Join gating runs in `handleJoinArrival`; direct dispatch is a no-op.
        return { status: 'completed', output: {} };
      case 'approval':
        return this.execApproval(node.id, node.data);
    }
  }

  // -------------------------------------------------------------------------
  // Per-node implementations
  // -------------------------------------------------------------------------

  private async execTrigger(_data: TriggerNodeData): Promise<StepOutcome> {
    await this.sleep(sampleNormal(10, 5));
    return { status: 'completed', output: this.triggerPayload, sourceHandle: 'out' };
  }

  private async execLLM(stepId: string, data: LLMNodeData): Promise<StepOutcome> {
    // Fail-fast roll: we don't stream tokens into a response that never
    // lands. Per §8.3, LLM failures route to the error handle.
    if (Math.random() < this.failureRateLLM + getChaosState().injectedFailureRate) {
      await this.sleep(sampleNormal(200, 100));
      return {
        status: 'failed',
        error: 'LLM provider error (simulated)',
        sourceHandle: 'error',
      };
    }

    const prompt = data.userPromptTemplate;
    const fixture = pickFixture(data.systemPrompt, data.userPromptTemplate);
    const response = fixture.response;

    this.emit('pipeline.llm.prompt', {
      runId: this.runId,
      stepId,
      model: data.model,
      prompt,
      at: nowISO(),
    });

    const tokens = tokenize(response);
    // Prefer the fixture's latency profile so summary prompts stream fast and
    // long-form docs take longer. Falls back to the node-type default.
    const latency = fixture.latencyProfileMs ?? { mean: 3500, stdev: 1500 };
    const totalMs = sampleNormal(latency.mean, latency.stdev);
    // Per-token interval at ~40 tok/s with ±15/s jitter per §8.3.
    const perToken = Math.max(8, 1000 / sampleNormal(40, 15));

    let streamCancelled = false;
    const cancelStream = () => {
      streamCancelled = true;
    };
    this.cancelHooks.add(cancelStream);

    const streamStart = Date.now();
    for (const token of tokens) {
      if (streamCancelled || this.cancelled) break;
      if (Date.now() - streamStart >= totalMs) break;
      await this.sleep(perToken);
      if (streamCancelled || this.cancelled) break;
      this.emit('pipeline.llm.token', {
        runId: this.runId,
        stepId,
        token,
        at: nowISO(),
      });
    }
    this.cancelHooks.delete(cancelStream);
    if (this.cancelled) return { status: 'cancelled' };

    const tokensIn = Math.max(1, Math.round(prompt.length / 4));
    const tokensOut = tokens.length;
    this.emit('pipeline.llm.response', {
      runId: this.runId,
      stepId,
      response,
      tokensIn,
      tokensOut,
      at: nowISO(),
    });

    const step = this.pipelineRun.steps[stepId];
    if (step) step.llm = { prompt, response, tokensIn, tokensOut };

    return {
      status: 'completed',
      output: { response, tokensIn, tokensOut },
      sourceHandle: 'out',
    };
  }

  private async execTransform(_data: TransformNodeData): Promise<StepOutcome> {
    await this.sleep(sampleNormal(120, 60));
    if (Math.random() < this.failureRateOther + getChaosState().injectedFailureRate) {
      return {
        status: 'failed',
        error: 'Transform error (simulated)',
        sourceHandle: 'error',
      };
    }
    return { status: 'completed', output: { transformed: true }, sourceHandle: 'out' };
  }

  private async execCondition(
    data: ConditionNodeData,
    context: Record<string, unknown>,
  ): Promise<StepOutcome> {
    await this.sleep(sampleNormal(30, 15));
    const result = evaluateCondition(data.expression, context);
    return {
      status: 'completed',
      output: { result },
      sourceHandle: result ? 'true' : 'false',
    };
  }

  private async execAction(data: ActionNodeData): Promise<StepOutcome> {
    await this.sleep(sampleNormal(900, 400));
    if (Math.random() < this.failureRateOther + getChaosState().injectedFailureRate) {
      // 'fail-run' bypasses the error handle so the failure escapes the
      // branch; 'route-error' (default) falls through to the handle wiring.
      const handle = data.onError === 'fail-run' ? undefined : 'error';
      return {
        status: 'failed',
        error: `Action ${data.actionType} failed (simulated)`,
        sourceHandle: handle,
      };
    }
    return {
      status: 'completed',
      output: { actionType: data.actionType, ok: true },
      sourceHandle: 'out',
    };
  }

  private async execFork(_data: ForkNodeData): Promise<StepOutcome> {
    await this.sleep(sampleNormal(10, 5));
    return { status: 'completed', output: {}, sourceHandle: 'out' };
  }

  private async execApproval(stepId: string, data: ApprovalNodeData): Promise<StepOutcome> {
    await this.sleep(sampleNormal(10, 5));
    const at = nowISO();
    this.emit('pipeline.approval.requested', {
      runId: this.runId,
      stepId,
      approvers: data.approvers,
      at,
    });
    const step = this.pipelineRun.steps[stepId];
    if (step) step.status = 'awaiting';

    const decision = await new Promise<'approve' | 'reject'>((resolve) => {
      const pending: PendingApproval = {
        runId: this.runId,
        stepId,
        approvers: data.approvers,
        requiredCount: Math.max(1, data.requiredCount),
        recorded: [],
        resolve,
      };

      // §17.3: `escalate` is deferred to Phase 5 — treat as reject so runs
      // still progress during demos.
      if (data.timeoutMs != null) {
        const timeoutAction = data.timeoutAction ?? 'reject';
        pending.timer = this.createTimer(data.timeoutMs, () => {
          if (!this.pendingApprovals.has(stepId)) return;
          const auto: ApprovalRecord = {
            userId: 'system:timeout',
            decision: timeoutAction === 'approve' ? 'approve' : 'reject',
            at: nowISO(),
          };
          pending.recorded.push(auto);
          const persistedStep = this.pipelineRun.steps[stepId];
          if (persistedStep) {
            persistedStep.approvals = [...(persistedStep.approvals ?? []), auto];
          }
          this.emit('pipeline.approval.recorded', {
            runId: this.runId,
            stepId,
            userId: auto.userId,
            decision: auto.decision,
            at: auto.at,
          });
          this.pendingApprovals.delete(stepId);
          resolve(auto.decision);
        });
      }

      this.pendingApprovals.set(stepId, pending);

      // If cancel() fires while we're blocked, unblock with reject so the
      // branch unwinds. cancel() itself emits step.cancelled.
      const onCancel = () => {
        this.pendingApprovals.delete(stepId);
        if (pending.timer) clearTimeout(pending.timer);
        resolve('reject');
      };
      this.cancelHooks.add(onCancel);
    });

    return {
      status: 'completed',
      output: { decision },
      sourceHandle: decision === 'approve' ? 'approved' : 'rejected',
    };
  }

  // -------------------------------------------------------------------------
  // Join — arrival accumulation with mode-aware firing (§17.2)
  // -------------------------------------------------------------------------

  private async handleJoinArrival(
    joinNode: PipelineNode,
    edge: PipelineEdge,
    context: Record<string, unknown>,
    override?: { status: 'completed' | 'failed' | 'cancelled'; sourceStepId?: string },
  ): Promise<void> {
    if (joinNode.data.type !== 'join') return;
    const data = joinNode.data;
    const stepId = joinNode.id;

    // Late arrival at a Join that already fired — silently drop so `any` /
    // `n_of_m` modes emit exactly one join.fired event (per §17.2).
    if (this.firedJoins.has(stepId)) return;

    // Emit step.started on first arrival so the Join has exactly one lifecycle
    // regardless of how many incoming edges fire.
    let state = this.joinStates.get(stepId);
    let firstArrival = false;
    if (!state) {
      state = { arrivals: [] };
      this.joinStates.set(stepId, state);
      firstArrival = true;
      const startedAt = nowISO();
      this.pipelineRun.steps[stepId] = {
        nodeId: stepId,
        status: 'running',
        startedAt,
      };
      this.currentStepIds.add(stepId);
      this.pipelineRun.currentStepIds = Array.from(this.currentStepIds);
      this.emit('pipeline.step.started', {
        runId: this.runId,
        stepId,
        nodeType: 'join',
        at: startedAt,
      });
    }

    const arrivalStatus = override?.status ?? 'completed';
    state.arrivals.push({
      edgeId: edge.id,
      status: arrivalStatus,
      // Failed arrivals shouldn't pollute the merged context.
      context: arrivalStatus === 'completed' ? this.snapshotContext(context) : undefined,
      sourceStepId: override?.sourceStepId ?? edge.source,
    });

    const connectedCount = this.incomingByTarget.get(joinNode.id)?.length ?? 0;
    const required = this.requiredInputsFor(joinNode, data);
    this.emit('pipeline.join.waiting', {
      runId: this.runId,
      stepId,
      received: state.arrivals.length,
      required,
      at: nowISO(),
    });

    // Only the firing arrival proceeds past this point. Other arrivals at a
    // Join that has already fired are observability-only (already emitted
    // join.waiting above).
    if (!this.shouldJoinFire(data, state.arrivals, connectedCount)) return;
    if (!firstArrival && !this.joinStates.has(stepId)) return;

    // Mark fired *before* awaiting fireJoin so concurrent arrivals that reach
    // the dispatcher during fireJoin's internal await are early-returned at
    // the top of this method. Without this guard, `any` / `n_of_m` joins can
    // emit pipeline.join.fired multiple times under parallel fork branches.
    this.firedJoins.add(stepId);

    await this.fireJoin(joinNode, state, context);
  }

  private requiredInputsFor(joinNode: PipelineNode, data: JoinNodeData): number {
    const incoming = this.incomingByTarget.get(joinNode.id)?.length ?? 0;
    if (data.mode === 'all') return incoming;
    if (data.mode === 'any') return 1;
    return Math.min(data.n ?? incoming, incoming);
  }

  /**
   * Firing predicate, §17.2-aware for failed arrivals:
   *  - `all`: fire once every connected incoming edge has reported (any status).
   *           Join then emits completed or failed based on whether any failed.
   *  - `any`: fire on the first `completed` arrival. If every connected branch
   *          has reported and all are `failed`, fire so the Join can surface
   *          the failure.
   *  - `n_of_m`: fire when `completed` count reaches N. Fail fast when it
   *             becomes arithmetically impossible: (connected - arrivals) +
   *             completed < n.
   */
  private shouldJoinFire(
    data: JoinNodeData,
    arrivals: JoinArrival[],
    connectedCount: number,
  ): boolean {
    const completed = arrivals.filter((a) => a.status === 'completed').length;
    const failed = arrivals.filter((a) => a.status === 'failed').length;
    const seen = arrivals.length;

    if (data.mode === 'all') {
      return seen >= connectedCount;
    }
    if (data.mode === 'any') {
      if (completed >= 1) return true;
      // Every connected branch has reported failure — nothing will ever come
      // in as `completed`, so fire with a failed result.
      if (connectedCount > 0 && failed >= connectedCount) return true;
      return false;
    }
    // n_of_m
    const n = Math.min(data.n ?? connectedCount, connectedCount);
    if (completed >= n) return true;
    const remaining = Math.max(0, connectedCount - seen);
    if (completed + remaining < n) return true; // fail-fast — N unreachable
    return false;
  }

  private async fireJoin(
    joinNode: PipelineNode,
    state: JoinState,
    lastContext: Record<string, unknown>,
  ): Promise<void> {
    const stepId = joinNode.id;
    if (joinNode.data.type !== 'join') return;
    const data = joinNode.data;

    await this.sleep(sampleNormal(10, 5));

    const inputs = state.arrivals.map((a) => a.sourceStepId);
    const completedCount = state.arrivals.filter((a) => a.status === 'completed').length;
    const hasFailed = state.arrivals.some((a) => a.status === 'failed');
    const connectedCount = this.incomingByTarget.get(stepId)?.length ?? 0;

    // Per-mode fail decision (§17.2):
    //  - all: fail if any arrival failed
    //  - any: fail only if we fired with zero completed (i.e. all failed)
    //  - n_of_m: fail if we couldn't collect N completions
    let joinFailed = false;
    let failReason = '';
    if (data.mode === 'all') {
      joinFailed = hasFailed;
      failReason = 'one or more upstream branches failed';
    } else if (data.mode === 'any') {
      joinFailed = completedCount === 0;
      failReason = 'all upstream branches failed';
    } else {
      // n_of_m
      const n = Math.min(data.n ?? connectedCount, connectedCount);
      joinFailed = completedCount < n;
      failReason = `only ${completedCount} of required ${n} upstream branches completed`;
    }

    const at = nowISO();
    const step = this.pipelineRun.steps[stepId];
    if (step) {
      step.completedAt = at;
      if (step.startedAt) step.durationMs = Date.parse(at) - Date.parse(step.startedAt);
    }

    this.emit('pipeline.join.fired', { runId: this.runId, stepId, inputs, at });
    this.currentStepIds.delete(stepId);
    this.pipelineRun.currentStepIds = Array.from(this.currentStepIds);
    // Mark fired and clear state so late arrivals are dropped by the early
    // return in handleJoinArrival (per §17.2 — sibling branches ignored).
    this.firedJoins.add(stepId);
    this.joinStates.delete(stepId);

    if (joinFailed) {
      if (step) {
        step.status = 'failed';
        step.error = failReason;
      }
      this.emit('pipeline.step.failed', {
        runId: this.runId,
        stepId,
        error: failReason,
        at,
      });
      const errorEdges = (this.outgoingBySource.get(stepId) ?? []).filter(
        (e) => e.sourceHandle === 'error',
      );
      if (errorEdges.length === 0) {
        throw new BranchFailure(stepId, failReason);
      }
      await Promise.all(errorEdges.map((e) => this.routeInto(e, lastContext)));
      return;
    }

    // Merge only the successful arrivals' contexts.
    const merged = this.mergeJoinContexts(
      data,
      state.arrivals.filter((a) => a.status === 'completed'),
    );
    if (step) {
      step.status = 'completed';
      step.output = merged;
    }
    Object.assign(lastContext, merged);
    this.emit('pipeline.step.completed', {
      runId: this.runId,
      stepId,
      durationMs: step?.durationMs ?? 0,
      output: merged,
      at,
    });

    const outgoing = (this.outgoingBySource.get(stepId) ?? []).filter(
      (e) => e.sourceHandle === 'out' || e.sourceHandle === undefined,
    );
    await Promise.all(outgoing.map((e) => this.routeInto(e, lastContext)));
  }

  private mergeJoinContexts(
    data: JoinNodeData,
    arrivals: JoinArrival[],
  ): Record<string, unknown> {
    const ctxs = arrivals.map((a) => a.context ?? {});
    if (data.mergeStrategy === 'array-collect') {
      return { joined: ctxs };
    }
    if (data.mergeStrategy === 'last-writer-wins') {
      return ctxs.reduce<Record<string, unknown>>((acc, c) => ({ ...acc, ...c }), {});
    }
    return ctxs.reduce<Record<string, unknown>>((acc, c) => deepMerge(acc, c), {});
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private initRun(): PipelineRun {
    return {
      id: this.runId,
      pipelineId: this.definition.id,
      pipelineVersion: this.definition.publishedVersion ?? this.definition.version,
      status: 'running',
      triggeredBy: {
        triggerType: this.definition.triggerBinding?.event ?? 'manual',
        payload: this.triggerPayload,
      },
      ownerNodeId: 'mock-executor',
      startedAt: nowISO(),
      currentStepIds: [],
      steps: {},
      context: {},
    };
  }

  private findTrigger(): PipelineNode | undefined {
    return this.definition.nodes.find((n) => n.data.type === 'trigger');
  }

  private accumulateContext(
    node: PipelineNode,
    context: Record<string, unknown>,
    output: unknown,
  ): void {
    // §17.8: stable step-keyed slot plus either scoped merge (outputKey) or
    // a top-level merge for object outputs.
    const steps = (context.steps as Record<string, unknown>) ?? {};
    steps[node.id] = output;
    context.steps = steps;

    let outputKey: string | undefined;
    if (node.data.type === 'transform') outputKey = node.data.outputKey;

    if (outputKey) {
      context[outputKey] = output;
    } else if (output && typeof output === 'object' && !Array.isArray(output)) {
      Object.assign(context, output as Record<string, unknown>);
    }
  }

  private snapshotContext(context: Record<string, unknown>): Record<string, unknown> {
    return { ...context };
  }

  private emit<K extends keyof PipelineEventMap>(type: K, payload: PipelineEventMap[K]): void {
    this.onEvent(type, payload);
  }

  private sleep(durationMs: number): Promise<void> {
    // Chaos: add any injected latency to the scaled base duration.
    const injected = Math.max(0, getChaosState().injectedLatencyMs);
    const scaled = Math.max(50, durationMs) * this.speedMultiplier + injected;
    return new Promise((resolve) => {
      const timer = this.createTimer(scaled, () => {
        this.cancelHooks.delete(onCancel);
        resolve();
      });
      const onCancel = () => {
        clearTimeout(timer);
        this.activeTimers.delete(timer);
        resolve();
      };
      this.cancelHooks.add(onCancel);
    });
  }

  /**
   * Chaos pause gate — polled at the start of each node dispatch. Resolves
   * immediately when `paused` is false; otherwise sleeps 100ms and re-checks.
   * Cancellation (via `cancel()`) also unblocks the gate so the run can
   * unwind.
   */
  private async waitWhilePaused(): Promise<void> {
    while (!this.cancelled && getChaosState().paused) {
      await new Promise<void>((resolve) => {
        const timer = this.createTimer(100, () => {
          this.cancelHooks.delete(onCancel);
          resolve();
        });
        const onCancel = () => {
          clearTimeout(timer);
          this.activeTimers.delete(timer);
          resolve();
        };
        this.cancelHooks.add(onCancel);
      });
    }
  }

  private createTimer(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.activeTimers.delete(timer);
      fn();
    }, ms);
    this.activeTimers.add(timer);
    return timer;
  }
}

// ---------------------------------------------------------------------------
// Error type — distinguishes a branch failure (run.catch handles it) from
// a genuine bug in dispatch code.
// ---------------------------------------------------------------------------

class BranchFailure extends Error {
  readonly nodeId: string;
  constructor(nodeId: string, message: string) {
    super(message);
    this.nodeId = nodeId;
    this.name = 'BranchFailure';
  }
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function nowISO(): string {
  return new Date().toISOString();
}

// Box-Muller normal sampling, clamped per §8.2 (≥ 50ms).
function sampleNormal(mean: number, stdev: number): number {
  const u1 = Math.random() || Number.EPSILON;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(50, mean + z * stdev);
}

function evaluateCondition(expression: string, context: Record<string, unknown>): boolean {
  // §8.4 — narrow safe subset: `context.<path> === <literal>`.
  const match = expression.match(
    /^\s*context\.([a-zA-Z0-9_.]+)\s*===\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)|(true|false))\s*$/,
  );
  if (match) {
    const path = match[1]!;
    let expected: unknown;
    if (match[2] !== undefined) expected = match[2];
    else if (match[3] !== undefined) expected = match[3];
    else if (match[4] !== undefined) expected = Number(match[4]);
    else expected = match[5] === 'true';
    return readPath(context, path) === expected;
  }
  // Fallback: 60/40 toward true per §8.4.
  return Math.random() < 0.6;
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function tokenize(response: string): string[] {
  // Word-ish boundaries with trailing whitespace preserved — lets the UI
  // concatenate tokens without adding its own spacing.
  return response.match(/\S+\s*|\s+/g) ?? [response];
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    if (
      prev &&
      typeof prev === 'object' &&
      !Array.isArray(prev) &&
      v &&
      typeof v === 'object' &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
