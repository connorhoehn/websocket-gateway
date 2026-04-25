// frontend/src/components/pipelines/nodes/condition/ConditionConfig.tsx
//
// Config panel for Condition nodes. See PIPELINES_PLAN.md §18.10.
//
// Single-expression boolean branch. The optional label is surfaced on the
// node face on the canvas so the author can distinguish multiple branches.

import type { CSSProperties } from 'react';
import type { ConditionNodeData } from '../../../../types/pipeline';
import { fieldStyle, saveBtnStyle, colors } from '../../../../constants/styles';
import CodeEditor from '../../../shared/CodeEditor';

export interface ConditionConfigProps {
  data: ConditionNodeData;
  onChange: (patch: Partial<ConditionNodeData>) => void;
}

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: colors.textSecondary };
const requiredDot: CSSProperties = { color: '#dc2626', marginLeft: 4 };
const helpStyle: CSSProperties = { fontSize: 11, color: colors.textTertiary, marginTop: 2 };
const errorStyle: CSSProperties = { fontSize: 11, color: '#dc2626', marginTop: 2 };

// Variables visible to boolean condition expressions.
const CONDITION_VARIABLES = ['context.trigger', 'context.steps'];

export default function ConditionConfig({ data, onChange }: ConditionConfigProps) {
  const expressionMissing = !data.expression?.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
      <div>
        <label style={labelStyle}>Expression<span style={requiredDot}>●</span></label>
        <div style={{ marginTop: 4 }}>
          <CodeEditor
            value={data.expression}
            onChange={(next) => onChange({ expression: next })}
            language="javascript"
            variables={CONDITION_VARIABLES}
            aria-label="Condition expression"
          />
        </div>
        {expressionMissing
          ? <div style={errorStyle}>Expression is required.</div>
          : <div style={helpStyle}>e.g. context.llm.response.length &gt; 500</div>
        }
      </div>

      <div>
        <label style={labelStyle}>Label (optional — shown on node face)</label>
        <input
          type="text"
          style={{ ...fieldStyle, marginTop: 4 }}
          value={data.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
          placeholder="Long summary?"
        />
        <div style={helpStyle}>A short name so this branch is easy to spot.</div>
      </div>

      <button
        type="button"
        onClick={() => { /* Phase 1 stub — wired in Phase 3 */ }}
        style={saveBtnStyle(false)}
      >
        ▶ Preview with sample context
      </button>
    </div>
  );
}
