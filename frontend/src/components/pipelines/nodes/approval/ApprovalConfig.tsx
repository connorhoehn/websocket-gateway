// frontend/src/components/pipelines/nodes/approval/ApprovalConfig.tsx
//
// Config panel for Approval nodes. See PIPELINES_PLAN.md §18.10.
//
// Approvers are stored on the node as `{ type, value }` records. The
// UserPicker (shared) returns plain user ids; we project to and from
// the approver shape so Phase 1 only surfaces "user" approvers. Role
// approvers are editable via the chip list (the picker will grow
// role support in a later phase).

import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ApprovalNodeData, Approver, ApprovalTimeoutAction } from '../../../../types/pipeline';
import { fieldStyle, chipStyle, colors } from '../../../../constants/styles';
import UserPicker from '../../../shared/UserPicker';

export interface ApprovalConfigProps {
  data: ApprovalNodeData;
  onChange: (patch: Partial<ApprovalNodeData>) => void;
}

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: colors.textSecondary };
const requiredDot: CSSProperties = { color: '#dc2626', marginLeft: 4 };
const helpStyle: CSSProperties = { fontSize: 11, color: colors.textTertiary, marginTop: 2 };
const errorStyle: CSSProperties = { fontSize: 11, color: '#dc2626', marginTop: 2 };

type TimeUnit = 'seconds' | 'minutes' | 'hours';
const UNIT_MS: Record<TimeUnit, number> = {
  seconds: 1000,
  minutes: 60_000,
  hours:   3_600_000,
};

// Pick the coarsest unit that divides the ms value evenly so edit-roundtrips
// are stable when the user hasn't touched the unit picker.
function inferUnit(ms: number | undefined): TimeUnit {
  if (!ms || ms <= 0) return 'minutes';
  if (ms % UNIT_MS.hours   === 0) return 'hours';
  if (ms % UNIT_MS.minutes === 0) return 'minutes';
  return 'seconds';
}

export default function ApprovalConfig({ data, onChange }: ApprovalConfigProps) {
  const approvers = data.approvers ?? [];
  const approversMissing = approvers.length === 0;

  // Unit is UI-only state — the stored value is always ms.
  const [unit, setUnit] = useState<TimeUnit>(() => inferUnit(data.timeoutMs));
  const unitValue = data.timeoutMs !== undefined
    ? Math.round(data.timeoutMs / UNIT_MS[unit])
    : '';

  const userApproverIds = approvers.filter(a => a.type === 'user').map(a => a.value);

  const setUserApprovers = (ids: string[]) => {
    // Preserve any role approvers the user added separately.
    const roles = approvers.filter(a => a.type === 'role');
    const users: Approver[] = ids.map(id => ({ type: 'user', value: id }));
    const next = [...users, ...roles];
    onChange({
      approvers: next,
      // Clamp requiredCount so it never exceeds approvers.length (min 1).
      requiredCount: Math.max(1, Math.min(data.requiredCount || 1, next.length || 1)),
    });
  };

  const removeApprover = (idx: number) => {
    const next = approvers.filter((_, i) => i !== idx);
    onChange({
      approvers: next,
      requiredCount: Math.max(1, Math.min(data.requiredCount || 1, next.length || 1)),
    });
  };

  const setTimeoutValue = (v: string) => {
    if (v === '') {
      onChange({ timeoutMs: undefined });
      return;
    }
    const n = Math.max(0, parseInt(v, 10) || 0);
    onChange({ timeoutMs: n * UNIT_MS[unit] });
  };

  const setTimeoutUnit = (nextUnit: TimeUnit) => {
    setUnit(nextUnit);
    // Reinterpret the displayed number in the new unit so the user sees
    // "24 hours" stay as "24" when they flip the picker.
    if (typeof unitValue === 'number' && !Number.isNaN(unitValue)) {
      onChange({ timeoutMs: unitValue * UNIT_MS[nextUnit] });
    }
  };

  const requiredCountMax = Math.max(1, approvers.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
      {/* Approvers */}
      <div>
        <label style={labelStyle}>Approvers<span style={requiredDot}>●</span></label>

        <div style={{ marginTop: 4 }}>
          <UserPicker
            value={userApproverIds}
            onChange={setUserApprovers}
            placeholder="Add approver…"
          />
        </div>

        {approvers.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {approvers.map((a, idx) => (
              <span
                key={`${a.type}:${a.value}:${idx}`}
                style={{
                  ...chipStyle(a.type === 'role' ? 'warning' : 'info'),
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {a.type === 'role' ? '🎖' : '👤'} {a.value}
                <button
                  type="button"
                  onClick={() => removeApprover(idx)}
                  aria-label={`Remove ${a.value}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    marginLeft: 2,
                    cursor: 'pointer',
                    color: 'inherit',
                    fontFamily: 'inherit',
                    fontSize: 12,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {approversMissing
          ? <div style={errorStyle}>At least one approver is required.</div>
          : <div style={helpStyle}>Who can approve this step.</div>
        }
      </div>

      {/* Required count */}
      <div>
        <label style={labelStyle}>
          Required count<span style={requiredDot}>●</span>
          <span style={{ color: colors.textTertiary, fontWeight: 400, marginLeft: 8 }}>
            {data.requiredCount || 1} of {requiredCountMax}
          </span>
        </label>
        <input
          type="number"
          min={1}
          max={requiredCountMax}
          style={{ ...fieldStyle, marginTop: 4, width: 96 }}
          value={data.requiredCount || 1}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            const clamped = Math.max(1, Math.min(requiredCountMax, Number.isNaN(n) ? 1 : n));
            onChange({ requiredCount: clamped });
          }}
        />
        <div style={helpStyle}>How many approvers must say yes.</div>
      </div>

      {/* Timeout */}
      <div>
        <label style={labelStyle}>Timeout</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <input
            type="number"
            min={0}
            style={{ ...fieldStyle, width: 96, flex: 'none' }}
            value={unitValue}
            onChange={(e) => setTimeoutValue(e.target.value)}
            placeholder="24"
          />
          <select
            style={{ ...fieldStyle, width: 120, flex: 'none' }}
            value={unit}
            onChange={(e) => setTimeoutUnit(e.target.value as TimeUnit)}
          >
            <option value="seconds">seconds</option>
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
          </select>
        </div>
        <div style={helpStyle}>Leave blank for no timeout.</div>

        {data.timeoutMs !== undefined && data.timeoutMs > 0 && (
          <div style={{ marginTop: 8 }}>
            <label style={{ ...labelStyle, fontSize: 11 }}>If timeout</label>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              {(['reject', 'approve'] as ApprovalTimeoutAction[]).map(action => (
                <label
                  key={action}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: colors.textPrimary, cursor: 'pointer' }}
                >
                  <input
                    type="radio"
                    name="approval-timeout-action"
                    checked={(data.timeoutAction ?? 'reject') === action}
                    onChange={() => onChange({ timeoutAction: action })}
                  />
                  {action === 'reject' ? 'Reject' : 'Approve'}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Message */}
      <div>
        <label style={labelStyle}>Message for approver (optional)</label>
        <textarea
          style={{
            ...fieldStyle,
            marginTop: 4,
            minHeight: 80,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
          value={data.message ?? ''}
          onChange={(e) => onChange({ message: e.target.value || undefined })}
          placeholder="Please review the summary before it's posted to the document."
        />
        <div style={helpStyle}>Shown to the approver when the request is sent.</div>
      </div>
    </div>
  );
}
