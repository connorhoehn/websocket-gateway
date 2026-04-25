// frontend/src/components/observability/NodesPage.tsx
//
// Three-region /observability/nodes route (PIPELINES_PLAN.md §18.7):
//   left:   ChaosPanel (240px) — latency / partition / drop / kill-all / reset
//   center: NodeGrid — cards wrap; click to select and open drawer
//   right:  detail drawer (320px, only while a node is selected) — full
//           metrics, owned resources list (empty Phase 1), scoped chaos, and
//           a stub `[Transfer resource]` button
//
// Phase 1: node data is fabricated from the dashboard fixture. When the
// fixture doesn't ship per-node detail (today: it doesn't), we fabricate
// 3 sensible `node-0/1/2` entries.

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import ChaosPanel from './components/ChaosPanel';
import NodeGrid from './components/NodeGrid';
import type { NodeSummary } from './components/NodeGridTile';
import dashboardFixture from './fixtures/dashboardFixture';
import { colors, cancelBtnStyle, saveBtnStyle } from '../../constants/styles';

// ---------------------------------------------------------------------------
// Fixture -> NodeSummary shaping
// ---------------------------------------------------------------------------

function seededHistory(seed: number): number[] {
  const out: number[] = [];
  let v = seed;
  for (let i = 0; i < 24; i++) {
    v = (v * 9301 + 49297) % 233280;
    out.push(Math.abs(v % 40) + 5);
  }
  return out;
}

function fabricateNodes(): NodeSummary[] {
  return [
    {
      id: 'node-0', status: 'healthy', role: 'worker', region: 'us-east-1',
      cpu: 12, memoryMb: 340, connections: 12, activeRuns: 2, cpuHistory: seededHistory(1),
    },
    {
      id: 'node-1', status: 'healthy', role: 'worker', region: 'us-east-1',
      cpu: 8, memoryMb: 280, connections: 15, activeRuns: 1, cpuHistory: seededHistory(7),
    },
    {
      id: 'node-2', status: 'healthy', role: 'worker', region: 'us-east-1',
      cpu: 19, memoryMb: 395, connections: 9, activeRuns: 0, cpuHistory: seededHistory(13),
    },
  ];
}

function resolveNodes(): NodeSummary[] {
  // Phase 1 fixture has no per-node detail; fabricate a reasonable default.
  // Future: read from `dashboardFixture.regions[*].nodes`.
  const regions = dashboardFixture?.regions ?? {};
  const fromFixture: NodeSummary[] = [];
  for (const key of Object.keys(regions)) {
    const region = regions[key];
    if (region?.nodes && Array.isArray(region.nodes)) {
      for (const n of region.nodes) {
        fromFixture.push({
          id: n.id ?? `node-${fromFixture.length}`,
          status: n.status ?? 'healthy',
          role: n.role ?? 'worker',
          region: key,
          cpu: n.cpu ?? 0,
          memoryMb: n.memoryMb ?? 0,
          connections: n.connections ?? 0,
          activeRuns: n.activeRuns ?? 0,
          cpuHistory: n.cpuHistory ?? seededHistory(fromFixture.length + 1),
        });
      }
    }
  }
  return fromFixture.length > 0 ? fromFixture : fabricateNodes();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function formatMem(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`;
  return `${Math.round(mb)}M`;
}

function NodesPage() {
  const nodes = useMemo(resolveNodes, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const pageStyle: CSSProperties = {
    display: 'flex', height: '100%', minHeight: 0,
    fontFamily: 'inherit', fontSize: 13, color: colors.textPrimary,
    background: colors.surface,
  };

  const centerStyle: CSSProperties = {
    flex: 1, minWidth: 0, overflow: 'auto',
    padding: 24,
  };

  const drawerStyle: CSSProperties = {
    width: 320, flexShrink: 0,
    borderLeft: `1px solid ${colors.border}`,
    background: colors.surface,
    display: 'flex', flexDirection: 'column',
    overflowY: 'auto',
  };

  const drawerHeader: CSSProperties = {
    padding: '12px 14px', borderBottom: `1px solid ${colors.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  };

  const drawerSection: CSSProperties = {
    padding: '12px 14px', borderBottom: `1px solid ${colors.border}`,
    display: 'flex', flexDirection: 'column', gap: 8,
  };

  const sectionLabel: CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
    color: colors.textSecondary, textTransform: 'uppercase',
  };

  return (
    <div data-testid="nodes-page" style={pageStyle}>
      {/* Chaos rail — wired to the shared `chaosState` module via ChaosPanel's
          default handlers. Real distributed-core injection lands in Phase 5. */}
      <div
        title="Stub: writes to local chaosState; real cluster injection ships in Phase 5"
        data-testid="chaos-rail-stub-wrapper"
      >
        <ChaosPanel
          availableNodes={nodes.map((n) => ({ id: n.id, label: n.id }))}
        />
      </div>

      <section style={centerStyle}>
        <NodeGrid
          nodes={nodes}
          selectedId={selectedId ?? undefined}
          onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
        />
      </section>

      {selected && (
        <aside data-testid="nodes-detail-drawer" style={drawerStyle}>
          <div style={drawerHeader}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{selected.id}</div>
              <div style={{ fontSize: 11, color: colors.textTertiary }}>
                {[selected.role, selected.region].filter(Boolean).join(' · ') || 'worker'}
              </div>
            </div>
            <button
              data-testid="nodes-detail-close"
              onClick={() => setSelectedId(null)}
              aria-label="Close drawer"
              style={{
                border: 'none', background: 'transparent',
                color: colors.textTertiary, cursor: 'pointer',
                fontSize: 16, padding: 2, fontFamily: 'inherit',
              }}
            >
              ×
            </button>
          </div>

          {/* Metrics table */}
          <div style={drawerSection}>
            <div style={sectionLabel}>Metrics</div>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Status', selected.status],
                  ['CPU', `${Math.round(selected.cpu)}%`],
                  ['Memory', formatMem(selected.memoryMb)],
                  ['Connections', String(selected.connections)],
                  ['Active runs', String(selected.activeRuns)],
                  ['Region', selected.region ?? '—'],
                  ['Role', selected.role ?? '—'],
                ].map(([k, v]) => (
                  <tr key={k as string}>
                    <td style={{ color: colors.textTertiary, padding: '3px 0', width: '45%' }}>
                      {k}
                    </td>
                    <td style={{ color: colors.textPrimary, padding: '3px 0' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Owned resources (empty in Phase 1) */}
          <div style={drawerSection}>
            <div style={sectionLabel}>Owned resources</div>
            <div style={{ fontSize: 12, color: colors.textTertiary }}>
              No resources owned (Phase 1 placeholder).
            </div>
          </div>

          {/* Chaos controls scoped to node */}
          <div style={drawerSection}>
            <div style={sectionLabel}>Chaos (this node)</div>
            <button
              title="Stub: real per-node chaos injection ships in Phase 5"
              onClick={() => console.log('[NodesPage] add latency to', selected.id)}
              style={{ ...saveBtnStyle(false), alignSelf: 'flex-start' }}
            >
              Add latency
            </button>
            <button
              title="Stub: real per-node chaos injection ships in Phase 5"
              onClick={() => console.log('[NodesPage] kill', selected.id)}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                background: colors.state.failed, color: '#fff',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'inherit', alignSelf: 'flex-start',
              }}
            >
              Kill node
            </button>
          </div>

          {/* Transfer resource stub */}
          <div style={drawerSection}>
            <div style={sectionLabel}>Actions</div>
            <button
              onClick={() => console.log('[NodesPage] transfer resource from', selected.id)}
              style={cancelBtnStyle}
            >
              Transfer resource
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}

export default NodesPage;
