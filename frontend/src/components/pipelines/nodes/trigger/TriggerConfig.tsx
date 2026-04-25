// frontend/src/components/pipelines/nodes/trigger/TriggerConfig.tsx
//
// Config panel for Trigger nodes. See PIPELINES_PLAN.md §18.10.
//
// Fields rendered are conditional on `triggerType`:
//   document.*  → document type dropdown (from localStorage `ws_document_types_v1`)
//   schedule    → cron input + placeholder "Next fires" preview
//   webhook     → path input + read-only full-URL preview

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { TriggerNodeData, TriggerType } from '../../../../types/pipeline';
import { fieldStyle, colors } from '../../../../constants/styles';

export interface TriggerConfigProps {
  data: TriggerNodeData;
  onChange: (patch: Partial<TriggerNodeData>) => void;
}

// ---------------------------------------------------------------------------
// Shared label / help / error styles (kept local to avoid touching constants)
// ---------------------------------------------------------------------------

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: colors.textSecondary,
};

const requiredDot: CSSProperties = {
  color: '#dc2626',
  marginLeft: 4,
};

const helpStyle: CSSProperties = {
  fontSize: 11,
  color: colors.textTertiary,
  marginTop: 2,
};

const errorStyle: CSSProperties = {
  fontSize: 11,
  color: '#dc2626',
  marginTop: 2,
};

const errorFieldStyle: CSSProperties = {
  ...fieldStyle,
  borderColor: '#dc2626',
};

// Minimal localStorage document-type shape (null-safe, read-only).
interface StoredDocType { id: string; name: string }

function readDocTypes(): StoredDocType[] {
  try {
    const raw = localStorage.getItem('ws_document_types_v1');
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .filter(x => typeof x.id === 'string' && typeof x.name === 'string')
      .map(x => ({ id: x.id as string, name: x.name as string }));
  } catch {
    return [];
  }
}

const TRIGGER_TYPE_OPTIONS: Array<{ value: TriggerType; label: string }> = [
  { value: 'manual',            label: 'Manual' },
  { value: 'document.finalize', label: 'Document finalize' },
  { value: 'document.submit',   label: 'Document submit' },
  { value: 'document.comment',  label: 'Document comment' },
  { value: 'schedule',          label: 'Schedule' },
  { value: 'webhook',           label: 'Webhook' },
];

export default function TriggerConfig({ data, onChange }: TriggerConfigProps) {
  const isDoc = data.triggerType.startsWith('document.');
  const docTypes = useMemo(() => (isDoc ? readDocTypes() : []), [isDoc]);

  const docTypeMissing = isDoc && !data.documentTypeId;
  const scheduleMissing = data.triggerType === 'schedule' && !data.schedule;
  const webhookMissing  = data.triggerType === 'webhook'  && !data.webhookPath;

  const eventLabel =
    data.triggerType === 'document.finalize' ? 'On finalize' :
    data.triggerType === 'document.submit'   ? 'On submit for review' :
    data.triggerType === 'document.comment'  ? 'On comment added' : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
      {/* Trigger type */}
      <div>
        <label style={labelStyle}>
          Trigger type<span style={requiredDot}>●</span>
        </label>
        <select
          style={{ ...fieldStyle, marginTop: 4 }}
          value={data.triggerType}
          onChange={(e) => onChange({ triggerType: e.target.value as TriggerType })}
        >
          {TRIGGER_TYPE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Document type (when document.*) */}
      {isDoc && (
        <div>
          <label style={labelStyle}>
            Document type<span style={requiredDot}>●</span>
          </label>
          <select
            style={{ ...(docTypeMissing ? errorFieldStyle : fieldStyle), marginTop: 4 }}
            value={data.documentTypeId ?? ''}
            onChange={(e) => onChange({ documentTypeId: e.target.value || undefined })}
          >
            <option value="">— select a document type —</option>
            {docTypes.map(dt => (
              <option key={dt.id} value={dt.id}>{dt.name}</option>
            ))}
          </select>
          {docTypeMissing
            ? <div style={errorStyle}>Select a document type.</div>
            : <div style={helpStyle}>Which document type should trigger this pipeline.</div>
          }
          {eventLabel && (
            <div style={{ ...helpStyle, marginTop: 6 }}>
              Event: <span style={{ fontWeight: 600, color: colors.textSecondary }}>{eventLabel}</span>
            </div>
          )}
        </div>
      )}

      {/* Schedule (cron) */}
      {data.triggerType === 'schedule' && (
        <div>
          <label style={labelStyle}>
            Schedule (cron)<span style={requiredDot}>●</span>
          </label>
          <input
            type="text"
            style={{ ...(scheduleMissing ? errorFieldStyle : fieldStyle), marginTop: 4, fontFamily: 'monospace' }}
            placeholder="0 */15 * * * *"
            value={data.schedule ?? ''}
            onChange={(e) => onChange({ schedule: e.target.value })}
          />
          {scheduleMissing
            ? <div style={errorStyle}>Cron expression is required.</div>
            : <div style={helpStyle}>Standard 5- or 6-field cron expression.</div>
          }
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: colors.surfaceInset,
              border: `1px dashed ${colors.border}`,
              borderRadius: 6,
              fontSize: 11,
              color: colors.textTertiary,
            }}
          >
            Next fires: … (preview available after save)
          </div>
        </div>
      )}

      {/* Webhook */}
      {data.triggerType === 'webhook' && (
        <div>
          <label style={labelStyle}>
            Path<span style={requiredDot}>●</span>
          </label>
          <input
            type="text"
            style={{ ...(webhookMissing ? errorFieldStyle : fieldStyle), marginTop: 4, fontFamily: 'monospace' }}
            placeholder="/weekly-digest"
            value={data.webhookPath ?? ''}
            onChange={(e) => onChange({ webhookPath: e.target.value })}
          />
          {webhookMissing
            ? <div style={errorStyle}>Webhook path is required.</div>
            : <div style={helpStyle}>Leading slash recommended.</div>
          }
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: colors.surfaceInset,
              border: `1px dashed ${colors.border}`,
              borderRadius: 6,
              fontSize: 11,
              color: colors.textSecondary,
              fontFamily: 'monospace',
              wordBreak: 'break-all',
            }}
          >
            Full URL: http://localhost:3001/hooks/pipeline{data.webhookPath ?? ''}
          </div>
        </div>
      )}
    </div>
  );
}
