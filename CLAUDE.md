# websocket-gateway — agent context

WebSocket gateway service. Local-dev via Tilt; consumes shared
backing services (DDB-local + Redis) from
`agent-hub/services/docker-compose.yml`.

**Read `.agent/CONSTITUTION.md` first** — agent's north star and
backlog priorities.

## Workflow conventions

- **Solo project, no PRs.** Stage, commit, push to `main` directly.
- **No destructive ops without explicit ask.**

## Local-dev

- **Tilt auto-detects shared-services mode.** When the shared
  `agent-hub-dynamodb-local` + `agent-hub-redis-local` containers are
  running, Tilt skips spinning up its own and uses them.
- **`DDB_TABLE_PREFIX`** env var when running against shared DDB so
  table names don't collide with other consumers.

## Dependencies

- **`distributed-core`** — local pin via `file:../distributed-core`
  (private). Must be cloned side-by-side.
- **`agent-hub`** — for hub registration when running as an agent.

## Hub coordination

Registered with `agent-hub` as the agent named `websocket-gateway`
(role `app`).
