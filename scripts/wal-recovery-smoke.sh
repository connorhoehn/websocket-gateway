#!/usr/bin/env bash
# scripts/wal-recovery-smoke.sh
#
# WAL recovery smoke test — proves both pipeline WAL surfaces are wired
# end-to-end and survive a process kill + restart.
#
# Two WAL surfaces are exercised in parallel:
#
#   1. PIPELINE_WAL_PATH         — the EventBus WAL (pipeline run events).
#                                  Log line: "WAL enabled at <path>"
#   2. PIPELINE_REGISTRY_WAL_PATH — the ResourceRegistry entity WAL (run
#                                  resource records). Switched on in
#                                  social-api/src/pipeline/bootstrap.ts as
#                                  the production registry mode in
#                                  March 2026; before that the registry was
#                                  always 'memory'.
#                                  Log line: "ResourceRegistry WAL enabled
#                                  at <path>"
#
# Procedure:
#   1. Boot social-api with both WAL paths in a tmpdir.
#   2. Confirm BOTH startup log lines appear.
#   3. Send SIGKILL (simulates an unclean crash, which is what WAL must
#      tolerate; SIGTERM is the easier graceful-shutdown case and would
#      not exercise replay).
#   4. Re-boot against the SAME WAL paths.
#   5. Confirm both log lines re-appear on the second boot — proves the
#      replay path didn't crash on the existing journal.
#   6. Confirm the second process stays alive for a stabilization window.
#
# This is a structural/wiring smoke test, NOT an end-to-end "runs survive"
# test — that needs a triggerable HTTP run with auth + LocalStack DynamoDB
# and is out of scope for a pure shell-script smoke. The registry-WAL
# replay correctness itself is covered by distributed-core's own unit suite
# under WriteAheadLogEntityRegistry; this script is the social-api-side
# guarantee that bootstrap wires that machinery and that BOTH WAL surfaces
# survive a kill -9.
#
# Manual / CI runner — not part of the Jest suite. Invoked by
# .github/workflows/wal-recovery-smoke.yml or by a developer locally.
#
# Usage:
#   ./scripts/wal-recovery-smoke.sh
#
# Env:
#   SOCIAL_API_DIR  — defaults to ./social-api
#   STARTUP_TIMEOUT — seconds to wait for each boot's log lines. Default 60.
#                     Boot is heavy in CI (ts-node-dev cold compile).
#   STABILIZE_SEC   — seconds the second-boot process must remain alive
#                     after the WAL log line appears. Default 3.

set -euo pipefail

SOCIAL_API_DIR="${SOCIAL_API_DIR:-./social-api}"
STARTUP_TIMEOUT="${STARTUP_TIMEOUT:-60}"
STABILIZE_SEC="${STABILIZE_SEC:-3}"

WAL_DIR="$(mktemp -d -t wsg-wal-smoke-XXXXXX)"
EVENTBUS_WAL="${WAL_DIR}/pipeline-wal.log"
REGISTRY_WAL="${WAL_DIR}/pipeline-registry-wal.log"
LOG_A="${WAL_DIR}/run-a.log"
LOG_B="${WAL_DIR}/run-b.log"

# stderr helper — keeps "FAIL:" lines on stderr so a CI runner that surfaces
# only the failing-step's stderr still shows what went wrong.
err() { printf '%s\n' "$*" >&2; }

cleanup() {
  if [[ -n "${PID_A:-}" ]] && kill -0 "$PID_A" 2>/dev/null; then
    kill -KILL "$PID_A" 2>/dev/null || true
  fi
  if [[ -n "${PID_B:-}" ]] && kill -0 "$PID_B" 2>/dev/null; then
    kill -TERM "$PID_B" 2>/dev/null || true
    # Give it a moment, then force.
    sleep 1
    kill -KILL "$PID_B" 2>/dev/null || true
  fi
  rm -rf "$WAL_DIR"
}
trap cleanup EXIT

# Wait for a literal substring to appear in $log within STARTUP_TIMEOUT.
# On timeout, dump the tail of the log to stderr so a CI failure shows the
# actual boot output instead of a bare "timed out".
wait_for_log() {
  local log="$1"
  local needle="$2"
  local label="$3"
  local deadline=$(( $(date +%s) + STARTUP_TIMEOUT ))
  while [[ $(date +%s) -lt $deadline ]]; do
    if grep -qF "$needle" "$log" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  err "FAIL: timed out after ${STARTUP_TIMEOUT}s waiting for [$label]"
  err "      expected substring: $needle"
  err "      log file:           $log"
  err "      --- last 60 lines of $log ---"
  tail -n 60 "$log" >&2 || true
  err "      --- end of log ---"
  return 1
}

# Boot social-api in the background with both WAL paths set. NODE_ENV=production
# is required because the registry WAL resolver short-circuits to 'memory' under
# NODE_ENV=test or with JEST_WORKER_ID set; we set the path explicitly anyway,
# but pinning NODE_ENV avoids any accidental test-mode short-circuit if the
# bootstrap is hardened later. The WAL paths are inside a tmpdir so we never
# write to /var/lib/social-api/.
boot_social_api() {
  local log_file="$1"
  local pid_file="$2"
  (
    cd "$SOCIAL_API_DIR"
    NODE_ENV=production \
    PIPELINE_WAL_PATH="$EVENTBUS_WAL" \
    PIPELINE_REGISTRY_WAL_PATH="$REGISTRY_WAL" \
    PIPELINE_LLM_PROVIDER=fixture \
    PIPELINE_IDENTITY_FILE="${WAL_DIR}/node-identity" \
    npm run dev > "$log_file" 2>&1 &
    echo $! > "$pid_file"
  )
}

echo "==> Phase 1: boot social-api (NODE_ENV=production)"
echo "    EventBus WAL: $EVENTBUS_WAL"
echo "    Registry WAL: $REGISTRY_WAL"
boot_social_api "$LOG_A" "${WAL_DIR}/pid-a"
PID_A="$(cat "${WAL_DIR}/pid-a")"

# Both WAL log lines must appear on first boot. Order between them isn't
# guaranteed by the bootstrap, so we wait for each independently.
wait_for_log "$LOG_A" "WAL enabled at $EVENTBUS_WAL" \
    "EventBus WAL log line on first boot" || exit 1
echo "  ok: 'WAL enabled at <eventbus path>' observed on first boot (pid $PID_A)"

wait_for_log "$LOG_A" "ResourceRegistry WAL enabled at $REGISTRY_WAL" \
    "ResourceRegistry WAL log line on first boot" || exit 1
echo "  ok: 'ResourceRegistry WAL enabled at <registry path>' observed on first boot"

# Brief settle so any post-init writes land on disk before kill -9.
sleep 2

echo "==> Phase 2: SIGKILL (simulate crash)"
kill -KILL "$PID_A"
# `wait` on a SIGKILL'd child returns 137 — that's expected, swallow it.
wait "$PID_A" 2>/dev/null || true
echo "  ok: pid $PID_A killed"

# Both WAL files should now exist on disk. Empty-but-present is acceptable
# (an idle bootstrap may not have flushed anything yet); MISSING is a hard
# fail because that means the WAL path was never even opened.
for path in "$EVENTBUS_WAL" "$REGISTRY_WAL"; do
  if [[ ! -e "$path" ]]; then
    err "FAIL: WAL file missing after first boot — bootstrap never opened it: $path"
    err "--- last 60 lines of $LOG_A ---"
    tail -n 60 "$LOG_A" >&2 || true
    exit 1
  fi
  echo "  ok: WAL file present ($(wc -c < "$path") bytes): $path"
done

echo "==> Phase 3: re-boot against same WAL paths (replay)"
boot_social_api "$LOG_B" "${WAL_DIR}/pid-b"
PID_B="$(cat "${WAL_DIR}/pid-b")"

# A successful re-boot is the proof that WAL replay didn't crash on either
# surface. Both log lines must appear again.
wait_for_log "$LOG_B" "WAL enabled at $EVENTBUS_WAL" \
    "EventBus WAL log line on second boot — replay path may be broken" || exit 1
echo "  ok: 'WAL enabled at <eventbus path>' observed on second boot"

wait_for_log "$LOG_B" "ResourceRegistry WAL enabled at $REGISTRY_WAL" \
    "ResourceRegistry WAL log line on second boot — registry replay broken" || exit 1
echo "  ok: 'ResourceRegistry WAL enabled at <registry path>' observed on second boot"

# Stabilization window — if the replay logic crashes the process AFTER the
# log line lands, the bug looks like a healthy boot. Hold for STABILIZE_SEC
# and re-check liveness.
sleep "$STABILIZE_SEC"
if ! kill -0 "$PID_B" 2>/dev/null; then
  err "FAIL: second boot exited unexpectedly within ${STABILIZE_SEC}s of WAL log line"
  err "      this usually means replay crashed the process post-init"
  err "      --- last 80 lines of $LOG_B ---"
  tail -n 80 "$LOG_B" >&2 || true
  exit 1
fi
echo "  ok: second boot still alive after ${STABILIZE_SEC}s stabilization window"

# Graceful shutdown of the second boot.
kill -TERM "$PID_B"
wait "$PID_B" 2>/dev/null || true

echo "==> PASS: WAL recovery smoke completed"
echo "    EventBus WAL + ResourceRegistry WAL both wired, replay survived SIGKILL"
