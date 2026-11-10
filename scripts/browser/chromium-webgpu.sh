#!/bin/sh
here=$(cd "$(dirname "$0")" && pwd)
root=${WEBGPU_PROJECT_ROOT:-$(cd "$here/../.." && pwd)}
"${NODE:-node}" "$here/webgpu-profile.mjs" "$root" "$@" >&2 || echo "webgpu-profile: seeding failed, starting Chromium without the WebGPU labs" >&2
BREAKPAD_DUMP_LOCATION=${BREAKPAD_DUMP_LOCATION:-$root/.playwriter/crash-dumps}
export BREAKPAD_DUMP_LOCATION
mkdir -p "$BREAKPAD_DUMP_LOCATION"
exec "${WEBGPU_CHROMIUM:-/usr/bin/chromium}" --enable-unsafe-webgpu --enable-features=Vulkan,WebGPUService "$@"
