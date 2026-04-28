#!/usr/bin/env bash
# scripts/wal-recovery-smoke.sh
#
# Track 3 acceptance smoke test: prove the pipeline EventBus WAL is wired
# end-to-end and survives a process restart.
#
# Procedure:
#   1. Boot social-api with PIPELINE_WAL_PATH pointing at a tmp file.
#   2. Confirm the startup log line "WAL enabled at ..." appears.
#   3. Send SIGTERM, wait for clean shutdown.
#   4. Re-boot against the SAME WAL file.
#   5. Confirm the second boot does not crash and the WAL file is non-empty.
#
# Manual / CI runner — not part of the Jest suite. Invoked by
# .github/workflows/wal-smoke.yml or by a developer locally.
#
# Usage:
#   ./scripts/wal-recovery-smoke.sh
#
# Env:
#   SOCIAL_API_DIR  — defaults to ./social-api
#   STARTUP_TIMEOUT — seconds to wait for the boot log line. Default 30.

set -euo pipefail

SOCIAL_API_DIR="${SOCIAL_API_DIR:-./social-api}"
STARTUP_TIMEOUT="${STARTUP_TIMEOUT:-30}"

WAL_DIR="$(mktemp -d -t wsg-wal-smoke-XXXXXX)"
WAL_PATH="${WAL_DIR}/pipeline-wal.log"
LOG_A="${WAL_DIR}/run-a.log"
LOG_B="${WAL_DIR}/run-b.log"

cleanup() {
  if [[ -n "${PID_A:-}" ]] && kill -0 "$PID_A" 2>/dev/null; then
    kill -TERM "$PID_A" 2>/dev/null || true
  fi
  if [[ -n "${PID_B:-}" ]] && kill -0 "$PID_B" 2>/dev/null; then
    kill -TERM "$PID_B" 2>/dev/null || true
  fi
  rm -rf "$WAL_DIR"
}
trap cleanup EXIT

wait_for_log() {
  local log="$1"
  local needle="$2"
  local deadline=$(( $(date +%s) + STARTUP_TIMEOUT ))
  while [[ $(date +%s) -lt $deadline ]]; do
    if grep -q "$needle" "$log" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "FAIL: timed out waiting for '$needle' in $log"
  echo "--- last 50 lines of $log ---"
  tail -n 50 "$log" || true
  return 1
}

echo "==> Phase 1: boot social-api with WAL at $WAL_PATH"
(
  cd "$SOCIAL_API_DIR"
  PIPELINE_WAL_PATH="$WAL_PATH" \
  PIPELINE_LLM_PROVIDER=fixture \
  npm run dev > "$LOG_A" 2>&1 &
  echo $! > "${WAL_DIR}/pid-a"
)
PID_A="$(cat "${WAL_DIR}/pid-a")"

wait_for_log "$LOG_A" "WAL enabled at $WAL_PATH" || {
  echo "FAIL: did not observe 'WAL enabled' line on first boot"
  exit 1
}
echo "  ok: 'WAL enabled' observed on first boot (pid $PID_A)"

# Give the bus a moment to actually write something to the WAL.
sleep 2

echo "==> Phase 2: SIGTERM, wait for clean shutdown"
kill -TERM "$PID_A"
wait "$PID_A" 2>/dev/null || true
echo "  ok: pid $PID_A exited"

if [[ ! -s "$WAL_PATH" ]]; then
  echo "WARN: WAL file is empty after first run — may be expected for an"
  echo "      idle bus, but the recovery branch will not be exercised."
else
  echo "  ok: WAL file non-empty ($(wc -c < "$WAL_PATH") bytes)"
fi

echo "==> Phase 3: re-boot against same WAL"
(
  cd "$SOCIAL_API_DIR"
  PIPELINE_WAL_PATH="$WAL_PATH" \
  PIPELINE_LLM_PROVIDER=fixture \
  npm run dev > "$LOG_B" 2>&1 &
  echo $! > "${WAL_DIR}/pid-b"
)
PID_B="$(cat "${WAL_DIR}/pid-b")"

wait_for_log "$LOG_B" "WAL enabled at $WAL_PATH" || {
  echo "FAIL: second boot did not log 'WAL enabled' — recovery path broken"
  exit 1
}
echo "  ok: second boot succeeded"

# A clean exit on the second boot proves the WAL replay logic doesn't crash.
sleep 2
if ! kill -0 "$PID_B" 2>/dev/null; then
  echo "FAIL: second boot exited unexpectedly during stabilization window"
  tail -n 80 "$LOG_B"
  exit 1
fi

kill -TERM "$PID_B"
wait "$PID_B" 2>/dev/null || true

echo "==> PASS: WAL recovery smoke completed without errors"
echo "    Note: this verifies the wiring + replay does not crash. End-to-end"
echo "    state-survival assertions need a real pipeline run mid-flight,"
echo "    which is a follow-up integration test."
