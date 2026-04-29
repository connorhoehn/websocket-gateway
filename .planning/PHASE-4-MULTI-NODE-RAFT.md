# Phase-4 Spike — Multi-Node Deployment + Raft Pipeline Registry

**Status:** scoping
**Owner:** infra
**Last updated:** 2026-04-28
**Pre-requisite:** Phase 3 (`Cluster.create()` facade migration) fully landed

This is the planning doc for moving from today's single-node `Cluster.create({ registry: 'wal', transport: 'in-memory' })` shape (Phase 3 target) to a 3-node production cluster with a Raft-backed pipeline registry. It pairs with `.planning/DC-INTEGRATION-ROADMAP.md` Phase 4 (sub-items 4.1–4.4) and rests directly on top of `.planning/CLUSTER-FACADE-MIGRATION.md`.

The scope is the **pipeline registry only**. Room ownership stays CRDT — presence-style data with no conflict concern.

---

## 1. Operational requirements for Raft (from DC v0.6.0 handoff)

- **Persistent `dataDir` (mandatory).** Holds `<dataDir>/raft.wal` plus the `currentTerm` / `votedFor` persistent-state file. Both files MUST round-trip together. Backing up only the WAL is a split-brain footgun.
- **Disk monitoring.** WAL grows append-only until `snapshotThreshold` (default 10000 entries) triggers compaction. Alerting on `dataDir` free-space is mandatory.
- **Election timing.** Defaults: `electionTimeoutMin/Max = 150–300ms` randomized; `heartbeatIntervalMs = 50`. Failover window in a healthy 3-node cluster is ~600ms — acceptable for our approval/cancel write rate.
- **Snapshot threshold.** 10k entries is sane for our load (we expect <5k pipeline-run/approval events/day). Tunable per-config; rollback-friendly.
- **WAL corruption.** Registry refuses to start (fail-closed). The corrupt node is backfilled from peers via `InstallSnapshot` RPC after wiping its `dataDir`.
- **`persistent-state` loss.** Worse than WAL loss — the node could vote twice in the same term. Recovery procedure: wipe `dataDir`, re-add via joint consensus.
- **`leaseReadEnabled: true`** (default) gives ~50ms-stale reads without a quorum round-trip. Already a win for read-heavy approval-status checks.

## 2. Concrete config diff

Today (Phase 3) the social-api bootstrap calls:

```ts
Cluster.create({
  nodeId,
  topic: `pipeline-${nodeId}`,
  pubsub:    { type: 'memory' },
  transport: { type: 'in-memory' },
  registry:  { type: 'wal', walPath: registryWalFilePath },
  metrics: metricsRegistry,
});
```

Phase 4 social-api becomes:

```ts
Cluster.create({
  nodeId,
  topic: 'pipeline',                                    // shared across replicas
  pubsub:    { type: 'redis', url: process.env.REDIS_URL },
  transport: { type: 'tcp', port: 7100,
               seedNodes: ['social-api-0:7100', 'social-api-1:7100', 'social-api-2:7100'] },
  registry:  { type: 'raft',
               raftConfig: {
                 dataDir: '/var/lib/social-api/raft',
                 snapshotThreshold: 10_000,
                 timerConfig: { electionTimeoutMinMs: 150, electionTimeoutMaxMs: 300, heartbeatIntervalMs: 50 },
                 leaseReadEnabled: true,
                 staleReadsAllowed: false,              // approvals must be linearizable
                 maxBatchSize: 100,
                 preVoteEnabled: true,
                 maxClockDriftMs: 50,
                 proposalTimeoutMs: 5000,
               } },
  metrics: metricsRegistry,
});
```

Gateway side (room ownership) **stays unchanged**: `registry: { type: 'crdt' }`, `transport: { type: 'tcp', ... }`, `pubsub: { type: 'redis', ... }`. Only transport + pubsub flip; registry remains CRDT. `topic` differs (`'wsg-rooms'` vs `'pipeline'`) so the two domains don't cross-talk.

The two clusters run *in the same process* on each social-api replica — the gateway already runs in its own service. Phase 4 is fundamentally about giving social-api Raft, not about moving the gateway off CRDT.

## 3. Deployment shape

- **Replicas: 3 minimum.** Raft needs a majority quorum; 3 tolerates 1 failure. Bump to 5 only if we need 2-failure tolerance — the cost is doubled write replication fan-out.
- **Service discovery.** Static seed list via env vars is the simplest start (`SEED_NODES=social-api-0:7100,social-api-1:7100,social-api-2:7100`). If we land on Kubernetes, a headless `Service` gives stable per-pod DNS (`social-api-{0..2}.social-api-headless.ns.svc`). DC accepts a flat string list either way.
- **Load balancer.** The gateway is sticky-by-room (per-room ownership routing already exists via ResourceRouter). Approval/cancel API requests can hit any social-api replica; non-leader replicas auto-forward writes to the leader via `RaftRpcRouter`. Reads default to local state machine (lease reads). **No L7 stickiness needed for the social-api API.**
- **Autoscaling with Raft.** This is the operational sharp edge. **You cannot freely scale Raft replicas.** Adding/removing a member requires a **joint-consensus configuration change** (DC v0.6.0, `RaftMembershipManager`). Implication: HPA on social-api must be disabled, OR we wrap scale events in an admission controller that calls `cluster.raft.addMember(id) / removeMember(id)` before the pod is admitted. Default stance: **fixed replica count, vertical scale only**, until we have automation around joint consensus.
- **Rolling deploy.** With joint consensus we can do RollingUpdate at `maxUnavailable: 1`. The recipe: drain (gracefully `cluster.stop()`), let Raft notice the loss, deploy new pod, joint-consensus add it back, wait for log catch-up, move to the next pod. DC v0.6.0 ships the primitives; we still need a controller or operator script.

## 4. Disk + storage planning

- **WAL volume per node.** Each pipeline event ≈ 0.5–2KB serialized. At 5k events/day worst-case → ~10MB/day pre-snapshot. Snapshot at 10k entries triggers compaction. Steady-state on-disk footprint per node: **<200MB**.
- **PersistentVolume.** 5GB per replica is generous — sized for snapshot-during-compaction (write old + new + scratch) plus 30 days of growth. ReadWriteOnce, on whatever block-storage class the existing infra uses.
- **Backup strategy.** `raft.wal` AND `persistent-state` MUST round-trip together — atomic snapshot of the whole `dataDir` is required. Daily PV snapshots are sufficient because Raft's own log replication gives us cross-node redundancy in real time. Restore procedure: stop one replica, restore PV, start; Raft catches it up via `InstallSnapshot` if the WAL gap is too large.
- **Loss tolerance.** Losing 1-of-3 dataDirs: recover by wiping and re-joining (peers backfill). Losing 2-of-3: data loss event — only the surviving node's state remains; restore from the latest PV snapshot.

## 5. Failure modes inventory

| Scenario | Behavior | Operator action |
|---|---|---|
| 1 node down (3-node) | Reads/writes continue (2/3 quorum) | Replace pod; Raft auto-catches up |
| 2 nodes down (3-node) | **Writes halt; reads stale-only if `staleReadsAllowed=true` (we run `false`)** | Restore quorum ASAP — there's no graceful degrade for approvals |
| Network partition | Minority side cannot elect (term advances safely; no split-brain). Pubsub fan-out may diverge **but Redis is the source of truth for fan-out**, not Raft | Heal partition; minority side rejoins |
| WAL corruption (1 node) | That node refuses to start | Wipe `dataDir`, restart, peers backfill via `InstallSnapshot` |
| `persistent-state` loss (1 node) | Split-brain risk if naive restart | Wipe full `dataDir`, re-add via joint consensus — never restart with empty persistent-state but extant WAL |
| Cascade restart (all 3 reboot near-simultaneously) | Write availability stalls until quorum re-establishes (~1–3s) | None — self-healing |
| Clock skew >`maxClockDriftMs` (50ms) | Lease reads disabled automatically; falls back to heartbeat reads | Investigate NTP / chrony |

## 6. Migration sequencing

1. **Pre-req:** Phase 3 fully complete on both gateway and social-api.
2. **Single-node Raft validation.** Flip social-api dev to `registry: { type: 'raft', raftConfig: { dataDir: '/tmp/raft' } }` with seedNodes containing only itself. Validates the config path, dataDir layout, restart durability — without quorum dynamics. ~2 days.
3. **3-replica staging.** Deploy 3 replicas to a staging environment with TCP transport + Redis pubsub. Use the same image as production. Validate joint-consensus add/remove via a manual playbook. ~1 week.
4. **Chaos.** Kill leader, kill follower, partition (1 vs 2), heal, observe linearizability of approvals via a probe client that issues concurrent approve/cancel and verifies serialized order. ~1 week.
5. **Production rollout.** Three replicas, autoscaling **off**, rolling-deploy controller in place. Backout flag (`PIPELINE_REGISTRY_TYPE=wal`) compiled in. ~1 week of soak.

## 7. Rollback plan

- **Soft rollback:** flip `registry.type` back to `'wal'`. **Cost: Raft WAL contents are not portable to the WAL registry.** Any state written during the Raft window is lost on rollback. Acceptable for a within-day backout if approvals can be re-driven by upstream callers.
- **Tuning rollback:** `snapshotThreshold` is a config knob — increase if compaction churn is problematic, decrease if WAL grows too large.
- **No-go criteria** (any one triggers rollback before promotion to prod):
  - p95 approval-write latency > 250ms with all 3 replicas healthy
  - Any failed chaos test where two concurrent approvals on different nodes produce a non-serializable history
  - WAL growth exceeding 50MB/day in staging
  - Joint-consensus add/remove fails to complete within 30s

## 8. Effort estimate

| Sub-task | Effort |
|---|---|
| 4.1 TCP transport + Redis pubsub config + seed-list plumbing | 1 week |
| 4.2 Raft registry config + dataDir provisioning + parent-dir checks (mirror of Phase-3 WAL checks) | 1 week |
| 4.3 Joint-consensus rolling-deploy controller / runbook | 1.5–2 weeks |
| 4.4 Read-index sanity checks + lease-read tuning + `staleReadsAllowed` policy | 0.5 week |
| Chaos harness + probe client | 1 week |
| Observability (Raft term, leader-id, log-index gauges, snapshot duration histograms — mostly via DC metrics threading) | 0.5 week |
| Staging soak + production rollout | 1 week |
| **Total** | **6–8 weeks** |

## 9. Recommendation: **WAIT** (decision-pending)

The honest answer: we don't yet have a trigger for going multi-node.

- **HA?** Today's single-replica social-api meets our SLO with WAL durability — restart loses ≤2s of in-flight runs, and runs are idempotent on retry.
- **Throughput?** Pipeline-run rate is well below what one node handles.
- **Geographic distribution?** Out of scope (Phase 5+).

**Concrete trigger condition to revisit:** any one of —
1. We commit to a "no single-replica services in prod" HA posture (compliance / ops policy).
2. Approval-write rate exceeds 50/s sustained (where CRDT last-write-wins becomes user-visible).
3. We onboard a second region requiring linearizable cross-region approvals.

Until one of those fires, Phase 3 is sufficient. Phase 4 effort (~6–8 weeks) is **deferred** but **not blocked** — Phase 3's facade migration is the actual precondition, and that's already in flight. When the trigger does fire, Phase 4 is a config-flag flip plus the operational work above.

**Action this quarter:** finish Phase 3, do the Step-2 single-node Raft validation as a 2-day spike to de-risk the config path, and stop there. Do **not** spin up the 3-replica deploy until a trigger condition is met.
