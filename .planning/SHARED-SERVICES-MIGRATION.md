# Shared services migration — scoping doc

> Per blocker #9 / hub#95 / operator decision option B:
> "Write a short scoping doc... 3 sub-decisions: how the in-cluster pod
> reaches a host-side DynamoDB, whether to namespace tables in production
> or only locally, and whether to keep Tilt at all for gateway."

## Context

The orchestrator just shipped a shared local-services stack: a single
DynamoDB-local + Redis-local pair, brought up by
`$AGENT_HUB_ROOT/scripts/start-shared-services.sh`, exposed on host ports
`:8000` and `:6379`, recorded in `$AGENT_HUB_ROOT/.shared-services.json`
(see `prompts/shared-services-pattern.md`).

Today, gateway's local dev stack is Tilt-driven. The Tiltfile
(`Tiltfile:48-69`) deploys a Helm chart that includes redis-local and
dynamodb-local as in-cluster pods alongside gateway and social-api, and
port-forwards `:8000` + `:6379` to the host. With shared services
running, those host ports are already bound, so `tilt up` fails.

The migration goal is to make gateway consume the shared services
instead of running its own. The exact shape depends on three
sub-decisions below. Each can be picked independently, but several
combinations are more coherent than others — see "Recommended composite
paths" at the end.

## Sub-decision 1 — How does the in-cluster gateway pod reach a host-side DynamoDB / Redis?

Today, the gateway pod resolves `wsg-websocket-gateway-redis` and
`wsg-websocket-gateway-dynamodb` (cluster Service objects). With the
chart's redis + dynamodb pods removed, those Service objects need to
point at host-side endpoints, OR the gateway needs to stop running
in-cluster.

| Option | Mechanism | Trade-offs |
|--------|-----------|------------|
| **1A** | `ExternalName` Service objects pointing at `host.docker.internal:{8000,6379}`. Keep Helm chart names + ports stable; switch type from ClusterIP to ExternalName. | Gateway code unchanged. Risk: `host.docker.internal` resolution from inside k3s-on-colima is not Docker-Desktop-equivalent and needs verification. Can fall back to a manual `Service` + `Endpoints` pair pointing at the colima VM gateway IP if DNS fails. |
| **1B** | Static-IP `Service` (no selector) + matching `Endpoints` resource pointing at the host's bridge IP (typically `192.168.5.2` in colima). | Works deterministically. Fragile: host IP can change across colima restarts; requires a `local_resource` in Tiltfile to re-resolve at startup. |
| **1C** | Run gateway as a host-side `npm run dev` process. Tilt only manages social-api (or also runs locally). Gateway talks to `localhost:8000` / `localhost:6379` directly. | Simplest plumbing — no cluster→host DNS hack. Loses k8s semantic parity for gateway in dev. Live-reload model changes (`tilt up` no longer rebuilds the gateway image). |
| **1D** | Don't migrate. Keep in-cluster DDB+Redis. Shared-services pattern applies only to outside-cluster scripts (snapshot-seed, etc.). | Two DDB instances coexist when both are up; port :8000 conflict means only one Tilt port-forward path works. Effectively this means "operator must stop shared services before running gateway's Tilt." Closes most of the migration goal. |

**Recommendation:** 1A if `host.docker.internal` resolves from inside
k3s-on-colima (cheap to verify with a one-line `kubectl run ... busybox
nslookup`); 1B as fallback; 1C only if both DNS paths fail or the
operator explicitly wants to drop in-cluster gateway. 1D is a no-op.

## Sub-decision 2 — Namespace tables in production, or only locally?

Multiple projects sharing one DDB-local need name-prefixed tables to
avoid collisions. The question is whether the prefix lives only in
local-dev wiring, or in production too.

| Option | Where prefix applies | Trade-offs |
|--------|----------------------|------------|
| **2A** | Everywhere — production + local. All 19 tables renamed (`social-profiles` → `gateway_social-profiles`, etc.). | Symmetry between envs. Requires a destructive production data migration: dual-write or alias-and-cutover plan, single-tenant prod with ~19 tables + GSIs. ~3-4 weeks of careful work. Constitution requires a blocker before any production data migration. |
| **2B** | Local-dev only. Add `DDB_TABLE_PREFIX` env var; default `""` in production values, `"gateway_"` in local. App code reads `DDB_TABLE_PREFIX + tableName` everywhere. | ~50-100 LOC across all DDB call sites. Adds one indirection. Production unchanged. Clean for shared-local-services without prod risk. |
| **2C** | Don't namespace. Document a "one project at a time" rule for shared local services; future projects pick non-overlapping table names. | 0 LOC. Fragile: relies on every future project being aware. First collision (e.g., a future project also wants `social-profiles`) is silent data corruption. |

**Recommendation:** 2B. Production is single-tenant and not coordinating
with peer projects, so the prefix earns nothing there. Local dev is
where the collision risk lives, and local-only prefixing solves it
cheaply.

## Sub-decision 3 — Keep Tilt at all for gateway?

Tilt was adopted (via `HELM-TILT-MIGRATION-PLAN.md`) to give local dev
the same k8s shape as production. The shared-services migration is a
moment to revisit whether that's still the right trade.

| Option | Local-dev shape | Trade-offs |
|--------|-----------------|------------|
| **3A** | Keep Tilt for gateway + social-api. Only the redis + dynamodb pods are dropped (per sub-decision 1). | Most continuity: existing Tiltfile mostly survives; only the two infra `k8s_resource` blocks are removed and configmap endpoints are repointed. Live-reload via `live_update` continues to work. |
| **3B** | Drop Tilt entirely. Gateway and social-api both run as host-side `npm run dev` processes. | Simpler shared-services consumption — no cluster-to-host plumbing. Faster reloads (no docker_build round-trip). Loses k8s parity in dev; production deploy path is the only place k8s shape exercised. Throws away the Helm-Tilt migration's sunk cost. |
| **3C** | Hybrid: gateway as host process, social-api in Tilt (or vice versa). | Mixed model — combines 3B's plumbing simplicity for one service with 3A's k8s parity for the other. Two onboarding paths to document. |

**Recommendation:** 3A. The Helm-Tilt migration is recent and load-
bearing for production deploy validation. Dropping it for local-dev
ergonomics gains is a separate decision; conflating it with the
shared-services migration adds risk without proportional benefit.

## Recommended composite paths

The 3 sub-decisions interact. Three coherent end-to-end paths:

### Path α — minimal disruption (RECOMMENDED)

**1A + 2B + 3A.** ExternalName services pointing at host DDB/Redis;
local-only `gateway_` table prefix; Tilt + Helm chart preserved.

- LOC estimate: ~150-200 (chart switches + env-var prefix wiring +
  Tiltfile cleanup + snapshot scripts precondition).
- Risk: medium. Hinges on `host.docker.internal` resolving from k3s.
  Single low-cost probe verifies.
- Reversibility: high. The chart still has `redis.enabled` /
  `dynamodb.enabled` toggles; flip them back to recover the old setup.

### Path β — cleanest plumbing, biggest dev-shape change

**1C + 2B + 3B.** Drop Tilt; gateway + social-api as host processes;
local-only `gateway_` prefix.

- LOC estimate: ~100-150 (mostly delete: Tiltfile, k8s/, chart). But
  also new: a `npm run dev:all` orchestrator script.
- Risk: medium-high. Loses production-shape parity in dev; if a
  k8s-specific bug ships, it'll surface in CI or staging instead of
  caught by a developer's `tilt up`.
- Reversibility: low-ish. Re-adopting Tilt later means redoing the
  Helm-Tilt migration work.

### Path γ — defer migration

**1D + 2C + 3A.** Don't migrate; document "one local stack at a time";
close #95 with a follow-up parked for "revisit when project #2 collides
on a port."

- LOC estimate: ~10 (one paragraph in `prompts/shared-services-pattern.md`
  noting gateway is exempt for now; one log line in `Tiltfile` warning
  if shared services are detected on the same ports).
- Risk: low. Status-quo continues working.
- Reversibility: trivial — pick this up later when the second project
  appears.

## What to ship next

Per the operator's option-B decision, the deliverable for hub#95 is
this scoping doc. The follow-up implementation tasks should be filed
*after* the operator picks a composite path (α / β / γ) — so the next
operator-decision moment is a blocker citing this doc with the three
composite paths as A/B/C button options.

Once a path is picked, follow-up tasks are filed per the steps in that
section above. Estimated 2-4 small tasks per path; each under the
constitution's 200-LOC self-driven cap.
