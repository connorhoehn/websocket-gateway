// frontend/src/components/pipelines/export/toMermaid.ts
//
// Pipeline → Mermaid flowchart export. Emits a `flowchart TD` definition that
// can be copy-pasted into Markdown viewers (GitHub, Notion, mermaid.live, etc).
//
// Shape conventions (per PIPELINES_PLAN.md §18 menu task):
//   - Round rect   `(...)`   — LLM
//   - Diamond      `{...}`   — Condition
//   - Hexagon      `{{...}}` — Fork
//   - Trapezoid    `[/.../\]` — Approval
//   - Default rect `[...]`   — Trigger, Transform, Action, Join
//
// Edge labels are emitted only for non-default source handles (`true`/`false`,
// `branch-N`, `approved`/`rejected`, `error`).

import type {
  ApprovalNodeData,
  ConditionNodeData,
  ForkNodeData,
  LLMNodeData,
  PipelineDefinition,
  PipelineNode,
} from '../../../types/pipeline';

// ---------------------------------------------------------------------------
// Node ID mapping — Mermaid node IDs are alphanumeric + `_` only.
// ---------------------------------------------------------------------------

function mermaidId(prefix: string, index: number): string {
  return `${prefix}${index}`;
}

const TYPE_PREFIX: Record<string, string> = {
  trigger: 't',
  llm: 'llm',
  transform: 'x',
  condition: 'c',
  action: 'a',
  fork: 'f',
  join: 'j',
  approval: 'ap',
};

const TYPE_ICON: Record<string, string> = {
  trigger: '▶',
  llm: '🧠',
  transform: '⚙',
  condition: '❓',
  action: '⚡',
  fork: '🔀',
  join: '🔗',
  approval: '✋',
};

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

/**
 * Escape characters that break Mermaid node labels.
 * Quotes, backticks, and angle brackets confuse the parser; HTML entities are
 * safest. Newlines become `<br/>`.
 */
function escapeLabel(raw: string): string {
  return raw
    .replace(/"/g, '&quot;')
    .replace(/#/g, '&#35;')
    .replace(/\n/g, '<br/>');
}

const TYPE_DISPLAY: Record<string, string> = {
  trigger: 'Trigger',
  llm: 'LLM',
  transform: 'Transform',
  condition: 'Condition',
  action: 'Action',
  fork: 'Fork',
  join: 'Join',
  approval: 'Approval',
};

function labelFor(node: PipelineNode): string {
  const icon = TYPE_ICON[node.type] ?? '■';
  const typeName =
    TYPE_DISPLAY[node.type] ??
    node.type.charAt(0).toUpperCase() + node.type.slice(1);
  let hint: string | null = null;

  switch (node.data.type) {
    case 'llm':
      hint = (node.data as LLMNodeData).model || null;
      break;
    case 'condition': {
      const c = node.data as ConditionNodeData;
      hint = c.label || c.expression || null;
      break;
    }
    case 'approval': {
      const a = node.data as ApprovalNodeData;
      const n = a.approvers?.length ?? 0;
      hint = `${n} approver${n === 1 ? '' : 's'}`;
      break;
    }
    case 'fork': {
      const f = node.data as ForkNodeData;
      hint = `${f.branchCount} branch${f.branchCount === 1 ? '' : 'es'}`;
      break;
    }
    case 'action':
      hint = node.data.actionType;
      break;
    case 'transform':
      hint = node.data.transformType;
      break;
    case 'trigger':
      hint = node.data.triggerType;
      break;
    case 'join':
      hint = node.data.mode;
      break;
  }

  const header = `${icon} ${typeName}`;
  return escapeLabel(hint ? `${header}<br/>${hint}` : header);
}

// ---------------------------------------------------------------------------
// Shape wrappers — Mermaid uses different bracket pairs per shape.
// ---------------------------------------------------------------------------

function wrapShape(nodeType: string, label: string): string {
  const quoted = `"${label}"`;
  switch (nodeType) {
    case 'condition':
      return `{${quoted}}`;
    case 'fork':
      return `{{${quoted}}}`;
    case 'approval':
      return `[/${quoted}\\]`;
    case 'llm':
      return `(${quoted})`;
    default:
      return `[${quoted}]`;
  }
}

// ---------------------------------------------------------------------------
// Edge label helper — only emit a label for non-default source handles.
// ---------------------------------------------------------------------------

function edgeLabel(sourceHandle: string | undefined): string | null {
  if (!sourceHandle || sourceHandle === 'out') return null;
  return sourceHandle;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function toMermaid(def: PipelineDefinition): string {
  const lines: string[] = ['flowchart TD'];

  // Assign stable mermaid IDs — `{typePrefix}{N}` — so the output is
  // deterministic and readable.
  const counters: Record<string, number> = {};
  const idMap = new Map<string, string>();
  for (const node of def.nodes) {
    const prefix = TYPE_PREFIX[node.type] ?? 'n';
    const n = (counters[prefix] = (counters[prefix] ?? 0) + 1);
    idMap.set(node.id, mermaidId(prefix, n));
  }

  // Node declarations.
  for (const node of def.nodes) {
    const mid = idMap.get(node.id);
    if (!mid) continue;
    const shape = wrapShape(node.type, labelFor(node));
    lines.push(`  ${mid}${shape}`);
  }

  // Edge declarations.
  for (const edge of def.edges) {
    const src = idMap.get(edge.source);
    const tgt = idMap.get(edge.target);
    if (!src || !tgt) continue;
    const label = edgeLabel(edge.sourceHandle);
    if (label) {
      lines.push(`  ${src} --"${escapeLabel(label)}"--> ${tgt}`);
    } else {
      lines.push(`  ${src} --> ${tgt}`);
    }
  }

  return lines.join('\n');
}
