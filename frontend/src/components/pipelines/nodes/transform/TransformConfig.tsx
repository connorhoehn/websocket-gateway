// frontend/src/components/pipelines/nodes/transform/TransformConfig.tsx
//
// Config panel for Transform nodes. See PIPELINES_PLAN.md §18.10.
//
// Radio for transform type (JSONPath / Template / JavaScript), a mono
// expression textarea, an optional outputKey, and a visual-only
// "sample input | sample output" preview area (inert for Phase 1).

import type { CSSProperties } from 'react';
import type { TransformNodeData, TransformType } from '../../../../types/pipeline';
import { fieldStyle, colors } from '../../../../constants/styles';
import CodeEditor from '../../../shared/CodeEditor';

export interface TransformConfigProps {
  data: TransformNodeData;
  onChange: (patch: Partial<TransformNodeData>) => void;
}

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: colors.textSecondary };
const requiredDot: CSSProperties = { color: '#dc2626', marginLeft: 4 };
const helpStyle: CSSProperties = { fontSize: 11, color: colors.textTertiary, marginTop: 2 };
const errorStyle: CSSProperties = { fontSize: 11, color: '#dc2626', marginTop: 2 };

// Variables available to Transform expressions. Rendered as clickable pills
// above the CodeEditor so authors can insert without typing dot paths by hand.
const TRANSFORM_VARIABLES = ['context', 'context.steps', 'context.trigger'];

const RADIO_OPTIONS: Array<{ value: TransformType; label: string }> = [
  { value: 'jsonpath',   label: 'JSONPath' },
  { value: 'template',   label: 'Template' },
  { value: 'javascript', label: 'JavaScript' },
];

export default function TransformConfig({ data, onChange }: TransformConfigProps) {
  const expressionMissing = !data.expression?.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
      {/* Type */}
      <div>
        <label style={labelStyle}>Type<span style={requiredDot}>●</span></label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {RADIO_OPTIONS.map(opt => (
            <label
              key={opt.value}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 13, color: colors.textPrimary, cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="transform-type"
                value={opt.value}
                checked={data.transformType === opt.value}
                onChange={() => onChange({ transformType: opt.value })}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* Expression */}
      <div>
        <label style={labelStyle}>Expression<span style={requiredDot}>●</span></label>
        <div style={{ marginTop: 4 }}>
          <CodeEditor
            value={data.expression}
            onChange={(next) => onChange({ expression: next })}
            language={data.transformType === 'javascript' ? 'javascript' : 'jsonpath'}
            variables={TRANSFORM_VARIABLES}
            aria-label="Transform expression"
          />
        </div>
        {expressionMissing
          ? <div style={errorStyle}>Expression is required.</div>
          : <div style={helpStyle}>
              {data.transformType === 'jsonpath'   && 'e.g. $.items[?(@.status == "active")]'}
              {data.transformType === 'template'   && 'Mustache-style: {{ context.doc.title }}'}
              {data.transformType === 'javascript' && 'return ctx.items.filter(x => x.active)'}
            </div>
        }
      </div>

      {/* Output key */}
      <div>
        <label style={labelStyle}>Output key (optional)</label>
        <input
          type="text"
          style={{ ...fieldStyle, marginTop: 4 }}
          value={data.outputKey ?? ''}
          onChange={(e) => onChange({ outputKey: e.target.value || undefined })}
          placeholder="activeItems"
        />
        <div style={helpStyle}>
          If set, writes to context.{data.outputKey || 'outputKey'}.
          Otherwise merges into root context.
        </div>
      </div>

      {/* Preview area (inert Phase 1) */}
      <div>
        <label style={labelStyle}>Preview</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
          <div>
            <div style={{ ...helpStyle, marginTop: 0, marginBottom: 4 }}>Sample input</div>
            <textarea
              disabled
              style={{
                ...fieldStyle,
                minHeight: 80,
                fontFamily: 'monospace',
                fontSize: 11,
                background: colors.surfaceInset,
                color: colors.textTertiary,
                resize: 'vertical',
              }}
              placeholder='{ "items": [...] }'
            />
          </div>
          <div>
            <div style={{ ...helpStyle, marginTop: 0, marginBottom: 4 }}>Sample output</div>
            <textarea
              disabled
              style={{
                ...fieldStyle,
                minHeight: 80,
                fontFamily: 'monospace',
                fontSize: 11,
                background: colors.surfaceInset,
                color: colors.textTertiary,
                resize: 'vertical',
              }}
              placeholder="(preview available in Phase 3)"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
