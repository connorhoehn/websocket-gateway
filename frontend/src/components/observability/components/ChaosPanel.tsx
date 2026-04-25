// frontend/src/components/observability/components/ChaosPanel.tsx
//
// Left rail of /observability/nodes. Wired to the Phase-1 `chaosState`
// module, which the `MockExecutor` reads on every sleep/failure-roll. Phase
// 5 will replace the module-scoped state with the real distributed-core
// `ChaosInjector` (PIPELINES_PLAN.md §18.7).

import { useEffect, useMemo, useState } from 'react';
import Modal from '../../shared/Modal';
import { colors, fieldStyle, saveBtnStyle, cancelBtnStyle } from '../../../constants/styles';
import {
  getChaosState,
  resetChaosState,
  setChaosState,
  subscribeChaosState,
  type ChaosState,
} from '../../pipelines/chaos/chaosState';

export interface ChaosPanelNode {
  id: string;
  label?: string;
}

export interface ChaosPanelProps {
  onInjectLatency?: (ms: number) => void;
  onInjectPartition?: (nodeIds: string[]) => void;
  onDropMessages?: (percent: number) => void;
  onKillAll?: () => void;
  onReset?: () => void;
  availableNodes?: ChaosPanelNode[];
}

const defaultNodes: ChaosPanelNode[] = [
  { id: 'node-0' }, { id: 'node-1' }, { id: 'node-2' },
];

const labelStyle = {
  fontSize: 11, fontWeight: 600, color: colors.textSecondary,
  textTransform: 'uppercase' as const, letterSpacing: 0.3,
};

const sectionStyle = {
  display: 'flex' as const, flexDirection: 'column' as const, gap: 6,
  paddingBottom: 12, marginBottom: 12,
  borderBottom: `1px solid ${colors.border}`,
};

function ChaosPanel(props: ChaosPanelProps) {
  // Default handlers mutate the shared `chaosState` module that MockExecutor
  // reads. NodesPage can still override with its own richer handlers (e.g.
  // to layer additional observability behavior).
  const {
    onInjectLatency = (ms) => setChaosState({ injectedLatencyMs: Math.max(0, ms) }),
    onInjectPartition = (ids) =>
      // No partition semantics exist in Phase 1 mock land — map to pause so
      // something visibly happens when you click Inject.
      setChaosState({ paused: ids.length > 0 }),
    onDropMessages = (pct) =>
      // Interpret drop % as bonus failure-rate so MockExecutor produces
      // roughly that many extra failed steps. Clamp 0..100.
      setChaosState({
        injectedFailureRate: Math.min(1, Math.max(0, pct / 100)),
      }),
    onKillAll = () => setChaosState({ paused: true }),
    onReset = () => resetChaosState(),
    availableNodes = defaultNodes,
  } = props;

  const [latencyMs, setLatencyMs] = useState('0');
  const [dropPercent, setDropPercent] = useState('0');
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [confirmKill, setConfirmKill] = useState(false);

  // Live chaos state — re-rendered when `setChaosState` fires.
  const [chaos, setChaos] = useState<ChaosState>(() => getChaosState());
  useEffect(() => subscribeChaosState((s) => setChaos(s)), []);

  const toggleNode = (id: string) => {
    setSelectedNodes((prev) =>
      prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id],
    );
  };

  const applyLatency = () => {
    const n = Number.parseInt(latencyMs, 10);
    if (Number.isFinite(n)) onInjectLatency(n);
  };

  const applyDrop = () => {
    const n = Number.parseInt(dropPercent, 10);
    if (Number.isFinite(n)) onDropMessages(n);
  };

  const injectPartition = () => {
    onInjectPartition(selectedNodes);
  };

  const confirmKillAll = () => {
    onKillAll();
    setConfirmKill(false);
  };

  const togglePause = () => {
    setChaosState({ paused: !chaos.paused });
  };

  const nodeOptions = useMemo(() => availableNodes, [availableNodes]);

  const chaosActive =
    chaos.injectedLatencyMs > 0 ||
    chaos.injectedFailureRate > 0 ||
    chaos.paused;

  return (
    <div
      data-testid="chaos-panel"
      style={{
        width: 240, flexShrink: 0, padding: 16,
        background: colors.surfacePanel,
        borderRight: `1px solid ${colors.border}`,
        fontFamily: 'inherit', fontSize: 13, color: colors.textPrimary,
        overflowY: 'auto',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: colors.textSecondary, letterSpacing: 0.4, marginBottom: 12 }}>
        CHAOS
      </div>

      {/* Live state readout */}
      <div
        data-testid="chaos-state-readout"
        style={{
          ...sectionStyle,
          background: chaosActive ? '#fffbeb' : 'transparent',
          padding: chaosActive ? 8 : 0,
          borderRadius: 6,
          border: chaosActive ? `1px solid #fde68a` : 'none',
        }}
      >
        <div style={labelStyle}>Current state</div>
        <div style={{ fontSize: 12, color: colors.textPrimary, lineHeight: 1.6 }}>
          <div>
            <span style={{ color: colors.textTertiary }}>Latency:</span>{' '}
            <strong data-testid="chaos-state-latency">{chaos.injectedLatencyMs}</strong> ms
          </div>
          <div>
            <span style={{ color: colors.textTertiary }}>Failure rate:</span>{' '}
            <strong data-testid="chaos-state-failure">
              {Math.round(chaos.injectedFailureRate * 100)}
            </strong>
            %
          </div>
          <div>
            <span style={{ color: colors.textTertiary }}>Paused:</span>{' '}
            <strong data-testid="chaos-state-paused">{chaos.paused ? 'yes' : 'no'}</strong>
          </div>
        </div>
        <button
          data-testid="chaos-pause-toggle"
          onClick={togglePause}
          style={saveBtnStyle(false)}
        >
          {chaos.paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      {/* Latency */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Latency</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            data-testid="chaos-latency-input"
            type="number"
            min={0}
            value={latencyMs}
            onChange={(e) => setLatencyMs(e.target.value)}
            style={{ ...fieldStyle, minWidth: 60 }}
            aria-label="Latency in milliseconds"
          />
          <span style={{ fontSize: 11, color: colors.textTertiary, alignSelf: 'center' }}>ms</span>
        </div>
        <button
          data-testid="chaos-latency-apply"
          onClick={applyLatency}
          style={saveBtnStyle(false)}
        >
          Apply
        </button>
      </div>

      {/* Partition */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Partition nodes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {nodeOptions.map((n) => (
            <label
              key={n.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: colors.textPrimary, cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={selectedNodes.includes(n.id)}
                onChange={() => toggleNode(n.id)}
              />
              {n.label ?? n.id}
            </label>
          ))}
        </div>
        <button
          data-testid="chaos-partition-inject"
          onClick={injectPartition}
          style={saveBtnStyle(selectedNodes.length === 0)}
          disabled={selectedNodes.length === 0}
        >
          Inject
        </button>
      </div>

      {/* Drop messages */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Drop messages</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            data-testid="chaos-drop-input"
            type="number"
            min={0}
            max={100}
            value={dropPercent}
            onChange={(e) => setDropPercent(e.target.value)}
            style={{ ...fieldStyle, minWidth: 60 }}
            aria-label="Drop percent"
          />
          <span style={{ fontSize: 11, color: colors.textTertiary, alignSelf: 'center' }}>%</span>
        </div>
        <button
          data-testid="chaos-drop-apply"
          onClick={applyDrop}
          style={saveBtnStyle(false)}
        >
          Apply
        </button>
      </div>

      {/* Kill all + Reset */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          data-testid="chaos-kill-all"
          onClick={() => setConfirmKill(true)}
          style={{
            padding: '6px 14px', fontSize: 13, fontWeight: 600,
            background: colors.state.failed, color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Kill all
        </button>
        <button
          data-testid="chaos-reset"
          onClick={onReset}
          style={cancelBtnStyle}
        >
          Reset
        </button>
      </div>

      <Modal
        open={confirmKill}
        onClose={() => setConfirmKill(false)}
        title="Kill all nodes?"
        footer={
          <>
            <button
              data-testid="chaos-kill-cancel"
              onClick={() => setConfirmKill(false)}
              style={cancelBtnStyle}
            >
              Cancel
            </button>
            <button
              data-testid="chaos-kill-confirm"
              onClick={confirmKillAll}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                background: colors.state.failed, color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Kill all
            </button>
          </>
        }
      >
        This will terminate every node in the cluster. This action is destructive
        and cannot be undone.
      </Modal>
    </div>
  );
}

export default ChaosPanel;
