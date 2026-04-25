// frontend/src/components/pipelines/nodes/join/JoinConfig.tsx
//
// Config panel for Join nodes. See PIPELINES_PLAN.md §18.10.
//
// Current-input count is computed at runtime from incoming edges; Phase 1
// renders a placeholder string so the layout matches the design.

import type { CSSProperties } from 'react';
import type { JoinNodeData, JoinMode, JoinMergeStrategy } from '../../../../types/pipeline';
import { fieldStyle, colors } from '../../../../constants/styles';

export interface JoinConfigProps {
  data: JoinNodeData;
  onChange: (patch: Partial<JoinNodeData>) => void;
}

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: colors.textSecondary };
const requiredDot: CSSProperties = { color: '#dc2626', marginLeft: 4 };
const helpStyle: CSSProperties = { fontSize: 11, color: colors.textTertiary, marginTop: 2 };

const MODE_OPTIONS: Array<{ value: JoinMode; label: string; hint: string }> = [
  { value: 'all',    label: 'All',     hint: 'Wait for every input.' },
  { value: 'any',    label: 'Any',     hint: 'Fire on the first input.' },
  { value: 'n_of_m', label: 'N of M',  hint: 'Fire after N inputs.' },
];

const STRATEGY_OPTIONS: Array<{ value: JoinMergeStrategy; label: string; hint: string }> = [
  { value: 'deep-merge',        label: 'Deep merge',        hint: 'Recursively merge input objects.' },
  { value: 'array-collect',     label: 'Array collect',     hint: 'Writes inputs to context.joinInputs[].' },
  { value: 'last-writer-wins',  label: 'Last writer wins',  hint: 'Most recent input replaces prior.' },
];

export default function JoinConfig({ data, onChange }: JoinConfigProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
      {/* Mode */}
      <div>
        <label style={labelStyle}>Mode<span style={requiredDot}>●</span></label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {MODE_OPTIONS.map(opt => (
            <label
              key={opt.value}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: colors.textPrimary, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="join-mode"
                checked={data.mode === opt.value}
                onChange={() => onChange({ mode: opt.value })}
              />
              {opt.label}
              <span style={{ color: colors.textTertiary, fontSize: 11 }}>— {opt.hint}</span>
            </label>
          ))}
        </div>

        {data.mode === 'n_of_m' && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ ...labelStyle, fontSize: 11 }}>N</label>
            <input
              type="number"
              min={1}
              style={{ ...fieldStyle, width: 80 }}
              value={data.n ?? 1}
              onChange={(e) => onChange({ n: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            />
          </div>
        )}
      </div>

      {/* Merge strategy */}
      <div>
        <label style={labelStyle}>Merge strategy<span style={requiredDot}>●</span></label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {STRATEGY_OPTIONS.map(opt => (
            <label
              key={opt.value}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: colors.textPrimary, cursor: 'pointer' }}
            >
              <input
                type="radio"
                name="join-merge"
                checked={data.mergeStrategy === opt.value}
                onChange={() => onChange({ mergeStrategy: opt.value })}
              />
              {opt.label}
              <span style={{ color: colors.textTertiary, fontSize: 11 }}>— {opt.hint}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Current inputs (read-only) */}
      <div
        style={{
          padding: 8,
          background: colors.surfaceInset,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          fontSize: 12,
          color: colors.textSecondary,
        }}
      >
        Current inputs: <strong>TBD</strong>
        <div style={helpStyle}>Derived from incoming edges once the canvas is connected.</div>
      </div>
    </div>
  );
}
