# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 295.9 s across 300 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:engine-host-witness` | 31907 |  | Compiles the native witness when a source under engine/src or engine/test changed; 0.4 s otherwise. |
| `check:gc-witness` | 25193 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:scenario-marble-bowl` | 21022 | yes | 512 marbles for 600 ticks, twice, on four tiers. |
| `check:engine-state-hash-1024` | 20744 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:pose-allocations` | 15993 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:scenario-determinism` | 14338 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:elevation-ab` | 12898 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:engine-job-wait` | 10892 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:height-cpu` | 7770 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:alloc-audit` | 7120 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:sphere-population` | 6729 |  | Places the full sphere population and checks every member. |
| `check:heightmap-cli` | 5510 |  | Runs the heightmap CLI once per fixture case. |
| `check:engine-tiers` | 4987 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:app-watch` | 4620 |  | Waits on real file-watch events. |
| `check:vegetation-allocations` | 4519 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:planet-witness-scene` | 4221 |  | Builds the witness scene three times on the 1024-tier engine and runs one camera lap. |
| `check:scenario-allocations` | 3628 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:vegetation-generate-cost` | 3604 |  | Times 512 patches of 1024 instances and 128 patches of 8439. |
| `check:scenario-lockstep-rts` | 3601 | yes | Six peers per tier on four tiers. |
| `check:mapspinner-atmosphere` | 3496 |  | Integrates the atmosphere tables against spoint values. |
| `check:scenario-deathrun` | 3417 | yes | Six runs per tier on four tiers. |
| `check:scenario-boss-fight` | 3217 | yes | Six runs per tier on four tiers. |
| `check:engine-threads` | 3070 | yes | Runs the threaded scenario at several worker counts. |
| `check:scenario-combat-bots` | 3054 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:snapshots` | 2551 |  | Encodes and decodes the delta history at full depth. |
| `check:create-app` | 2203 |  | NO REASON RECORDED |
| `check:netcode` | 2149 |  | NO REASON RECORDED |
| `check:thread-sampler` | 2074 | yes | Samples real threads over a timed window. |
| `check:wireweave-relay` | 2000 |  |  |
| `check:scenario-character-terrain` | 1901 | yes |  |
| `check:types` | 1714 |  |  |
| `check:scenario-projectile-volley` | 1633 | yes |  |
| `check:planet-scene-counts` | 1527 |  |  |
| `check:scenario-planet-landing` | 1448 | yes |  |
| `check:scenario-settle` | 1431 | yes |  |
| `check:gc-reuse-rows` | 1422 |  |  |
| `check:engine-raycast` | 1379 |  |  |
| `check:engine-seal` | 1349 |  |  |
| `check:engine-shapecast` | 1305 |  |  |
| `check:upload-writes` | 1145 |  |  |
| `check:scenario-character` | 1108 | yes |  |
| `check:upload-handler` | 1068 |  |  |
| `check:pose-replay` | 1063 |  |  |
| `check:transport` | 1025 |  |  |
| `check:terrain-agreement` | 983 |  |  |
| `check:crowd-dot-buffer` | 938 |  |  |
| `check:planet-witness` | 840 |  |  |
| `check:engine-pools` | 819 |  |  |
| `build:kernel` | 768 |  |  |
| `check:socket-server` | 638 |  |  |
| `check:sharding` | 587 |  |  |
| `check:ci-engine-glue` | 575 |  |  |
| `check:collision-placement-options` | 472 |  |  |
| `check:world-query` | 421 |  |  |
| `check:project-naming` | 418 |  |  |
| `check:world` | 417 |  |  |
| `check:engine-vegetation` | 411 |  |  |
| `check:physics-pure` | 400 |  |  |
| `check:kernel` | 398 |  |  |
| `check:world-config` | 394 |  |  |
| `check:engine-world` | 393 |  |  |
| `check:stall-attribution` | 385 |  |  |
| `check:ccd` | 381 |  |  |
| `check:engine-materials` | 378 |  |  |
| `check:engine-bridge` | 354 |  |  |
| `check:vehicles-spoint` | 341 |  |  |
| `check:collision-mirror` | 313 |  |  |
| `check:packages` | 311 |  |  |
| `check:webgpu-profile` | 310 |  |  |
| `check:physics-integration-vehicles` | 307 |  |  |
| `check:sdk-surfaces` | 300 |  |  |
| `check:dormant-spoint` | 298 |  |  |
| `check:vehicle-remove-spoint` | 297 |  |  |
| `check:engine-planet` | 287 |  |  |
| `check:chart-state-live` | 286 |  |  |
| `check:raycast-spoint` | 284 |  |  |
| `check:collision-host` | 275 |  |  |
| `check:collision-tile-streamer` | 273 |  |  |
| `check:rebase-session` | 270 |  |  |
| `check:engine-sleep` | 269 |  |  |
| `check:overlap-spoint` | 261 |  |  |
| `check:dormant-budget-spoint` | 258 |  |  |
| `check:player-lod-renderer` | 256 |  |  |
| `check:site-world` | 255 |  |  |
| `check:vehicle-refusal-spoint` | 253 |  |  |
| `check:player-vat-spoint` | 253 |  |  |
| `check:fire` | 251 |  |  |
| `check:engine-budget-floor` | 251 |  |  |
| `check:player-lod-renderer-webgpu` | 240 |  |  |
| `check:recast-bake-spoint` | 240 |  |  |
| `check:bloom-spoint` | 231 |  |  |
| `check:player-dot-shader-spoint` | 214 |  |  |
| `check:player-dot-material-spoint` | 214 |  |  |
| `check:cluster-lod-spoint` | 214 |  |  |
| `check:streamer-p99` | 214 |  |  |
| `check:camera-relative` | 210 |  |  |
| `check:upstream-builtin-nav` | 198 |  |  |
| `check:decode-path` | 196 |  |  |
| `check:streaming-gltf-mesh` | 193 |  |  |
| `check:terrain-static` | 185 |  |  |
| `check:scene-setup-spoint` | 185 |  |  |
| `check:vegetation-leaf-patches` | 175 |  |  |
| `check:lockstep` | 173 |  |  |
| `check:engine-codecs` | 171 |  |  |
| `check:engine-leak` | 171 |  |  |
| `check:fire-modules` | 165 |  |  |
| `check:bin-snapshot` | 160 |  |  |
| `check:engine-interest` | 160 |  |  |
| `check:chart-anchor` | 159 |  |  |
| `check:ssr-spoint` | 158 |  |  |
| `check:terrain-pure` | 156 |  |  |
| `check:vat-spoint` | 156 |  |  |
| `check:lod-tiers` | 156 |  |  |
| `check:sample-order` | 155 |  |  |
| `check:script-limits` | 153 |  |  |
| `check:client-resource-pools` | 152 |  |  |
| `check:follow-misuse` | 151 |  |  |
| `check:sessions` | 147 |  |  |
| `check:engine-core` | 147 |  |  |
| `check:behaviours` | 146 |  |  |
| `check:upstream-skill-registry` | 145 |  |  |
| `check:player-collisions` | 144 |  |  |
| `check:replay-player` | 143 |  |  |
| `check:fsr1-spoint` | 143 |  |  |
| `check:glue-tier` | 143 |  |  |
| `check:replay-file` | 142 |  |  |
| `check:socket-upgrade` | 142 |  |  |
| `check:snapshot-lod` | 140 |  |  |
| `check:client-message-handler` | 140 |  |  |
| `check:rollback` | 139 |  |  |
| `check:behaviour-health-destructible` | 139 |  |  |
| `check:spoint-core-rust` | 139 |  |  |
| `check:netcode-small` | 138 |  |  |
| `check:timed-result` | 138 |  |  |
| `check:procgen` | 136 |  |  |
| `check:reduced-pose` | 136 |  |  |
| `check:protocol-codecs` | 135 |  |  |
| `check:spline-erosion-witness` | 135 |  |  |
| `check:sdk-misc` | 135 |  |  |
| `check:client-pure` | 134 |  |  |
| `check:lag-compensation` | 133 |  |  |
| `check:vegetation-stream` | 132 |  |  |
| `check:prediction-engine` | 131 |  |  |
| `check:snapshot-packer` | 131 |  |  |
| `check:collider-streamer` | 131 |  |  |
| `check:animation-control` | 128 |  |  |
| `check:engine-render` | 127 |  |  |
| `check:frame-stall-cause` | 125 |  |  |
| `check:import-scene` | 120 |  |  |
| `check:protocol` | 119 |  |  |
| `check:player-lod-plan` | 117 |  |  |
| `check:msgpack-packer` | 115 |  |  |
| `check:spawn` | 111 |  |  |
| `check:hygiene` | 107 |  |  |
| `check:msgpackr-compat` | 106 |  |  |
| `check:upstream-builtin-bodies` | 106 |  |  |
| `check:app-loader` | 105 |  |  |
| `check:replay-dialect` | 105 |  |  |
| `check:game-systems-spoint` | 102 |  |  |
| `check:cluster-handoff` | 101 |  |  |
| `check:entity-host` | 100 |  |  |
| `check:hot-reload-spoint` | 100 |  |  |
| `check:mat4-spoint` | 100 |  |  |
| `check:engine-artifacts` | 100 |  |  |
| `check:tick-governor` | 98 | yes |  |
| `check:tick-authority` | 98 |  |  |
| `check:controlled-run` | 98 |  |  |
| `check:behaviours-a` | 97 |  |  |
| `check:streaming-gltf-queues` | 96 |  |  |
| `check:paint-store` | 95 |  |  |
| `check:upload-route` | 95 |  |  |
| `check:negative-zero` | 95 |  |  |
| `check:chart-reanchor` | 94 |  |  |
| `check:upstream-skill-bodies` | 94 |  |  |
| `check:chart-migrators` | 94 |  |  |
| `check:wireweave-frame-spoint` | 94 |  |  |
| `check:game-systems` | 93 |  |  |
| `check:shared-pure` | 92 |  |  |
| `check:pathfinding` | 91 |  |  |
| `check:sdk-editor` | 91 |  |  |
| `check:behaviours-c` | 91 |  |  |
| `check:paired-report` | 91 |  |  |
| `check:apps-b` | 89 |  |  |
| `check:cluster-slice` | 89 |  |  |
| `check:client-pure-rows` | 88 |  |  |
| `check:aoi` | 86 |  |  |
| `check:event-log` | 86 |  |  |
| `check:stage` | 84 |  |  |
| `check:snapshot-processor` | 84 |  |  |
| `check:apps-a` | 83 |  |  |
| `check:octree` | 82 |  |  |
| `check:clusters` | 82 |  |  |
| `check:spawn-named-errors` | 81 |  |  |
| `check:feature-gap` | 81 |  |  |
| `check:chart-state-server` | 81 |  |  |
| `check:site` | 80 |  |  |
| `check:behaviours-b` | 80 |  |  |
| `check:world-persistence` | 79 |  |  |
| `check:upstream-door-routes` | 79 |  |  |
| `check:client-machines` | 79 |  |  |
| `check:bundle-freshness-jayzee` | 78 |  |  |
| `check:row16-client-decoder` | 78 |  |  |
| `check:physics-integration` | 78 |  |  |
| `check:telemetry` | 76 |  |  |
| `check:upstream-builtin-lighting` | 76 |  |  |
| `check:vec3-read` | 76 |  |  |
| `check:client-loops` | 75 |  |  |
| `check:chart-transfer` | 75 |  |  |
| `check:upstream-builtin-physics` | 75 |  |  |
| `check:editor-serialize` | 75 |  |  |
| `check:anticheat-spoint` | 74 |  |  |
| `check:hook-order` | 74 |  |  |
| `check:reexpress-records` | 74 |  |  |
| `check:frequency-runs` | 74 |  |  |
| `check:minidump` | 74 |  |  |
| `check:upstream-doors` | 73 |  |  |
| `check:client-tier-split` | 73 |  |  |
| `check:sampler-gap-attribution` | 73 |  |  |
| `check:tail-report` | 73 |  |  |
| `check:spawn-captured-names` | 72 |  |  |
| `check:render` | 71 |  |  |
| `check:consensus` | 71 |  |  |
| `check:upstream-tome-lookup` | 71 |  |  |
| `check:upstream-reference` | 71 |  |  |
| `check:app-behaviours` | 71 |  |  |
| `check:app-runtime-state` | 71 |  |  |
| `check:network-state` | 71 |  |  |
| `check:upstream-endpoints` | 70 |  |  |
| `check:transport-framing` | 70 |  |  |
| `check:upstream-tome-bodies` | 70 |  |  |
| `check:pool-params-spoint` | 70 |  |  |
| `check:physics-extras` | 69 |  |  |
| `check:upstream-builtin-noise` | 69 |  |  |
| `check:camera-rig` | 69 |  |  |
| `check:stall-probe` | 69 |  |  |
| `check:stall-off-cpu` | 69 |  |  |
| `check:relative-residuals` | 69 |  |  |
| `check:upstream-builtin-easing` | 68 |  |  |
| `check:upstream-builtin-voxels` | 68 |  |  |
| `check:collision-placement` | 68 |  |  |
| `check:sandbox` | 67 |  |  |
| `check:upstream-door-dispatch` | 67 |  |  |
| `check:upstream-builtin-three` | 67 |  |  |
| `check:component-pool` | 67 |  |  |
| `check:rollback-bridge` | 66 |  |  |
| `check:client-pure-spoint` | 66 |  |  |
| `check:browser-heap` | 66 |  |  |
| `check:heightfield-physics` | 65 |  |  |
| `check:navmesh-query-spoint` | 65 |  |  |
| `check:material-tier-swap-spoint` | 65 |  |  |
| `check:tick-scheduler` | 64 |  |  |
| `check:upstream-skills` | 64 |  |  |
| `check:cube-sphere-cell-key-spoint` | 64 |  |  |
| `check:messages` | 63 |  |  |
| `check:worker-dispatch` | 63 |  |  |
| `check:upstream-builtin-path` | 63 |  |  |
| `check:upstream-builtin-tsl` | 63 |  |  |
| `check:player-id` | 63 |  |  |
| `check:crowd-dot-cells-spoint` | 63 |  |  |
| `check:asset-pipeline` | 63 |  |  |
| `check:engine-visibility` | 63 |  |  |
| `check:content` | 62 |  |  |
| `check:upstream-builtin-vec3` | 62 |  |  |
| `check:upstream-builtin-env` | 62 |  |  |
| `check:upstream-builtin-fx` | 62 |  |  |
| `check:upstream-builtin-tween` | 62 |  |  |
| `check:upstream-builtin-water` | 62 |  |  |
| `check:hot-reload` | 61 |  |  |
| `check:animation` | 61 |  |  |
| `check:upstream-builtin-ballistics` | 61 |  |  |
| `check:upstream-builtin-vibe` | 61 |  |  |
| `check:world-def-clusters` | 61 |  |  |
| `check:postfx-shaders-spoint` | 61 |  |  |
| `check:blend-tree-spoint` | 61 |  |  |
| `check:render-1024-visible` | 61 |  |  |
| `check:engine-isolation` | 61 |  |  |
| `check:anticheat` | 60 |  |  |
| `check:upstream-tome` | 60 |  |  |
| `check:upstream-builtin-math` | 60 |  |  |
| `check:collider-layers` | 60 |  |  |
| `check:character-step` | 59 |  |  |
| `check:constraint-limits` | 59 |  |  |
| `check:movement` | 59 |  |  |
| `check:tick-order` | 59 |  |  |
| `check:upstream-builtins` | 59 |  |  |
| `check:world-resolver` | 59 |  |  |
| `check:spawn-captured-bodies` | 59 |  |  |
| `check:engine-solver-tier` | 59 |  |  |
| `check:flight-model` | 58 |  |  |
| `check:jolt-limits` | 58 |  |  |
| `check:rollback-peer` | 58 |  |  |
| `check:worker-bridge` | 58 |  |  |
| `check:named-asset-redirect` | 58 |  |  |
| `check:upstream-builtin-spline` | 58 |  |  |
| `check:upstream-builtin-postfx` | 57 |  |  |
| `check:upstream-builtin-room-routing` | 57 |  |  |
| `check:chromium-launcher` | 57 |  |  |
| `check:relocation-solve` | 54 |  |  |
| `check:upstream-builtin-terrain` | 54 |  |  |
| `check:vehicle-tuning` | 50 |  |  |
