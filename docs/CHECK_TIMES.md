# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 345.4 s across 300 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:pose-allocations` | 75408 |  | 2000 warm-up frames of the 1024-player threaded tick, about 21 ms each. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. |
| `check:engine-tiers` | 63691 |  | 10240 bodies settle for 365 ticks on the fixed 512 MiB build, twice; the carve count after warm-up is the claim. |
| `check:engine-host-witness` | 21804 |  | Compiles the native witness when a source under engine/src or engine/test changed; 0.4 s otherwise. |
| `check:scenario-marble-bowl` | 15665 | yes | 512 marbles for 600 ticks, twice, on four tiers. |
| `check:gc-witness` | 14116 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:engine-state-hash-1024` | 12655 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-determinism` | 10861 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:elevation-ab` | 9167 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:engine-job-wait` | 8369 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:alloc-audit` | 5873 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:height-cpu` | 5729 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:sphere-population` | 5252 |  | Places the full sphere population and checks every member. |
| `check:app-watch` | 4581 |  | Waits on real file-watch events. |
| `check:heightmap-cli` | 4198 |  | Runs the heightmap CLI once per fixture case. |
| `check:planet-witness-scene` | 3944 |  | Builds the witness scene three times on the 1024-tier engine and runs one camera lap. |
| `check:vegetation-allocations` | 3707 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:scenario-allocations` | 3485 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:scenario-lockstep-rts` | 3384 | yes | Six peers per tier on four tiers. |
| `check:engine-threads` | 3375 | yes | Runs the threaded scenario at several worker counts. |
| `check:scenario-deathrun` | 3366 | yes | Six runs per tier on four tiers. |
| `check:scenario-boss-fight` | 3256 | yes | Six runs per tier on four tiers. |
| `check:scenario-character-terrain` | 2874 | yes | Four tiers of slope, step and descent runs with their controls. |
| `check:scenario-combat-bots` | 2776 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:vegetation-generate-cost` | 2623 |  | Times 512 patches of 1024 instances and 128 patches of 8439. |
| `check:mapspinner-atmosphere` | 2195 |  | Integrates the atmosphere tables against spoint values. |
| `check:scenario-planet-landing` | 2195 | yes | Two runs of 480 ticks on four tiers. |
| `check:thread-sampler` | 2098 | yes | Samples real threads over a timed window. |
| `check:scenario-projectile-volley` | 1884 | yes |  |
| `check:snapshots` | 1565 |  |  |
| `check:scenario-settle` | 1529 | yes |  |
| `check:planet-scene-counts` | 1425 |  |  |
| `check:types` | 1377 |  |  |
| `check:scenario-character` | 1194 | yes |  |
| `check:engine-seal` | 1157 |  |  |
| `check:gc-reuse-rows` | 1108 |  |  |
| `check:engine-raycast` | 1065 |  |  |
| `check:engine-shapecast` | 1042 |  |  |
| `check:planet-witness` | 898 |  |  |
| `check:netcode` | 890 |  |  |
| `check:create-app` | 828 |  |  |
| `check:upload-writes` | 819 |  |  |
| `check:wireweave-relay` | 811 |  |  |
| `build:kernel` | 798 |  |  |
| `check:upload-handler` | 729 |  |  |
| `check:crowd-dot-buffer` | 701 |  |  |
| `check:pose-replay` | 688 |  |  |
| `check:terrain-agreement` | 635 |  |  |
| `check:transport` | 623 |  |  |
| `check:engine-pools` | 598 |  |  |
| `check:socket-server` | 528 |  |  |
| `check:ci-engine-glue` | 444 |  |  |
| `check:stall-attribution` | 363 |  |  |
| `check:project-naming` | 344 |  |  |
| `check:engine-world` | 340 |  |  |
| `check:site-world` | 329 |  |  |
| `check:physics-pure` | 323 |  |  |
| `check:collision-placement-options` | 323 |  |  |
| `check:ccd` | 318 |  |  |
| `check:engine-vegetation` | 313 |  |  |
| `check:world` | 307 |  |  |
| `check:sharding` | 307 |  |  |
| `check:world-config` | 301 |  |  |
| `check:world-query` | 290 |  |  |
| `check:engine-materials` | 286 |  |  |
| `check:kernel` | 272 |  |  |
| `check:engine-bridge` | 271 |  |  |
| `check:collision-mirror` | 258 |  |  |
| `check:sdk-surfaces` | 251 |  |  |
| `check:packages` | 249 |  |  |
| `check:physics-integration-vehicles` | 248 |  |  |
| `check:vehicles-spoint` | 243 |  |  |
| `check:webgpu-profile` | 232 |  |  |
| `check:engine-planet` | 218 |  |  |
| `check:collision-tile-streamer` | 210 |  |  |
| `check:dormant-budget-spoint` | 206 |  |  |
| `check:overlap-spoint` | 205 |  |  |
| `check:dormant-spoint` | 200 |  |  |
| `check:collision-host` | 199 |  |  |
| `check:raycast-spoint` | 196 |  |  |
| `check:engine-budget-floor` | 196 |  |  |
| `check:engine-sleep` | 196 |  |  |
| `check:vehicle-remove-spoint` | 194 |  |  |
| `check:chart-state-live` | 193 |  |  |
| `check:fire` | 191 |  |  |
| `check:player-vat-spoint` | 191 |  |  |
| `check:vehicle-refusal-spoint` | 189 |  |  |
| `check:player-lod-renderer` | 185 |  |  |
| `check:player-lod-renderer-webgpu` | 184 |  |  |
| `check:rebase-session` | 181 |  |  |
| `check:recast-bake-spoint` | 176 |  |  |
| `check:player-dot-material-spoint` | 165 |  |  |
| `check:player-dot-shader-spoint` | 164 |  |  |
| `check:streaming-gltf-mesh` | 155 |  |  |
| `check:bloom-spoint` | 154 |  |  |
| `check:upstream-builtin-nav` | 148 |  |  |
| `check:camera-relative` | 148 |  |  |
| `check:decode-path` | 147 |  |  |
| `check:terrain-static` | 145 |  |  |
| `check:cluster-lod-spoint` | 145 |  |  |
| `check:streamer-p99` | 145 |  |  |
| `check:procgen` | 143 |  |  |
| `check:scene-setup-spoint` | 142 |  |  |
| `check:client-pure` | 141 |  |  |
| `check:hygiene` | 133 |  |  |
| `check:fire-modules` | 132 |  |  |
| `check:vat-spoint` | 131 |  |  |
| `check:engine-leak` | 129 |  |  |
| `check:tick-governor` | 128 | yes |  |
| `check:vegetation-leaf-patches` | 127 |  |  |
| `check:spline-erosion-witness` | 126 |  |  |
| `check:terrain-pure` | 125 |  |  |
| `check:lockstep` | 124 |  |  |
| `check:follow-misuse` | 124 |  |  |
| `check:spawn-named-errors` | 123 |  |  |
| `check:timed-result` | 122 |  |  |
| `check:engine-codecs` | 120 |  |  |
| `check:chart-anchor` | 119 |  |  |
| `check:engine-interest` | 118 |  |  |
| `check:engine-core` | 113 |  |  |
| `check:glue-tier` | 111 |  |  |
| `check:msgpackr-compat` | 109 |  |  |
| `check:ssr-spoint` | 109 |  |  |
| `check:socket-upgrade` | 109 |  |  |
| `check:sample-order` | 109 |  |  |
| `check:client-resource-pools` | 109 |  |  |
| `check:script-limits` | 106 |  |  |
| `check:sessions` | 105 |  |  |
| `check:protocol-codecs` | 103 |  |  |
| `check:import-scene` | 101 |  |  |
| `check:site` | 100 |  |  |
| `check:bin-snapshot` | 100 |  |  |
| `check:fsr1-spoint` | 99 |  |  |
| `check:engine-render` | 99 |  |  |
| `check:consensus` | 98 |  |  |
| `check:game-systems` | 95 |  |  |
| `check:spoint-core-rust` | 93 |  |  |
| `check:replay-file` | 92 |  |  |
| `check:upload-route` | 90 |  |  |
| `check:msgpack-packer` | 90 |  |  |
| `check:player-collisions` | 88 |  |  |
| `check:behaviours` | 87 |  |  |
| `check:snapshot-lod` | 87 |  |  |
| `check:sdk-editor` | 87 |  |  |
| `check:lag-compensation` | 86 |  |  |
| `check:protocol` | 85 |  |  |
| `check:world-persistence` | 83 |  |  |
| `check:upstream-skill-registry` | 82 |  |  |
| `check:lod-tiers` | 82 |  |  |
| `check:spawn` | 81 |  |  |
| `check:behaviour-health-destructible` | 81 |  |  |
| `check:sdk-misc` | 81 |  |  |
| `check:entity-host` | 81 |  |  |
| `check:replay-dialect` | 81 |  |  |
| `check:replay-player` | 80 |  |  |
| `check:animation-control` | 80 |  |  |
| `check:snapshot-packer` | 80 |  |  |
| `check:collider-streamer` | 80 |  |  |
| `check:hot-reload-spoint` | 80 |  |  |
| `check:frame-stall-cause` | 80 |  |  |
| `check:prediction-engine` | 79 |  |  |
| `check:chart-migrators` | 79 |  |  |
| `check:client-message-handler` | 79 |  |  |
| `check:octree` | 78 |  |  |
| `check:rollback` | 78 |  |  |
| `check:netcode-small` | 78 |  |  |
| `check:negative-zero` | 78 |  |  |
| `check:cluster-slice` | 78 |  |  |
| `check:chart-reanchor` | 77 |  |  |
| `check:player-lod-plan` | 77 |  |  |
| `check:tick-authority` | 76 |  |  |
| `check:shared-pure` | 76 |  |  |
| `check:reduced-pose` | 76 |  |  |
| `check:wireweave-frame-spoint` | 75 |  |  |
| `check:aoi` | 74 |  |  |
| `check:upstream-skill-bodies` | 74 |  |  |
| `check:behaviours-c` | 74 |  |  |
| `check:snapshot-processor` | 73 |  |  |
| `check:paint-store` | 72 |  |  |
| `check:client-pure-rows` | 72 |  |  |
| `check:controlled-run` | 72 |  |  |
| `check:streaming-gltf-queues` | 71 |  |  |
| `check:telemetry` | 71 |  |  |
| `check:upstream-builtin-bodies` | 71 |  |  |
| `check:chart-state-server` | 71 |  |  |
| `check:pathfinding` | 70 |  |  |
| `check:bundle-freshness-jayzee` | 69 |  |  |
| `check:behaviours-a` | 69 |  |  |
| `check:behaviours-b` | 69 |  |  |
| `check:app-loader` | 69 |  |  |
| `check:cluster-handoff` | 68 |  |  |
| `check:apps-a` | 67 |  |  |
| `check:client-machines` | 67 |  |  |
| `check:client-tier-split` | 66 |  |  |
| `check:game-systems-spoint` | 66 |  |  |
| `check:engine-artifacts` | 66 |  |  |
| `check:vegetation-stream` | 65 |  |  |
| `check:event-log` | 64 |  |  |
| `check:chart-transfer` | 64 |  |  |
| `check:mat4-spoint` | 64 |  |  |
| `check:stall-probe` | 63 |  |  |
| `check:stage` | 62 |  |  |
| `check:upstream-tome-bodies` | 61 |  |  |
| `check:upstream-builtin-easing` | 61 |  |  |
| `check:apps-b` | 61 |  |  |
| `check:paired-report` | 61 |  |  |
| `check:upstream-builtin-env` | 60 |  |  |
| `check:crowd-dot-cells-spoint` | 60 |  |  |
| `check:feature-gap` | 59 |  |  |
| `check:editor-serialize` | 59 |  |  |
| `check:engine-visibility` | 59 |  |  |
| `check:anticheat-spoint` | 58 |  |  |
| `check:client-loops` | 57 |  |  |
| `check:upstream-builtin-noise` | 57 |  |  |
| `check:upstream-builtin-tsl` | 57 |  |  |
| `check:app-behaviours` | 57 |  |  |
| `check:physics-integration` | 57 |  |  |
| `check:render` | 56 |  |  |
| `check:physics-extras` | 56 |  |  |
| `check:clusters` | 56 |  |  |
| `check:row16-client-decoder` | 56 |  |  |
| `check:upstream-door-routes` | 56 |  |  |
| `check:upstream-builtin-physics` | 56 |  |  |
| `check:upstream-builtin-tween` | 56 |  |  |
| `check:app-runtime-state` | 56 |  |  |
| `check:camera-rig` | 56 |  |  |
| `check:stall-off-cpu` | 56 |  |  |
| `check:upstream-tome-lookup` | 55 |  |  |
| `check:upstream-builtin-lighting` | 55 |  |  |
| `check:upstream-builtin-spline` | 55 |  |  |
| `check:client-pure-spoint` | 55 |  |  |
| `check:sampler-gap-attribution` | 55 |  |  |
| `check:frequency-runs` | 55 |  |  |
| `check:browser-heap` | 55 |  |  |
| `check:minidump` | 55 |  |  |
| `check:sandbox` | 54 |  |  |
| `check:rollback-bridge` | 54 |  |  |
| `check:upstream-door-dispatch` | 54 |  |  |
| `check:upstream-reference` | 54 |  |  |
| `check:upstream-builtin-voxels` | 54 |  |  |
| `check:network-state` | 54 |  |  |
| `check:navmesh-query-spoint` | 54 |  |  |
| `check:upstream-builtin-vec3` | 53 |  |  |
| `check:world-def-clusters` | 53 |  |  |
| `check:component-pool` | 53 |  |  |
| `check:anticheat` | 52 |  |  |
| `check:jolt-limits` | 52 |  |  |
| `check:upstream-doors` | 52 |  |  |
| `check:upstream-builtin-vibe` | 52 |  |  |
| `check:player-id` | 52 |  |  |
| `check:spawn-captured-names` | 52 |  |  |
| `check:collision-placement` | 52 |  |  |
| `check:pool-params-spoint` | 51 |  |  |
| `check:material-tier-swap-spoint` | 51 |  |  |
| `check:asset-pipeline` | 51 |  |  |
| `check:engine-solver-tier` | 51 |  |  |
| `check:tail-report` | 51 |  |  |
| `check:relative-residuals` | 51 |  |  |
| `check:upstream-endpoints` | 50 |  |  |
| `check:flight-model` | 50 |  |  |
| `check:tick-scheduler` | 50 |  |  |
| `check:upstream-skills` | 50 |  |  |
| `check:upstream-builtin-three` | 50 |  |  |
| `check:reexpress-records` | 50 |  |  |
| `check:transport-framing` | 49 |  |  |
| `check:hot-reload` | 49 |  |  |
| `check:animation` | 49 |  |  |
| `check:constraint-limits` | 49 |  |  |
| `check:upstream-builtins` | 49 |  |  |
| `check:hook-order` | 49 |  |  |
| `check:upstream-builtin-fx` | 49 |  |  |
| `check:upstream-builtin-room-routing` | 49 |  |  |
| `check:upstream-builtin-water` | 49 |  |  |
| `check:world-resolver` | 49 |  |  |
| `check:postfx-shaders-spoint` | 49 |  |  |
| `check:spawn-captured-bodies` | 49 |  |  |
| `check:engine-isolation` | 49 |  |  |
| `check:messages` | 48 |  |  |
| `check:content` | 48 |  |  |
| `check:movement` | 48 |  |  |
| `check:rollback-peer` | 48 |  |  |
| `check:upstream-builtin-math` | 48 |  |  |
| `check:upstream-builtin-path` | 48 |  |  |
| `check:upstream-builtin-terrain` | 48 |  |  |
| `check:vec3-read` | 48 |  |  |
| `check:worker-dispatch` | 47 |  |  |
| `check:blend-tree-spoint` | 47 |  |  |
| `check:chromium-launcher` | 47 |  |  |
| `check:tick-order` | 46 |  |  |
| `check:relocation-solve` | 46 |  |  |
| `check:heightfield-physics` | 46 |  |  |
| `check:upstream-builtin-postfx` | 46 |  |  |
| `check:cube-sphere-cell-key-spoint` | 46 |  |  |
| `check:collider-layers` | 46 |  |  |
| `check:character-step` | 45 |  |  |
| `check:vehicle-tuning` | 45 |  |  |
| `check:named-asset-redirect` | 45 |  |  |
| `check:upstream-builtin-ballistics` | 45 |  |  |
| `check:render-1024-visible` | 45 |  |  |
| `check:upstream-tome` | 43 |  |  |
| `check:worker-bridge` | 42 |  |  |
