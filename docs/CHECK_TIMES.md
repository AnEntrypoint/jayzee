# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 170.7 s across 270 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:pose-allocations` | 64103 |  | 2000 warm-up frames of the 1024-player threaded tick, about 21 ms each. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. |
| `check:engine-state-hash-1024` | 14398 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:gc-witness` | 12527 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:scenario-marble-bowl` | 7550 | yes | 512 bodies for 600 ticks, twice, on two tiers. |
| `check:elevation-ab` | 6941 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:height-cpu` | 4575 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:app-watch` | 4567 |  | Waits on real file-watch events. |
| `check:sphere-population` | 4175 |  | Places the full sphere population and checks every member. |
| `check:heightmap-cli` | 3206 |  | Runs the heightmap CLI once per fixture case. |
| `check:engine-threads` | 2332 | yes | Runs the threaded scenario at several worker counts. |
| `check:thread-sampler` | 2059 | yes | Samples real threads over a timed window. |
| `check:mapspinner-atmosphere` | 1926 |  |  |
| `check:alloc-audit` | 1837 |  |  |
| `check:snapshots` | 1543 |  |  |
| `check:scenario-lockstep-rts` | 1356 | yes |  |
| `check:gc-reuse-rows` | 1035 |  |  |
| `check:types` | 1024 |  |  |
| `check:scenario-planet-landing` | 969 | yes |  |
| `check:scenario-projectile-volley` | 955 | yes |  |
| `check:scenario-settle` | 923 | yes |  |
| `check:scenario-character` | 877 | yes |  |
| `check:scenario-deathrun` | 867 | yes |  |
| `check:scenario-boss-fight` | 852 | yes |  |
| `check:create-app` | 835 |  |  |
| `check:upload-writes` | 833 |  |  |
| `check:scenario-combat-bots` | 823 | yes |  |
| `check:wireweave-relay` | 816 |  |  |
| `check:netcode` | 806 |  |  |
| `check:crowd-dot-buffer` | 733 |  |  |
| `check:upload-handler` | 692 |  |  |
| `check:pose-replay` | 655 |  |  |
| `build:kernel` | 606 |  |  |
| `check:terrain-agreement` | 589 |  |  |
| `check:transport` | 583 |  |  |
| `check:planet-witness` | 471 |  |  |
| `check:engine-host-witness` | 461 |  |  |
| `check:project-naming` | 455 |  |  |
| `check:socket-server` | 450 |  |  |
| `check:stall-attribution` | 355 |  |  |
| `check:world-query` | 288 |  |  |
| `check:sharding` | 285 |  |  |
| `check:world` | 284 |  |  |
| `check:kernel` | 279 |  |  |
| `check:world-config` | 274 |  |  |
| `check:physics-pure` | 269 |  |  |
| `check:collision-mirror` | 260 |  |  |
| `check:ccd` | 258 |  |  |
| `check:engine-bridge` | 242 |  |  |
| `check:vehicles-spoint` | 240 |  |  |
| `check:packages` | 238 |  |  |
| `check:sdk-surfaces` | 227 |  |  |
| `check:webgpu-profile` | 226 |  |  |
| `check:physics-integration-vehicles` | 225 |  |  |
| `check:engine-budget-floor` | 197 |  |  |
| `check:dormant-spoint` | 195 |  |  |
| `check:vehicle-refusal-spoint` | 194 |  |  |
| `check:collision-tile-streamer` | 194 |  |  |
| `check:site-world` | 193 |  |  |
| `check:collision-host` | 193 |  |  |
| `check:raycast-spoint` | 191 |  |  |
| `check:overlap-spoint` | 186 |  |  |
| `check:player-lod-renderer` | 186 |  |  |
| `check:dormant-budget-spoint` | 185 |  |  |
| `check:player-vat-spoint` | 185 |  |  |
| `check:vehicle-remove-spoint` | 184 |  |  |
| `check:chart-state-live` | 177 |  |  |
| `check:upstream-builtin-nav` | 175 |  |  |
| `check:player-lod-renderer-webgpu` | 174 |  |  |
| `check:fire` | 171 |  |  |
| `check:recast-bake-spoint` | 167 |  |  |
| `check:player-dot-shader-spoint` | 161 |  |  |
| `check:player-dot-material-spoint` | 157 |  |  |
| `check:bloom-spoint` | 149 |  |  |
| `check:decode-path` | 146 |  |  |
| `check:sample-order` | 140 |  |  |
| `check:terrain-static` | 139 |  |  |
| `check:streamer-p99` | 139 |  |  |
| `check:cluster-lod-spoint` | 138 |  |  |
| `check:terrain-pure` | 137 |  |  |
| `check:scene-setup-spoint` | 137 |  |  |
| `check:streaming-gltf-mesh` | 134 |  |  |
| `check:lockstep` | 134 |  |  |
| `check:fire-modules` | 132 |  |  |
| `check:vat-spoint` | 127 |  |  |
| `check:ssr-spoint` | 121 |  |  |
| `check:spline-erosion-witness` | 117 |  |  |
| `check:timed-result` | 116 |  |  |
| `check:sessions` | 114 |  |  |
| `check:bin-snapshot` | 107 |  |  |
| `check:script-limits` | 107 |  |  |
| `check:fsr1-spoint` | 107 |  |  |
| `check:client-pure` | 103 |  |  |
| `check:chart-anchor` | 102 |  |  |
| `check:socket-upgrade` | 100 |  |  |
| `check:player-collisions` | 98 |  |  |
| `check:lag-compensation` | 97 |  |  |
| `check:client-message-handler` | 97 |  |  |
| `check:import-scene` | 96 |  |  |
| `check:replay-file` | 92 |  |  |
| `check:procgen` | 90 |  |  |
| `check:spoint-core-rust` | 84 |  |  |
| `check:tick-governor` | 81 | yes |  |
| `check:collider-streamer` | 81 |  |  |
| `check:upstream-skill-registry` | 78 |  |  |
| `check:msgpack-packer` | 77 |  |  |
| `check:behaviours` | 75 |  |  |
| `check:protocol-codecs` | 73 |  |  |
| `check:replay-player` | 73 |  |  |
| `check:apps-a` | 73 |  |  |
| `check:vegetation-stream` | 73 |  |  |
| `check:camera-relative` | 73 |  |  |
| `check:snapshot-lod` | 72 |  |  |
| `check:spawn` | 71 |  |  |
| `check:animation-control` | 71 |  |  |
| `check:prediction-engine` | 71 |  |  |
| `check:lod-tiers` | 71 |  |  |
| `check:rollback` | 70 |  |  |
| `check:snapshot-packer` | 70 |  |  |
| `check:aoi` | 68 |  |  |
| `check:upstream-builtin-bodies` | 68 |  |  |
| `check:sdk-misc` | 68 |  |  |
| `check:chart-reanchor` | 67 |  |  |
| `check:protocol` | 66 |  |  |
| `check:msgpackr-compat` | 66 |  |  |
| `check:octree` | 66 |  |  |
| `check:paint-store` | 65 |  |  |
| `check:behaviour-health-destructible` | 65 |  |  |
| `check:upstream-skill-bodies` | 65 |  |  |
| `check:replay-dialect` | 65 |  |  |
| `check:hygiene` | 65 |  |  |
| `check:controlled-run` | 65 |  |  |
| `check:sdk-editor` | 64 |  |  |
| `check:shared-pure` | 64 |  |  |
| `check:chart-migrators` | 64 |  |  |
| `check:netcode-small` | 64 |  |  |
| `check:upload-route` | 64 |  |  |
| `check:entity-host` | 64 |  |  |
| `check:app-loader` | 64 |  |  |
| `check:player-lod-plan` | 64 |  |  |
| `check:hot-reload-spoint` | 64 |  |  |
| `check:game-systems-spoint` | 64 |  |  |
| `check:frame-stall-cause` | 64 |  |  |
| `check:pathfinding` | 63 |  |  |
| `check:streaming-gltf-queues` | 63 |  |  |
| `check:negative-zero` | 63 |  |  |
| `check:engine-artifacts` | 63 |  |  |
| `check:reduced-pose` | 62 |  |  |
| `check:wireweave-frame-spoint` | 62 |  |  |
| `check:stage` | 61 |  |  |
| `check:behaviours-a` | 61 |  |  |
| `check:editor-serialize` | 61 |  |  |
| `check:anticheat-spoint` | 60 |  |  |
| `check:cluster-handoff` | 60 |  |  |
| `check:upstream-door-routes` | 60 |  |  |
| `check:bundle-freshness-jayzee` | 59 |  |  |
| `check:game-systems` | 59 |  |  |
| `check:event-log` | 59 |  |  |
| `check:tick-authority` | 59 |  |  |
| `check:chart-transfer` | 59 |  |  |
| `check:upstream-builtin-noise` | 59 |  |  |
| `check:network-state` | 59 |  |  |
| `check:snapshot-processor` | 58 |  |  |
| `check:telemetry` | 58 |  |  |
| `check:behaviours-c` | 58 |  |  |
| `check:client-pure-rows` | 58 |  |  |
| `check:cluster-slice` | 58 |  |  |
| `check:client-loops` | 57 |  |  |
| `check:feature-gap` | 57 |  |  |
| `check:physics-extras` | 57 |  |  |
| `check:world-persistence` | 57 |  |  |
| `check:clusters` | 57 |  |  |
| `check:upstream-tome-bodies` | 57 |  |  |
| `check:upstream-builtin-physics` | 57 |  |  |
| `check:physics-integration` | 57 |  |  |
| `check:chart-state-server` | 57 |  |  |
| `check:crowd-dot-cells-spoint` | 57 |  |  |
| `check:relative-residuals` | 57 |  |  |
| `check:sandbox` | 56 |  |  |
| `check:transport-framing` | 56 |  |  |
| `check:row16-client-decoder` | 56 |  |  |
| `check:behaviours-b` | 56 |  |  |
| `check:client-tier-split` | 56 |  |  |
| `check:asset-pipeline` | 56 |  |  |
| `check:consensus` | 55 |  |  |
| `check:upstream-builtin-easing` | 55 |  |  |
| `check:upstream-builtin-env` | 55 |  |  |
| `check:world-def-clusters` | 55 |  |  |
| `check:mat4-spoint` | 55 |  |  |
| `check:paired-report` | 55 |  |  |
| `check:frequency-runs` | 55 |  |  |
| `check:tail-report` | 55 |  |  |
| `check:collision-placement` | 55 |  |  |
| `check:pool-params-spoint` | 54 |  |  |
| `check:material-tier-swap-spoint` | 54 |  |  |
| `check:stall-probe` | 54 |  |  |
| `check:spawn-named-errors` | 53 |  |  |
| `check:render` | 53 |  |  |
| `check:apps-b` | 53 |  |  |
| `check:app-runtime-state` | 53 |  |  |
| `check:navmesh-query-spoint` | 53 |  |  |
| `check:stall-off-cpu` | 53 |  |  |
| `check:minidump` | 53 |  |  |
| `check:chromium-launcher` | 53 |  |  |
| `check:anticheat` | 52 |  |  |
| `check:upstream-builtin-lighting` | 52 |  |  |
| `check:client-machines` | 52 |  |  |
| `check:client-pure-spoint` | 52 |  |  |
| `check:animation` | 51 |  |  |
| `check:upstream-tome-lookup` | 51 |  |  |
| `check:upstream-builtins` | 51 |  |  |
| `check:upstream-builtin-voxels` | 51 |  |  |
| `check:camera-rig` | 51 |  |  |
| `check:browser-heap` | 51 |  |  |
| `check:upstream-endpoints` | 50 |  |  |
| `check:hot-reload` | 50 |  |  |
| `check:rollback-bridge` | 50 |  |  |
| `check:named-asset-redirect` | 50 |  |  |
| `check:upstream-builtin-spline` | 50 |  |  |
| `check:upstream-builtin-tween` | 50 |  |  |
| `check:app-behaviours` | 50 |  |  |
| `check:component-pool` | 50 |  |  |
| `check:engine-solver-tier` | 50 |  |  |
| `check:worker-dispatch` | 49 |  |  |
| `check:upstream-tome` | 49 |  |  |
| `check:upstream-skills` | 49 |  |  |
| `check:upstream-builtin-math` | 49 |  |  |
| `check:upstream-reference` | 49 |  |  |
| `check:upstream-builtin-room-routing` | 49 |  |  |
| `check:upstream-builtin-tsl` | 49 |  |  |
| `check:reexpress-records` | 49 |  |  |
| `check:blend-tree-spoint` | 49 |  |  |
| `check:spawn-captured-names` | 49 |  |  |
| `check:sampler-gap-attribution` | 49 |  |  |
| `check:site` | 48 |  |  |
| `check:relocation-solve` | 48 |  |  |
| `check:upstream-doors` | 48 |  |  |
| `check:upstream-door-dispatch` | 48 |  |  |
| `check:upstream-builtin-fx` | 48 |  |  |
| `check:upstream-builtin-path` | 48 |  |  |
| `check:vec3-read` | 48 |  |  |
| `check:player-id` | 48 |  |  |
| `check:content` | 47 |  |  |
| `check:jolt-limits` | 47 |  |  |
| `check:tick-order` | 47 |  |  |
| `check:upstream-builtin-ballistics` | 47 |  |  |
| `check:upstream-builtin-three` | 47 |  |  |
| `check:upstream-builtin-vibe` | 47 |  |  |
| `check:upstream-builtin-water` | 47 |  |  |
| `check:world-resolver` | 47 |  |  |
| `check:postfx-shaders-spoint` | 47 |  |  |
| `check:engine-visibility` | 47 |  |  |
| `check:messages` | 46 |  |  |
| `check:flight-model` | 46 |  |  |
| `check:upstream-builtin-vec3` | 46 |  |  |
| `check:hook-order` | 46 |  |  |
| `check:collider-layers` | 46 |  |  |
| `check:movement` | 45 |  |  |
| `check:vehicle-tuning` | 45 |  |  |
| `check:rollback-peer` | 45 |  |  |
| `check:tick-scheduler` | 45 |  |  |
| `check:worker-bridge` | 45 |  |  |
| `check:heightfield-physics` | 45 |  |  |
| `check:cube-sphere-cell-key-spoint` | 45 |  |  |
| `check:ci-engine-glue` | 45 |  |  |
| `check:spawn-captured-bodies` | 44 |  |  |
| `check:character-step` | 43 |  |  |
| `check:upstream-builtin-postfx` | 43 |  |  |
| `check:upstream-builtin-terrain` | 43 |  |  |
| `check:constraint-limits` | 42 |  |  |
| `check:render-1024-visible` | 42 |  |  |
