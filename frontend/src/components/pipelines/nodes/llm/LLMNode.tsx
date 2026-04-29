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
import { useRetryFromStep, useLatestStepForNode } from '../../context/PipelineRunsContext';

interface LLMResponseInfo {
  response: string;
  tokensIn?: number;
  tokensOut?: number;
  /** True while tokens are actively arriving (tokensOut > 0 and step still running). */
  streaming?: boolean;
  /**
   * True between `pipeline.llm.stream.opened` and the first token. Distinct
   * from `streaming` — this is the open-but-no-tokens window and is the
   * visual signal that latency is being measured. Cleared as soon as the
   * first token lands.
   */
  streamOpening?: boolean;
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
        {info.streamOpening && (
          <span
            style={{ ...tokensLabel, color: colors.state.running }}
            data-testid="llm-stream-opening"
            title="LLM stream is open — waiting for the first token"
          >
            · stream open — waiting…
          </span>
        )}
        {!info.streamOpening && info.streaming && (
          <span style={tokensLabel}>· streaming…</span>
        )}
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
  const { id, data, selected } = props;

  // Runtime step state for this node — folded from the latest run that has
  // executed it (see useLatestStepForNode). Falls back to the static node
  // config when no run has touched this node yet, so editor view (no runs
  // triggered) renders as before.
  const liveStep = useLatestStepForNode(id);
  // StepStatus is a structural superset of NodeExecutionState — both share
  // pending|running|completed|failed|skipped|awaiting. The only divergence is
  // `cancelled`, which we surface as `failed` (the reducer already records
  // it that way for run-level UI, see PipelineRunsContext.tsx step.cancelled).
  const liveState: NodeExecutionState | undefined =
    liveStep?.status === 'cancelled' ? 'failed' : (liveStep?.status as NodeExecutionState | undefined);
  const state: NodeExecutionState = liveState ?? data._state ?? 'idle';

  // Build a runtime LLMResponseInfo from the live step. Two visuals are
  // distinguished:
  //   - streamOpening: open but no tokens yet (waiting on first token)
  //   - streaming: tokens are arriving and the step is still running
  // Both clear when the step completes (status !== 'running').
  const liveLlm = liveStep?.llm;
  const isStreamOpening =
    state === 'running' &&
    liveLlm?.streamOpened === true &&
    (liveLlm?.tokensOut ?? 0) === 0;
  const isStreaming =
    state === 'running' &&
    liveLlm !== undefined &&
    (liveLlm.tokensOut ?? 0) > 0;

  // §17.6 retry-from-here — see TriggerNode for the rationale.
  const retry = useRetryFromStep();
  const onRetry = state === 'failed' ? () => retry(id) : undefined;

  const body = (
    <span style={{ fontStyle: 'italic' }}>
      {previewPrompt(data.userPromptTemplate)}
    </span>
  );

  // Prefer the live response info when a run has touched this node; otherwise
  // fall back to whatever static `_llmResponse` was stamped on the data.
  const liveResponse: LLMResponseInfo | undefined = liveLlm
    ? {
        response: liveLlm.response ?? '',
        tokensIn: liveLlm.tokensIn,
        tokensOut: liveLlm.tokensOut,
        streaming: isStreaming,
        streamOpening: isStreamOpening,
      }
    : undefined;

  const responseInfo = liveResponse ?? data._llmResponse;
  const footer = responseInfo ? <ResponseFooter info={responseInfo} /> : undefined;

  const targetHandleStyle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10,
  };
  const outHandleStyle: CSSProperties = {
    background: colors.borderEmphasis, width: 10, height: 10, top: '40%',
  };
  const errorHandleStyle: CSSProperties = {
    background: colors.state.failed, width: 10, height: 10, top: '60%',
  };

  // Build a descriptive aria-label for screen readers — type + model + a
  // truncated peek at the system prompt. Keep ~120 chars max so AT users
  // aren't slowed down by repeated long announcements.
  const sys = (data.systemPrompt ?? '').replace(/\s+/g, ' ').trim();
  const sysPreview = sys.length === 0
    ? 'no system prompt'
    : `system prompt: ${sys.length > 60 ? `${sys.slice(0, 60)}…` : sys}`;
  const ariaLabel = `LLM node, ${data.model || data.provider}, ${sysPreview}, state: ${state}`;

  return (
    <BaseNode
      icon="🧠"
      subtitle={data.model || data.provider}
      state={state}
      body={body}
      footer={footer}
      selected={selected}
      onRetry={onRetry}
      ariaLabel={ariaLabel}
    >
      <Handle type="target" position={Position.Left}  id="in"    style={targetHandleStyle} />
      <Handle type="source" position={Position.Right} id="out"   style={outHandleStyle} />
      <Handle type="source" position={Position.Right} id="error" style={errorHandleStyle} />
    </BaseNode>
  );
}
