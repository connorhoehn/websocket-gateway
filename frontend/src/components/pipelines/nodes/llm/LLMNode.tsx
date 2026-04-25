// frontend/src/components/pipelines/nodes/llm/LLMNode.tsx
//
// LLM node — 1 input (`in`), 2 outputs (`out`, `error`). Subtitle is the
// model name; body shows the first 2 lines of the user-prompt template;
// footer is an expandable response preview when `_llmResponse` is present.
// See PIPELINES_PLAN.md §5.2 / §7.3 / §18.4.4 / §19.12.

import { useState, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import BaseNode, { type NodeExecutionState } from '../BaseNode';
import type { LLMNodeData } from '../../../../types/pipeline';
import { colors } from '../../../../constants/styles';
import { usePrefersReducedMotion } from '../../../../hooks/usePrefersReducedMotion';

interface LLMResponseInfo {
  response: string;
  tokensIn?: number;
  tokensOut?: number;
  streaming?: boolean;
}

type LLMData = LLMNodeData & {
  _state?: NodeExecutionState;
  _llmResponse?: LLMResponseInfo;
} & Record<string, unknown>;

type LLMFlowNode = Node<LLMData, 'llm'>;

function previewPrompt(template: string): string {
  if (!template || template.trim().length === 0) return 'Not configured';
  const lines = template.split('\n').slice(0, 2);
  const out = lines.join(' ').trim();
  return out.length > 120 ? `${out.slice(0, 117)}…` : out;
}

function ResponseFooter({ info }: { info: LLMResponseInfo }) {
  const [open, setOpen] = useState(false);

  const toggleBtn: CSSProperties = {
    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 12, color: colors.textSecondary,
    fontWeight: 500, textAlign: 'left',
  };

  const tokensLabel: CSSProperties = {
    marginLeft: 6, fontSize: 11, color: colors.textTertiary,
  };

  const bodyStyle: CSSProperties = {
    marginTop: 4,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11, lineHeight: 1.4,
    color: colors.textPrimary,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: open ? 'none' : '1.4em',
    overflow: 'hidden',
  };

  const text = open
    ? info.response
    : info.response.length > 60 ? `${info.response.slice(0, 60)}…` : info.response;

  const showTokens = info.tokensIn != null || info.tokensOut != null;

  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} style={toggleBtn}>
        {open ? '▾' : '▸'} Response
        {showTokens && (
          <span style={tokensLabel}>
            {info.tokensIn ?? 0} → {info.tokensOut ?? 0} tokens
          </span>
        )}
        {info.streaming && <span style={tokensLabel}>· streaming…</span>}
      </button>
      <div
        style={{
          ...bodyStyle,
          // Clamp to 6 lines when expanded (CSS line-clamp). When collapsed,
          // maxHeight above already caps the preview to one line.
          display: open ? '-webkit-box' : 'block',
          WebkitLineClamp: open ? 6 : undefined,
          WebkitBoxOrient: open ? ('vertical' as const) : undefined,
        }}
      >
        {text}
      </div>
    </div>
  );
}

export default function LLMNode(props: NodeProps<LLMFlowNode>) {
  const { data, selected } = props;
  const state: NodeExecutionState = data._state ?? 'idle';

  const body = (
    <span style={{ fontStyle: 'italic' }}>
      {previewPrompt(data.userPromptTemplate)}
    </span>
  );

  const footer = data._llmResponse ? <ResponseFooter info={data._llmResponse} /> : undefined;

  const targetHandleStyle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10,
  };
  const outHandleStyle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10, top: '40%',
  };
  const errorHandleStyle: CSSProperties = {
    background: colors.state.failed, width: 10, height: 10, top: '60%',
  };

  return (
    <BaseNode
      icon="🧠"
      subtitle={data.model || data.provider}
      state={state}
      body={body}
      footer={footer}
      selected={selected}
    >
      <Handle type="target" position={Position.Left}  id="in"    style={targetHandleStyle} />
      <Handle type="source" position={Position.Right} id="out"   style={outHandleStyle} />
      <Handle type="source" position={Position.Right} id="error" style={errorHandleStyle} />
    </BaseNode>
  );
}
