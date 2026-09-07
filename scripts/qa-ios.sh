#!/usr/bin/env bash

set -euo pipefail

readonly QA_APP_ID="com.timothykugler.yonder"
readonly QA_DEVICE_NAME="${IOS_QA_DEVICE_NAME:-iPhone 17 Pro}"
readonly QA_MINIMUM_CELL_COUNT="${IOS_QA_MINIMUM_CELL_COUNT:-3}"
readonly QA_OUTPUT_ROOT=".artifacts/ios-qa"
readonly QA_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
readonly QA_OUTPUT_DIR="${QA_OUTPUT_ROOT}/${QA_RUN_ID}"

qa_device_id=""
qa_database_path=""

log() {
  echo "[ios-qa] $*"
}

fail() {
  echo "[ios-qa] error: $*" >&2
  exit 1
}

command -v xcrun >/dev/null || fail "Xcode command-line tools are required."
command -v maestro >/dev/null || fail "Maestro is required. Install it with Homebrew before running this script."
command -v sqlite3 >/dev/null || fail "The sqlite3 command-line tool is required."
command -v curl >/dev/null || fail "curl is required to check Metro."

qa_device_id="$({
  xcrun simctl list devices available
} | awk -v name="$QA_DEVICE_NAME" '
  index($0, name " (") {
    line = $0
    sub(/^[^(]*\(/, "", line)
    sub(/\).*/, "", line)
    print line
    exit
  }
')"

[[ -n "$qa_device_id" ]] || fail "No available simulator named '$QA_DEVICE_NAME' was found."

mkdir -p "$QA_OUTPUT_DIR"

cleanup() {
  if [[ -n "$qa_device_id" ]]; then
    xcrun simctl location "$qa_device_id" clear >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

log "Booting $QA_DEVICE_NAME ($qa_device_id)."
xcrun simctl boot "$qa_device_id" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$qa_device_id" -b

if ! curl --silent --fail --max-time 2 http://127.0.0.1:8081/status | grep -q "packager-status:running"; then
  fail "Metro is not running. Start it with 'npx expo start --dev-client' and rerun this command."
fi

log "Resetting only Yonder's simulator installation."
xcrun simctl uninstall "$qa_device_id" "$QA_APP_ID" >/dev/null 2>&1 || true

log "Building and installing the current native app."
if ! npx expo run:ios --device "$qa_device_id" --no-bundler; then
  if ! xcrun simctl get_app_container "$qa_device_id" "$QA_APP_ID" app >/dev/null 2>&1; then
    fail "The native build did not leave an installed Yonder app."
  fi

  log "Expo's development-URL handoff timed out, but the build installed successfully; continuing with the installed app."
  xcrun simctl launch "$qa_device_id" "$QA_APP_ID" >/dev/null
fi

log "Granting location access inside the isolated simulator."
xcrun simctl privacy "$qa_device_id" grant location-always "$QA_APP_ID"
xcrun simctl location "$qa_device_id" set 52.5163,13.3777

export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

log "Waiting for the native map to become testable."
maestro test \
  --device "$qa_device_id" \
  --test-output-dir "$QA_OUTPUT_DIR/prepare" \
  .maestro/prepare-yonder.yaml

qa_app_container="$(xcrun simctl get_app_container "$qa_device_id" "$QA_APP_ID" data)"
qa_database_path="${qa_app_container}/Documents/SQLite/yonder.db"

log "Driving a synthetic route through central Berlin."
xcrun simctl location "$qa_device_id" start \
  --speed=12 \
  --distance=15 \
  52.5163,13.3777 \
  52.5168,13.3795 \
  52.5174,13.3818 \
  52.5180,13.3842 \
  52.5190,13.3880 \
  52.5200,13.3920 \
  52.5210,13.3960

qa_cell_count=0
for _ in {1..30}; do
  if [[ -f "$qa_database_path" ]]; then
    qa_cell_count="$(sqlite3 "$qa_database_path" "SELECT COUNT(*) FROM unlocked_cells;" 2>/dev/null || echo 0)"
  fi

  if [[ "$qa_cell_count" =~ ^[0-9]+$ ]] && (( qa_cell_count >= QA_MINIMUM_CELL_COUNT )); then
    break
  fi

  sleep 1
done

if ! [[ "$qa_cell_count" =~ ^[0-9]+$ ]] || (( qa_cell_count < QA_MINIMUM_CELL_COUNT )); then
  fail "The synthetic route unlocked ${qa_cell_count} cells; expected at least ${QA_MINIMUM_CELL_COUNT}."
fi

log "Unlocked at least $qa_cell_count cells; capturing the active route."
maestro test \
  --device "$qa_device_id" \
  --test-output-dir "$QA_OUTPUT_DIR/route" \
  .maestro/verify-yonder.yaml

log "Relaunching with a stationary synthetic jitter route to verify persistence."
xcrun simctl location "$qa_device_id" set 52.5163,13.3777
xcrun simctl launch "$qa_device_id" "$QA_APP_ID" >/dev/null
sleep 2
xcrun simctl location "$qa_device_id" start \
  --speed=0.5 \
  --distance=1 \
  52.51630,13.37770 \
  52.51632,13.37772 \
  52.51634,13.37774 \
  52.51636,13.37776 \
  52.51638,13.37778
sleep 2
qa_cell_count="$(sqlite3 "$qa_database_path" "SELECT COUNT(*) FROM unlocked_cells;")"

maestro test \
  --device "$qa_device_id" \
  --test-output-dir "$QA_OUTPUT_DIR/persistence" \
  .maestro/verify-yonder-persistence.yaml

qa_persisted_cell_count="$(sqlite3 "$qa_database_path" "SELECT COUNT(*) FROM unlocked_cells;")"
if (( qa_persisted_cell_count < qa_cell_count )); then
  fail "Cells were lost across relaunch: before=$qa_cell_count after=$qa_persisted_cell_count."
fi

log "Passed with $qa_persisted_cell_count persisted cells."
log "Screenshots and logs: $QA_OUTPUT_DIR"
