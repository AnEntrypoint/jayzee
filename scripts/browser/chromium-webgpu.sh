#!/bin/sh
here=$(cd "$(dirname "$0")" && pwd)
root=${WEBGPU_PROJECT_ROOT:-$(cd "$here/../.." && pwd)}
"${NODE:-node}" "$here/webgpu-profile.mjs" "$root" "$@" >&2 || echo "webgpu-profile: seeding failed, starting Chromium without the WebGPU labs" >&2
exec "${WEBGPU_CHROMIUM:-/usr/bin/chromium}" "$@"
