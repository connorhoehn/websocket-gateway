// frontend/src/components/pipelines/validation/validatePipeline.ts
//
// Pure validation of a PipelineDefinition per PIPELINES_PLAN.md §16. Errors
// block publish (and therefore run); warnings are visual indicators only.
// No side effects, no React — callable from hooks or tests.

import type {
  ApprovalNodeData,
  ActionNodeData,
  ConditionNodeData,
  ForkNodeData,
  JoinNodeData,
  LLMNodeData,
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  TransformNodeData,
  ValidationIssue,
  ValidationResult,
} from '../../../types/pipeline';
import { detectCycles } from './detectCycles';
import { isValidHandleConnection } from './handleCompatibility';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validates a pipeline definition; errors block publish, warnings are advisory. */
export function validatePipeline(def: PipelineDefinition): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const { nodes, edges } = def;
  const nodeById = new Map<string, PipelineNode>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
  }

  // --- Errors ------------------------------------------------------------
  checkTriggerCount(nodes, errors);
  checkCycles(nodes, edges, errors);
  checkEdgeHandles(edges, nodeById, errors);
  checkNodeConfigs(nodes, errors);
  checkJoinInputs(nodes, edges, errors);

  // --- Warnings ----------------------------------------------------------
  checkOrphans(nodes, edges, warnings);
  checkDeadEnds(nodes, edges, warnings);
  checkUnusedForkBranches(nodes, edges, warnings);
  checkUnusedConditionBranches(nodes, edges, warnings);

  // --- Advisory lints (design-quality, non-blocking) ---------------------
  warnings.push(...lintNoErrorHandler(def));
  warnings.push(...lintLLMNoMaxTokens(def));
  warnings.push(...lintUnguardedApprovalTimeout(def));
  warnings.push(...lintLargeFork(def));
  warnings.push(...lintDeepChain(def));
  warnings.push(...lintDuplicateNodeName(def));
  warnings.push(...lintLowTemperatureNonDeterministicPrompt(def));
  warnings.push(...lintScheduledDraft(def));
  warnings.push(...lintUnreachableAfterConditionFalse(def));
  warnings.push(...lintForkWithoutMatchingJoin(def));

  return {
    errors,
    warnings,
    isValid: errors.length === 0,
    canPublish: errors.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Error checks
// ---------------------------------------------------------------------------

function checkTriggerCount(nodes: PipelineNode[], errors: ValidationIssue[]): void {
  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) {
    errors.push({
      code: 'NO_TRIGGER',
      severity: 'error',
      message: 'Pipeline must have exactly one Trigger node.',
    });
    return;
  }
  if (triggers.length > 1) {
    for (const trigger of triggers) {
      errors.push({
        code: 'MULTIPLE_TRIGGERS',
        severity: 'error',
        message: 'Pipeline must have exactly one Trigger node.',
        nodeId: trigger.id,
      });
    }
  }
}

function checkCycles(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  errors: ValidationIssue[],
): void {
  const cycleEdgeId = detectCycles(nodes, edges);
  if (cycleEdgeId !== null) {
    errors.push({
      code: 'CYCLE_DETECTED',
      severity: 'error',
      message: 'Pipeline contains a cycle.',
      edgeId: cycleEdgeId,
    });
  }
}

function checkEdgeHandles(
  edges: PipelineEdge[],
  nodeById: Map<string, PipelineNode>,
  errors: ValidationIssue[],
): void {
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      errors.push({
        code: 'INVALID_HANDLE',
        severity: 'error',
        message: 'Edge references a node that does not exist.',
        edgeId: edge.id,
      });
      continue;
    }
    const ok = isValidHandleConnection(
      source.type,
      edge.sourceHandle,
      target.type,
      edge.targetHandle,
    );
    if (!ok) {
      errors.push({
        code: 'INVALID_HANDLE',
        severity: 'error',
        message: `Invalid connection: ${source.type}.${edge.sourceHandle} → ${target.type}.${edge.targetHandle}.`,
        edgeId: edge.id,
      });
    }
  }
}

function checkNodeConfigs(nodes: PipelineNode[], errors: ValidationIssue[]): void {
  for (const node of nodes) {
    switch (node.data.type) {
      case 'llm':
        checkLLM(node.id, node.data, errors);
        break;
      case 'transform':
        checkTransform(node.id, node.data, errors);
        break;
      case 'condition':
        checkCondition(node.id, node.data, errors);
        break;
      case 'action':
        checkAction(node.id, node.data, errors);
        break;
      case 'fork':
        checkFork(node.id, node.data, errors);
        break;
      case 'join':
        checkJoin(node.id, node.data, errors);
        break;
      case 'approval':
        checkApproval(node.id, node.data, errors);
        break;
      case 'trigger':
        // Trigger-specific config checks are handled elsewhere (trigger binding).
        break;
    }
  }
}

function checkLLM(nodeId: string, data: LLMNodeData, errors: ValidationIssue[]): void {
  if (!data.provider) missingConfig(errors, nodeId, 'provider');
  if (!data.model || !data.model.trim()) missingConfig(errors, nodeId, 'model');
  if (!data.systemPrompt || !data.systemPrompt.trim()) {
    missingConfig(errors, nodeId, 'systemPrompt');
  }
  if (!data.userPromptTemplate || !data.userPromptTemplate.trim()) {
    missingConfig(errors, nodeId, 'userPromptTemplate');
  }
}

function checkTransform(
  nodeId: string,
  data: TransformNodeData,
  errors: ValidationIssue[],
): void {
  if (!data.transformType) missingConfig(errors, nodeId, 'transformType');
  if (!data.expression || !data.expression.trim()) {
    missingConfig(errors, nodeId, 'expression');
  }
}

function checkCondition(
  nodeId: string,
  data: ConditionNodeData,
  errors: ValidationIssue[],
): void {
  if (!data.expression || !data.expression.trim()) {
    missingConfig(errors, nodeId, 'expression');
  }
}

function checkAction(
  nodeId: string,
  data: ActionNodeData,
  errors: ValidationIssue[],
): void {
  if (!data.actionType) missingConfig(errors, nodeId, 'actionType');
}

function checkFork(nodeId: string, data: ForkNodeData, errors: ValidationIssue[]): void {
  if (typeof data.branchCount !== 'number' || data.branchCount < 2) {
    errors.push({
      code: 'MISSING_CONFIG',
      severity: 'error',
      message: 'Fork requires branchCount ≥ 2.',
      nodeId,
      field: 'branchCount',
    });
  }
}

function checkJoin(nodeId: string, data: JoinNodeData, errors: ValidationIssue[]): void {
  if (!data.mode) missingConfig(errors, nodeId, 'mode');
  if (!data.mergeStrategy) missingConfig(errors, nodeId, 'mergeStrategy');
  if (data.mode === 'n_of_m' && (typeof data.n !== 'number' || data.n < 1)) {
    errors.push({
      code: 'MISSING_CONFIG',
      severity: 'error',
      message: "Join mode 'n_of_m' requires a numeric n ≥ 1.",
      nodeId,
      field: 'n',
    });
  }
}

function checkApproval(
  nodeId: string,
  data: ApprovalNodeData,
  errors: ValidationIssue[],
): void {
  if (!data.approvers || data.approvers.length === 0) {
    errors.push({
      code: 'APPROVAL_NO_APPROVERS',
      severity: 'error',
      message: 'Approval node must have at least one approver.',
      nodeId,
      field: 'approvers',
    });
  }
  if (typeof data.requiredCount !== 'number' || data.requiredCount < 1) {
    errors.push({
      code: 'MISSING_CONFIG',
      severity: 'error',
      message: 'Approval requires requiredCount ≥ 1.',
      nodeId,
      field: 'requiredCount',
    });
  }
}

function checkJoinInputs(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  errors: ValidationIssue[],
): void {
  const incomingCount = new Map<string, number>();
  for (const edge of edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }
  for (const node of nodes) {
    if (node.type !== 'join') continue;
    const count = incomingCount.get(node.id) ?? 0;
    if (count < 2) {
      errors.push({
        code: 'JOIN_INSUFFICIENT_INPUTS',
        severity: 'error',
        message: 'Join node requires at least 2 incoming edges.',
        nodeId: node.id,
      });
    }
  }
}

function missingConfig(
  errors: ValidationIssue[],
  nodeId: string,
  field: string,
): void {
  errors.push({
    code: 'MISSING_CONFIG',
    severity: 'error',
    message: `Missing required field '${field}'.`,
    nodeId,
    field,
  });
}

// ---------------------------------------------------------------------------
// Warning checks
// ---------------------------------------------------------------------------

function checkOrphans(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  warnings: ValidationIssue[],
): void {
  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) return; // orphan check meaningless without a single trigger

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    // Both Condition branches count as reachable — either may fire at runtime.
    adjacency.get(edge.source)?.push(edge.target);
  }

  const reachable = new Set<string>();
  const queue: string[] = [triggers[0].id];
  reachable.add(triggers[0].id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      warnings.push({
        code: 'ORPHAN_NODE',
        severity: 'warning',
        message: 'Node is unreachable from the Trigger.',
        nodeId: node.id,
      });
    }
  }
}

function checkDeadEnds(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  warnings: ValidationIssue[],
): void {
  const hasOutgoing = new Set<string>();
  for (const edge of edges) hasOutgoing.add(edge.source);
  for (const node of nodes) {
    // Trigger alone with no outgoing edges is covered by other issues; still warn.
    if (!hasOutgoing.has(node.id)) {
      warnings.push({
        code: 'DEAD_END',
        severity: 'warning',
        message: 'Node has no outgoing edges.',
        nodeId: node.id,
      });
    }
  }
}

function checkUnusedForkBranches(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  warnings: ValidationIssue[],
): void {
  const usedBySource = new Map<string, Set<string>>();
  for (const edge of edges) {
    const set = usedBySource.get(edge.source) ?? new Set<string>();
    set.add(edge.sourceHandle);
    usedBySource.set(edge.source, set);
  }

  for (const node of nodes) {
    if (node.data.type !== 'fork') continue;
    const branchCount = node.data.branchCount;
    const used = usedBySource.get(node.id) ?? new Set<string>();
    for (let i = 0; i < branchCount; i += 1) {
      const handle = `branch-${i}`;
      if (!used.has(handle)) {
        warnings.push({
          code: 'UNUSED_FORK_BRANCH',
          severity: 'warning',
          message: `Fork branch '${handle}' has no connected edge.`,
          nodeId: node.id,
          field: handle,
        });
      }
    }
  }
}

function checkUnusedConditionBranches(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  warnings: ValidationIssue[],
): void {
  const usedBySource = new Map<string, Set<string>>();
  for (const edge of edges) {
    const set = usedBySource.get(edge.source) ?? new Set<string>();
    set.add(edge.sourceHandle);
    usedBySource.set(edge.source, set);
  }

  for (const node of nodes) {
    if (node.type !== 'condition') continue;
    const used = usedBySource.get(node.id) ?? new Set<string>();
    for (const handle of ['true', 'false'] as const) {
      if (!used.has(handle)) {
        warnings.push({
          code: 'UNUSED_CONDITION_BRANCH',
          severity: 'warning',
          message: `Condition branch '${handle}' has no connected edge.`,
          nodeId: node.id,
          field: handle,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Advisory design-quality lints (warnings only, non-blocking)
// ---------------------------------------------------------------------------

/**
 * Derives a human-readable display name for a node. Preference order:
 *   1. `data.label` if present (currently Condition only, but we read defensively).
 *   2. Type-specific discriminators (LLM model, Trigger triggerType, Action
 *      actionType, Transform transformType, Join mode).
 *   3. Fallback to the node `type` (e.g. 'fork', 'join').
 */
function nodeLabel(node: PipelineNode): string {
  const labelField = (node.data as { label?: unknown }).label;
  if (typeof labelField === 'string' && labelField.trim()) return labelField.trim();
  switch (node.data.type) {
    case 'llm':
      return node.data.model || 'llm';
    case 'trigger':
      return node.data.triggerType || 'trigger';
    case 'action':
      return node.data.actionType || 'action';
    case 'transform':
      return node.data.transformType || 'transform';
    case 'join':
      return node.data.mode ? `join:${node.data.mode}` : 'join';
    default:
      return node.type;
  }
}

function lintNoErrorHandler(def: PipelineDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of def.nodes) {
    if (node.data.type !== 'llm' && node.data.type !== 'action') continue;
    const hasErrorEdge = def.edges.some(
      (e) => e.source === node.id && e.sourceHandle === 'error',
    );
    if (!hasErrorEdge) {
      issues.push({
        code: 'NO_ERROR_HANDLER',
        severity: 'warning',
        message: `${node.data.type} node '${nodeLabel(node)}' has no error handler — failures will terminate the run.`,
        nodeId: node.id,
      });
    }
  }
  return issues;
}

function lintLLMNoMaxTokens(def: PipelineDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of def.nodes) {
    if (node.data.type !== 'llm') continue;
    if (typeof node.data.maxTokens !== 'number' || node.data.maxTokens <= 0) {
      issues.push({
        code: 'LLM_NO_MAX_TOKENS',
        severity: 'warning',
        message: `LLM node '${nodeLabel(node)}' has no maxTokens — responses could run long / expensive.`,
        nodeId: node.id,
        field: 'maxTokens',
      });
    }
  }
  return issues;
}

function lintUnguardedApprovalTimeout(def: PipelineDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of def.nodes) {
    if (node.data.type !== 'approval') continue;
    if (typeof node.data.timeoutMs !== 'number' || node.data.timeoutMs <= 0) {
      issues.push({
        code: 'UNGUARDED_APPROVAL_TIMEOUT',
        severity: 'warning',
        message: `Approval '${nodeLabel(node)}' has no timeout — the run could block indefinitely.`,
        nodeId: node.id,
        field: 'timeoutMs',
      });
    }
  }
  return issues;
}

function lintLargeFork(def: PipelineDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of def.nodes) {
    if (node.data.type !== 'fork') continue;
    if (typeof node.data.branchCount === 'number' && node.data.branchCount > 5) {
      issues.push({
        code: 'LARGE_FORK',
        severity: 'warning',
        message: `Fork with ${node.data.branchCount} branches; consider splitting into multiple joins for readability.`,
        nodeId: node.id,
        field: 'branchCount',
      });
    }
  }
  return issues;
}

/**
 * Reports when the longest path from Trigger to a terminal (no-outgoing-edges)
 * node exceeds 12 hops. Uses a memoized DFS: depth(trigger) = 1, depth(n) =
 * 1 + max(depth(predecessors)). Only terminal nodes count for the "deepest
 * leaf" metric so that long straight-line pipelines are caught even without
 * explicit fan-out.
 */
function lintDeepChain(def: PipelineDefinition): ValidationIssue[] {
  const MAX_DEPTH = 12;
  const triggers = def.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) return [];

  // Build successor adjacency.
  const next = new Map<string, string[]>();
  for (const node of def.nodes) next.set(node.id, []);
  for (const edge of def.edges) next.get(edge.source)?.push(edge.target);

  // BFS depth from trigger. If the graph has cycles we bail — cycles are
  // reported as errors elsewhere and would cause an infinite walk here.
  const depth = new Map<string, number>();
  const queue: string[] = [triggers[0].id];
  depth.set(triggers[0].id, 1);
  const guard = def.nodes.length * def.nodes.length + 1;
  let steps = 0;
  while (queue.length > 0) {
    if (steps++ > guard) return []; // cycle fallback
    const current = queue.shift()!;
    const currentDepth = depth.get(current)!;
    for (const successor of next.get(current) ?? []) {
      const existing = depth.get(successor);
      if (existing === undefined || currentDepth + 1 > existing) {
        depth.set(successor, currentDepth + 1);
        queue.push(successor);
      }
    }
  }

  let maxDepth = 0;
  for (const d of depth.values()) if (d > maxDepth) maxDepth = d;

  if (maxDepth > MAX_DEPTH) {
    return [
      {
        code: 'DEEP_CHAIN',
        severity: 'warning',
        message: `Pipeline is very deep (${maxDepth} levels); consider modularizing.`,
      },
    ];
  }
  return [];
}

function lintDuplicateNodeName(def: PipelineDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byName = new Map<string, PipelineNode[]>();
  for (const node of def.nodes) {
    const name = nodeLabel(node);
    const bucket = byName.get(name) ?? [];
    bucket.push(node);
    byName.set(name, bucket);
  }
  for (const [name, bucket] of byName) {
    if (bucket.length < 2) continue;
    for (const node of bucket) {
      issues.push({
        code: 'DUPLICATE_NODE_NAME',
        severity: 'warning',
        message: `Multiple nodes named '${name}'; consider disambiguating.`,
        nodeId: node.id,
      });
    }
  }
  return issues;
}

function lintLowTemperatureNonDeterministicPrompt(
  def: PipelineDefinition,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const templatePattern = /\{\{[^}]+\}\}/;
  for (const node of def.nodes) {
    if (node.data.type !== 'llm') continue;
    const { temperature, userPromptTemplate } = node.data;
    if (typeof temperature !== 'number' || temperature <= 0.8) continue;
    if (!userPromptTemplate || !templatePattern.test(userPromptTemplate)) continue;
    issues.push({
      code: 'LOW_TEMPERATURE_NON_DETERMINISTIC_PROMPT',
      severity: 'warning',
      message: `LLM '${nodeLabel(node)}' uses high temperature with templated inputs — outputs will be non-deterministic, pair with a retry or validation downstream.`,
      nodeId: node.id,
    });
  }
  return issues;
}

function lintScheduledDraft(def: PipelineDefinition): ValidationIssue[] {
  if (def.triggerBinding?.event !== 'schedule') return [];
  if (def.status !== 'draft') return [];
  return [
    {
      code: 'NO_PUBLISHED_VERSION_BUT_TRIGGER_SCHEDULED',
      severity: 'warning',
      message:
        "Scheduled trigger on a draft pipeline — schedules won't fire until published.",
    },
  ];
}

/**
 * Fires once per Condition whose `false` handle has no outgoing edge BUT whose
 * `true` handle does. The asymmetry is the signal: the author wired one branch
 * and forgot the other, so any node that should have lived on the false path
 * is unreachable at runtime. When BOTH handles are unwired we leave it to
 * `UNUSED_CONDITION_BRANCH` (the dual fires are noise). Severity: warning.
 */
function lintUnreachableAfterConditionFalse(def: PipelineDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const handlesBySource = new Map<string, Set<string>>();
  for (const edge of def.edges) {
    const set = handlesBySource.get(edge.source) ?? new Set<string>();
    set.add(edge.sourceHandle);
    handlesBySource.set(edge.source, set);
  }
  for (const node of def.nodes) {
    if (node.type !== 'condition') continue;
    const used = handlesBySource.get(node.id) ?? new Set<string>();
    const hasTrue = used.has('true');
    const hasFalse = used.has('false');
    if (hasTrue && !hasFalse) {
      issues.push({
        code: 'UNREACHABLE_AFTER_CONDITION_FALSE',
        severity: 'warning',
        message: `Condition '${nodeLabel(node)}' has no edge from its 'false' handle — any node intended for the false branch is unreachable.`,
        nodeId: node.id,
        field: 'false',
      });
    }
  }
  return issues;
}

/**
 * Fires when a Fork's parallel branches never converge in a Join, OR when a
 * Join can't be traced back to a single common Fork ancestor. The check is
 * intentionally local — for each Fork we forward-traverse from every branch
 * handle and require that every branch reach the SAME Join node. For each
 * Join we backward-traverse from every input handle and require a common
 * Fork ancestor. Cycles in the graph (already an error elsewhere) are
 * guarded against with a visited-set bound.
 *
 * Punted edge cases:
 *   - Nested Fork/Join pairs: a branch that re-forks before joining is
 *     accepted as long as the OUTER branches still all eventually converge
 *     on the outer Join. We pick the FIRST Join reached on each branch
 *     (BFS), which is the natural "innermost matching" definition; if the
 *     author intentionally wires asymmetric nested structures the lint may
 *     produce a false positive — acceptable for a warning.
 *   - Conditions inside a fork branch are walked through transparently
 *     (both `true` and `false` are treated as forward edges), since either
 *     side could carry the run to the Join at runtime.
 */
function lintForkWithoutMatchingJoin(def: PipelineDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const successors = new Map<string, { target: string; sourceHandle: string }[]>();
  const predecessors = new Map<string, string[]>();
  for (const node of def.nodes) {
    successors.set(node.id, []);
    predecessors.set(node.id, []);
  }
  for (const edge of def.edges) {
    successors.get(edge.source)?.push({ target: edge.target, sourceHandle: edge.sourceHandle });
    predecessors.get(edge.target)?.push(edge.source);
  }

  const nodeById = new Map<string, PipelineNode>();
  for (const node of def.nodes) nodeById.set(node.id, node);

  /** BFS forward from `start`; returns the id of the first Join encountered, or null. */
  function firstJoinForward(start: string): string | null {
    const visited = new Set<string>([start]);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentNode = nodeById.get(current);
      if (currentNode && currentNode.type === 'join' && current !== start) return current;
      for (const { target } of successors.get(current) ?? []) {
        if (visited.has(target)) continue;
        visited.add(target);
        queue.push(target);
      }
    }
    return null;
  }

  /** BFS backward from `start`; returns the id of the first Fork encountered, or null. */
  function firstForkBackward(start: string): string | null {
    const visited = new Set<string>([start]);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentNode = nodeById.get(current);
      if (currentNode && currentNode.type === 'fork' && current !== start) return current;
      for (const upstream of predecessors.get(current) ?? []) {
        if (visited.has(upstream)) continue;
        visited.add(upstream);
        queue.push(upstream);
      }
    }
    return null;
  }

  // -- Fork side: every wired branch must reach the same Join -----------
  for (const node of def.nodes) {
    if (node.data.type !== 'fork') continue;
    const out = successors.get(node.id) ?? [];
    if (out.length === 0) continue; // unwired entirely — UNUSED_FORK_BRANCH covers it
    const reachedJoins = new Set<string | null>();
    for (const { target } of out) {
      reachedJoins.add(firstJoinForward(target));
    }
    // If any branch reaches no Join at all, or branches reach different Joins, warn.
    const hasNullReach = reachedJoins.has(null);
    const distinctJoins = [...reachedJoins].filter(j => j !== null);
    if (hasNullReach || distinctJoins.length !== 1) {
      issues.push({
        code: 'FORK_WITHOUT_MATCHING_JOIN',
        severity: 'warning',
        message: `Fork '${nodeLabel(node)}' branches do not converge in a single Join — parallel branches may diverge or terminate without merging.`,
        nodeId: node.id,
      });
    }
  }

  // -- Join side: every Join must trace back to a common Fork ancestor ---
  for (const node of def.nodes) {
    if (node.data.type !== 'join') continue;
    const ins = predecessors.get(node.id) ?? [];
    if (ins.length === 0) continue; // covered by JOIN_INSUFFICIENT_INPUTS
    const reachedForks = new Set<string | null>();
    for (const upstream of ins) {
      reachedForks.add(firstForkBackward(upstream));
    }
    const hasNullReach = reachedForks.has(null);
    const distinctForks = [...reachedForks].filter(f => f !== null);
    if (hasNullReach || distinctForks.length !== 1) {
      issues.push({
        code: 'FORK_WITHOUT_MATCHING_JOIN',
        severity: 'warning',
        message: `Join '${nodeLabel(node)}' has no matching upstream Fork — its incoming branches don't share a common Fork ancestor.`,
        nodeId: node.id,
      });
    }
  }

  return issues;
}
