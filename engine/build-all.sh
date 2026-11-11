#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
log_dir="$root/build/engine-build-logs"
mkdir -p "$log_dir"
failed=0
for glue in "$here"/out/engine-core-*.mjs; do
  name="$(basename "$glue" .mjs)"
  rest="${name#engine-core-}"
  tier="${rest%%mib*}"
  flags="${rest#*mib}"
  simd=OFF
  case "$flags" in *-simd) simd=ON; flags="${flags%-simd}" ;; esac
  case "$flags" in
    "") variant=fixed ;;
    -leak) variant=leak ;;
    -timed) variant=timed ;;
    -threads) variant=threads ;;
    -timed-threads) variant=threadstimed ;;
    *) echo "$name skipped: no build variant for '$flags'"; continue ;;
  esac
  start=$(date +%s)
  ENGINE_VARIANT="$variant" ENGINE_TIER_MIB="$tier" ENGINE_WASM_SIMD="$simd" bash "$here/build.sh" > "$log_dir/$name.log" 2>&1
  rc=$?
  if [ "$rc" -ne 0 ]; then failed=$((failed + 1)); fi
  echo "$name rc=$rc seconds=$(( $(date +%s) - start ))"
done
echo "BUILD-ALL failed=$failed"
exit "$failed"
