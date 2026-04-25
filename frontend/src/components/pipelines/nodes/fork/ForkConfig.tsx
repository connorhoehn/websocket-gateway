// frontend/src/components/pipelines/nodes/fork/ForkConfig.tsx
//
// Config panel for Fork nodes. See PIPELINES_PLAN.md §18.10.
//
// branchCount is bounded to 2..8 (type-enforced in pipeline.ts). Each
// branch label is an optional free-form string; we keep the array sized
// to branchCount so downstream consumers can index safely.

import type { CSSProperties } from 'react';
import type { ForkNodeData } from '../../../../types/pipeline';
import { fieldStyle, colors } from '../../../../constants/styles';

export interface ForkConfigProps {
  data: ForkNodeData;
  onChange: (patch: Partial<ForkNodeData>) => void;
}

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: colors.textSecondary };
const requiredDot: CSSProperties = { color: '#dc2626', marginLeft: 4 };
const helpStyle: CSSProperties = { fontSize: 11, color: colors.textTertiary, marginTop: 2 };

const MIN_BRANCHES = 2;
const MAX_BRANCHES = 8;

function resizeLabels(labels: string[] | undefined, count: number): string[] {
  const src = labels ?? [];
  if (src.length === count) return src;
  if (src.length > count) return src.slice(0, count);
  return [...src, ...Array<string>(count - src.length).fill('')];
}

export default function ForkConfig({ data, onChange }: ForkConfigProps) {
  const count = Math.max(MIN_BRANCHES, Math.min(MAX_BRANCHES, data.branchCount || MIN_BRANCHES));
  const labels = resizeLabels(data.branchLabels, count);

  const setBranchCount = (n: number) => {
    const clamped = Math.max(MIN_BRANCHES, Math.min(MAX_BRANCHES, n));
    onChange({
      branchCount: clamped,
      branchLabels: resizeLabels(data.branchLabels, clamped),
    });
  };

  const setLabel = (idx: number, value: string) => {
    const next = [...labels];
    next[idx] = value;
    onChange({ branchLabels: next });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
      {/* Branch count */}
      <div>
        <label style={labelStyle}>
          Branch count<span style={requiredDot}>●</span>
          <span style={{ color: colors.textTertiary, fontWeight: 400, marginLeft: 8 }}>{count}</span>
        </label>
        <input
          type="range"
          min={MIN_BRANCHES}
          max={MAX_BRANCHES}
          step={1}
          value={count}
          onChange={(e) => setBranchCount(parseInt(e.target.value, 10))}
          style={{ width: '100%', marginTop: 4 }}
        />
        <input
          type="number"
          min={MIN_BRANCHES}
          max={MAX_BRANCHES}
          style={{ ...fieldStyle, marginTop: 4, width: 80 }}
          value={count}
          onChange={(e) => setBranchCount(parseInt(e.target.value, 10) || MIN_BRANCHES)}
        />
        <div style={helpStyle}>Between {MIN_BRANCHES} and {MAX_BRANCHES} parallel branches.</div>
      </div>

      {/* Branch labels */}
      <div>
        <label style={labelStyle}>Branch labels (optional)</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {labels.map((label, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: colors.textSecondary, minWidth: 72 }}>
                Branch {idx}:
              </span>
              <input
                type="text"
                style={fieldStyle}
                value={label}
                onChange={(e) => setLabel(idx, e.target.value)}
                placeholder={idx === 0 ? 'primary' : `branch-${idx}`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
