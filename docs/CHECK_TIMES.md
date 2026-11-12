# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 186.7 s across 309 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:engine-state-hash-1024` | 18130 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-marble-bowl` | 17019 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:engine-tiers` | 12318 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:scenario-determinism` | 11098 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:elevation-ab` | 9175 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:pose-allocations` | 8749 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:engine-job-wait` | 7953 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:height-cpu` | 6354 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:alloc-audit` | 6027 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:sphere-population` | 5135 |  | Places the full sphere population and checks every member. |
| `check:app-watch` | 4597 |  | Waits on real file-watch events. |
| `check:heightmap-cli` | 4311 |  | Runs the heightmap CLI once per fixture case. |
| `check:vegetation-allocations` | 3529 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:engine-release` | 3156 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:mapspinner-atmosphere` | 2630 |  | Integrates the atmosphere tables against spoint values. |
| `check:engine-threads` | 2513 | yes | Runs the threaded scenario at several worker counts. |
| `check:scenario-allocations` | 2430 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:thread-sampler` | 2059 | yes | Samples real threads over a timed window. |
| `check:own-display` | 1872 |  |  |
| `check:vegetation-generate-cost` | 1684 |  |  |
| `check:types` | 1407 |  |  |
| `check:gc-witness` | 1380 |  |  |
| `check:scenario-lockstep-rts` | 1364 | yes |  |
| `check:scenario-deathrun` | 1312 | yes |  |
| `check:gc-reuse-rows` | 1201 |  |  |
| `check:scenario-boss-fight` | 1153 | yes |  |
| `check:engine-footprint` | 1005 |  |  |
| `check:scenario-combat-bots` | 998 | yes |  |
| `check:create-app` | 987 |  |  |
| `check:engine-host-witness` | 983 |  |  |
| `check:package-surface` | 972 |  |  |
| `check:upload-writes` | 967 |  |  |
| `check:wireweave-relay` | 961 |  |  |
| `check:pose-replay` | 888 |  |  |
| `check:upload-handler` | 840 |  |  |
| `check:scenario-character-terrain` | 833 | yes |  |
| `check:transport` | 829 |  |  |
| `check:planet-witness-scene` | 810 |  |  |
| `check:crowd-dot-buffer` | 803 |  |  |
| `check:scenario-projectile-volley` | 796 | yes |  |
| `check:planet-witness` | 751 |  |  |
| `check:engine-awake-budget` | 719 |  |  |
| `build:kernel` | 681 |  |  |
| `check:scenario-settle` | 665 | yes |  |
| `check:scenario-planet-landing` | 663 | yes |  |
| `check:engine-warm` | 645 |  |  |
| `check:socket-server` | 577 |  |  |
| `check:engine-pools` | 511 |  |  |
| `check:engine-airborne` | 511 |  |  |
| `check:planet-scene-counts` | 481 |  |  |
| `check:scenario-character` | 462 | yes |  |
| `check:project-naming` | 448 |  |  |
| `check:engine-raycast` | 422 |  |  |
| `check:engine-seal` | 400 |  |  |
| `check:engine-shapecast` | 383 |  |  |
| `check:stall-attribution` | 377 |  |  |
| `check:sharding` | 359 |  |  |
| `check:collision-placement-options` | 348 |  |  |
| `check:terrain-agreement` | 346 |  |  |
| `check:overlap-spoint` | 311 |  |  |
| `check:packages` | 292 |  |  |
| `check:physics-integration-vehicles` | 284 |  |  |
| `check:engine-vegetation` | 284 |  |  |
| `check:raycast-spoint` | 283 |  |  |
| `check:collision-mirror` | 283 |  |  |
| `check:sdk-surfaces` | 281 |  |  |
| `check:vehicles-spoint` | 279 |  |  |
| `check:vehicle-remove-spoint` | 275 |  |  |
| `check:snapshots` | 268 |  |  |
| `check:webgpu-profile` | 268 |  |  |
| `check:collision-host` | 267 |  |  |
| `check:site-world` | 266 |  |  |
| `check:ci-engine-glue` | 259 |  |  |
| `check:collision-tile-streamer` | 253 |  |  |
| `check:engine-world` | 253 |  |  |
| `check:chart-state-live` | 248 |  |  |
| `check:dormant-spoint` | 231 |  |  |
| `check:camera-relative` | 229 |  |  |
| `check:dormant-budget-spoint` | 226 |  |  |
| `check:vehicle-refusal-spoint` | 225 |  |  |
| `check:player-vat-spoint` | 225 |  |  |
| `check:engine-materials` | 224 |  |  |
| `check:player-lod-renderer-webgpu` | 211 |  |  |
| `check:player-lod-renderer` | 210 |  |  |
| `check:fire` | 207 |  |  |
| `check:engine-planet` | 203 |  |  |
| `check:player-dot-material-spoint` | 198 |  |  |
| `check:cluster-lod-spoint` | 196 |  |  |
| `check:recast-bake-spoint` | 195 |  |  |
| `check:engine-bridge` | 195 |  |  |
| `check:rebase-session` | 195 |  |  |
| `check:netcode` | 187 |  |  |
| `check:bloom-spoint` | 187 |  |  |
| `check:streaming-gltf-mesh` | 185 |  |  |
| `check:player-dot-shader-spoint` | 185 |  |  |
| `check:engine-sleep` | 180 |  |  |
| `check:upstream-builtin-nav` | 172 |  |  |
| `check:lockstep` | 167 |  |  |
| `check:terrain-static` | 167 |  |  |
| `check:engine-budget-floor` | 164 |  |  |
| `check:client-resource-pools` | 164 |  |  |
| `check:scene-setup-spoint` | 163 |  |  |
| `check:vegetation-leaf-patches` | 161 |  |  |
| `check:bin-snapshot` | 160 |  |  |
| `check:decode-path` | 160 |  |  |
| `check:streamer-p99` | 155 |  |  |
| `check:vat-spoint` | 153 |  |  |
| `check:socket-upgrade` | 153 |  |  |
| `check:kaggle-regress` | 152 |  |  |
| `check:fsr1-spoint` | 150 |  |  |
| `check:engine-codecs` | 150 |  |  |
| `check:ssr-spoint` | 148 |  |  |
| `check:fire-modules` | 147 |  |  |
| `check:sessions` | 145 |  |  |
| `check:kernel` | 144 |  |  |
| `check:engine-interest` | 144 |  |  |
| `check:terrain-pure` | 143 |  |  |
| `check:sample-order` | 143 |  |  |
| `check:engine-leak` | 142 |  |  |
| `check:procgen` | 140 |  |  |
| `check:spline-erosion-witness` | 138 |  |  |
| `check:engine-core` | 137 |  |  |
| `check:chart-anchor` | 132 |  |  |
| `check:client-pure` | 127 |  |  |
| `check:glue-tier` | 126 |  |  |
| `check:import-scene` | 122 |  |  |
| `check:player-collisions` | 122 |  |  |
| `check:replay-file` | 119 |  |  |
| `check:rollback` | 117 |  |  |
| `check:lag-compensation` | 116 |  |  |
| `check:lod-tiers` | 116 |  |  |
| `check:spoint-core-rust` | 114 |  |  |
| `check:follow-misuse` | 113 |  |  |
| `check:msgpack-packer` | 112 |  |  |
| `check:behaviours` | 111 |  |  |
| `check:timed-result` | 109 |  |  |
| `check:vegetation-stream` | 103 |  |  |
| `check:physics-pure` | 102 |  |  |
| `check:upstream-skill-registry` | 101 |  |  |
| `check:collider-streamer` | 101 |  |  |
| `check:netcode-small` | 100 |  |  |
| `check:replay-player` | 99 |  |  |
| `check:engine-render` | 98 |  |  |
| `check:protocol-codecs` | 95 |  |  |
| `check:client-message-handler` | 94 |  |  |
| `check:spawn` | 93 |  |  |
| `check:tick-governor` | 92 | yes |  |
| `check:snapshot-lod` | 90 |  |  |
| `check:sdk-misc` | 90 |  |  |
| `check:snapshot-packer` | 89 |  |  |
| `check:event-log` | 87 |  |  |
| `check:behaviour-health-destructible` | 86 |  |  |
| `check:replay-dialect` | 85 |  |  |
| `check:reduced-pose` | 84 |  |  |
| `check:game-systems-spoint` | 84 |  |  |
| `check:protocol` | 83 |  |  |
| `check:animation-control` | 83 |  |  |
| `check:prediction-engine` | 83 |  |  |
| `check:upstream-skill-bodies` | 82 |  |  |
| `check:negative-zero` | 82 |  |  |
| `check:wireweave-frame-spoint` | 82 |  |  |
| `check:msgpackr-compat` | 81 |  |  |
| `check:tick-authority` | 81 |  |  |
| `check:behaviours-c` | 81 |  |  |
| `check:streaming-gltf-queues` | 80 |  |  |
| `check:upload-route` | 80 |  |  |
| `check:player-lod-plan` | 80 |  |  |
| `check:mat4-spoint` | 80 |  |  |
| `check:paint-store` | 79 |  |  |
| `check:chart-reanchor` | 79 |  |  |
| `check:shared-pure` | 79 |  |  |
| `check:hot-reload-spoint` | 79 |  |  |
| `check:game-systems` | 78 |  |  |
| `check:controlled-run` | 78 |  |  |
| `check:frame-stall-cause` | 78 |  |  |
| `check:pathfinding` | 77 |  |  |
| `check:aoi` | 77 |  |  |
| `check:cluster-handoff` | 77 |  |  |
| `check:hygiene` | 77 |  |  |
| `check:world` | 76 |  |  |
| `check:bundle-freshness-jayzee` | 75 |  |  |
| `check:upstream-builtin-bodies` | 75 |  |  |
| `check:behaviours-a` | 75 |  |  |
| `check:editor-serialize` | 75 |  |  |
| `check:chart-migrators` | 73 |  |  |
| `check:client-pure-rows` | 72 |  |  |
| `check:sdk-editor` | 70 |  |  |
| `check:clusters` | 69 |  |  |
| `check:telemetry` | 69 |  |  |
| `check:world-persistence` | 68 |  |  |
| `check:apps-b` | 68 |  |  |
| `check:app-loader` | 68 |  |  |
| `check:engine-artifacts` | 68 |  |  |
| `check:octree` | 67 |  |  |
| `check:snapshot-processor` | 67 |  |  |
| `check:upstream-builtin-easing` | 67 |  |  |
| `check:row16-client-decoder` | 66 |  |  |
| `check:upstream-builtin-noise` | 66 |  |  |
| `check:apps-a` | 66 |  |  |
| `check:client-machines` | 66 |  |  |
| `check:world-config` | 66 |  |  |
| `check:frequency-runs` | 66 |  |  |
| `check:anticheat-spoint` | 65 |  |  |
| `check:chart-state-server` | 65 |  |  |
| `check:client-tier-split` | 65 |  |  |
| `check:planet-gap-class` | 65 |  |  |
| `check:chart-transfer` | 64 |  |  |
| `check:camera-rig` | 64 |  |  |
| `check:paired-report` | 64 |  |  |
| `check:render` | 63 |  |  |
| `check:client-loops` | 63 |  |  |
| `check:upstream-door-routes` | 63 |  |  |
| `check:upstream-tome-lookup` | 63 |  |  |
| `check:spawn-captured-names` | 63 |  |  |
| `check:material-tier-swap-spoint` | 63 |  |  |
| `check:feature-gap` | 62 |  |  |
| `check:physics-extras` | 62 |  |  |
| `check:stage` | 62 |  |  |
| `check:upstream-builtin-vec3` | 62 |  |  |
| `check:cluster-slice` | 62 |  |  |
| `check:stall-off-cpu` | 62 |  |  |
| `check:browser-heap` | 62 |  |  |
| `check:spawn-named-errors` | 61 |  |  |
| `check:sandbox` | 61 |  |  |
| `check:ccd` | 61 |  |  |
| `check:upstream-builtin-physics` | 61 |  |  |
| `check:behaviours-b` | 61 |  |  |
| `check:app-behaviours` | 61 |  |  |
| `check:app-runtime-state` | 61 |  |  |
| `check:entity-host` | 61 |  |  |
| `check:upstream-door-dispatch` | 60 |  |  |
| `check:script-limits` | 60 |  |  |
| `check:physics-integration` | 60 |  |  |
| `check:client-pure-spoint` | 60 |  |  |
| `check:upstream-tome-bodies` | 59 |  |  |
| `check:upstream-reference` | 59 |  |  |
| `check:world-query` | 59 |  |  |
| `check:upstream-builtin-env` | 59 |  |  |
| `check:network-state` | 59 |  |  |
| `check:pool-params-spoint` | 59 |  |  |
| `check:stall-probe` | 59 |  |  |
| `check:transport-framing` | 58 |  |  |
| `check:consensus` | 58 |  |  |
| `check:upstream-tome` | 58 |  |  |
| `check:upstream-builtin-voxels` | 58 |  |  |
| `check:crowd-dot-cells-spoint` | 58 |  |  |
| `check:engine-solver-tier` | 58 |  |  |
| `check:anticheat` | 57 |  |  |
| `check:rollback-peer` | 57 |  |  |
| `check:upstream-builtins` | 57 |  |  |
| `check:upstream-builtin-lighting` | 57 |  |  |
| `check:vec3-read` | 57 |  |  |
| `check:postfx-shaders-spoint` | 57 |  |  |
| `check:blend-tree-spoint` | 57 |  |  |
| `check:asset-pipeline` | 57 |  |  |
| `check:sampler-gap-attribution` | 57 |  |  |
| `check:tail-report` | 57 |  |  |
| `check:site` | 56 |  |  |
| `check:rollback-bridge` | 56 |  |  |
| `check:upstream-builtin-fx` | 56 |  |  |
| `check:upstream-builtin-three` | 56 |  |  |
| `check:upstream-builtin-tsl` | 56 |  |  |
| `check:upstream-builtin-tween` | 56 |  |  |
| `check:component-pool` | 56 |  |  |
| `check:messages` | 55 |  |  |
| `check:upstream-endpoints` | 55 |  |  |
| `check:hot-reload` | 55 |  |  |
| `check:animation` | 55 |  |  |
| `check:tick-scheduler` | 55 |  |  |
| `check:upstream-doors` | 55 |  |  |
| `check:named-asset-redirect` | 55 |  |  |
| `check:upstream-builtin-postfx` | 55 |  |  |
| `check:upstream-builtin-path` | 55 |  |  |
| `check:upstream-builtin-water` | 55 |  |  |
| `check:player-id` | 55 |  |  |
| `check:navmesh-query-spoint` | 55 |  |  |
| `check:minidump` | 55 |  |  |
| `check:collision-placement` | 55 |  |  |
| `check:relative-residuals` | 55 |  |  |
| `check:engine-isolation` | 55 |  |  |
| `check:movement` | 54 |  |  |
| `check:relocation-solve` | 54 |  |  |
| `check:worker-dispatch` | 54 |  |  |
| `check:hook-order` | 54 |  |  |
| `check:reexpress-records` | 54 |  |  |
| `check:cube-sphere-cell-key-spoint` | 54 |  |  |
| `check:spawn-captured-bodies` | 54 |  |  |
| `check:render-1024-visible` | 54 |  |  |
| `check:upstream-skills` | 53 |  |  |
| `check:heightfield-physics` | 53 |  |  |
| `check:upstream-builtin-room-routing` | 53 |  |  |
| `check:upstream-builtin-spline` | 53 |  |  |
| `check:engine-visibility` | 53 |  |  |
| `check:character-step` | 52 |  |  |
| `check:upstream-builtin-ballistics` | 52 |  |  |
| `check:upstream-builtin-vibe` | 52 |  |  |
| `check:collider-layers` | 52 |  |  |
| `check:content` | 51 |  |  |
| `check:flight-model` | 51 |  |  |
| `check:constraint-limits` | 51 |  |  |
| `check:jolt-limits` | 51 |  |  |
| `check:worker-bridge` | 51 |  |  |
| `check:upstream-builtin-math` | 51 |  |  |
| `check:upstream-builtin-terrain` | 51 |  |  |
| `check:world-def-clusters` | 51 |  |  |
| `check:chromium-launcher` | 51 |  |  |
| `check:world-resolver` | 50 |  |  |
| `check:vehicle-tuning` | 49 |  |  |
| `check:tick-order` | 49 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 43. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-12T09:20:34.493Z. Queue wait 9 s from the push to the first line of the script. Run time 505.5 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.903 | 9.6 | 12.347 | 0 | 7.79 / 4.72 | 10.673 | 12.347 | 0 | 6.943 | 8.939 | 0 | 278248248 | 668400144 | 1345.2 | 1106.2 | 10.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.055 | 9.891 | 13.528 | 0 | 6.88 / 3.79 | 11.947 | 13.528 | 0 | 6.126 | 7.868 | 0 | 278230008 | 668400144 | 422 | 171.8 | 7.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.304 | 11.769 | 23.952 | 4 | 7.83 / 4.73 | 17.214 | 18.584 | 3 | 7.399 | 9.521 | 1 | 278248248 | 668400144 | 1336.6 | 1142.9 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.25 | 11.031 | 15.254 | 0 | 6.92 / 3.94 | 9.089 | 10.072 | 0 | 6.358 | 11.88 | 0 | 278230008 | 668400144 | 472.9 | 181.8 | 7.9 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.217 | 12.696 | 19.725 | 1 | 8.37 / 4.82 | 9.639 | 13.062 | 0 | 7.405 | 12.878 | 1 | 278248248 | 668400144 | 1312 | 1145.9 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.988 | 10.069 | 14.097 | 0 | 6.91 / 3.85 | 8.771 | 12.065 | 0 | 6.09 | 10.625 | 0 | 278230008 | 668400144 | 456.9 | 196.9 | 7.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.158 | 12.241 | 14.107 | 0 | 8.14 / 4.84 | 9.133 | 10.484 | 0 | 7.286 | 13.06 | 0 | 278248248 | 668400144 | 1322.8 | 1160.1 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.958 | 7.81 | 10.233 | 0 | 7.05 / 3.74 | 8.97 | 10.233 | 0 | 6.026 | 7.716 | 0 | 278230008 | 668400144 | 446.9 | 181.9 | 7.4 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.19 | 12.916 | 18.848 | 1 | 8.03 / 4.69 | 9.339 | 10.021 | 0 | 7.395 | 13.527 | 1 | 278248248 | 668400144 | 1304.7 | 1124.2 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.974 | 7.965 | 9.754 | 0 | 6.92 / 3.84 | 8.713 | 9.686 | 0 | 6.079 | 7.965 | 0 | 278230008 | 668400144 | 433.6 | 177.3 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.941 | 11.513 | 14.073 | 0 | 6.84 / 3.77 | 8.17 | 8.794 | 0 | 6.046 | 12.279 | 0 | 278230008 | 668400144 | 439.1 | 175.1 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.694 | 7.017 | 8.197 | 0 | 6.83 / 3.88 | 6.938 | 7.32 | 0 | 5.764 | 7.049 | 0 | 278210888 | 668400144 | 443.3 | 176.7 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.866 | 9.421 | 12.967 | 0 | 6.82 / 4.08 | 11.496 | 12.967 | 0 | 5.975 | 7.518 | 0 | 278230008 | 668400144 | 446.4 | 184.1 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.599 | 9.995 | 16.466 | 0 | 7.05 / 3.9 | 6.8 | 7.136 | 0 | 5.686 | 10.523 | 0 | 278210888 | 668400144 | 447.2 | 191.8 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.925 | 7.719 | 9.709 | 0 | 8.01 / 4.24 | 7.984 | 9.709 | 0 | 6.019 | 7.587 | 0 | 278230008 | 668400144 | 442.4 | 204.9 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.577 | 6.895 | 7.472 | 0 | 7 / 3.74 | 6.732 | 7.406 | 0 | 5.661 | 6.895 | 0 | 278210888 | 668400144 | 459.2 | 316.9 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.898 | 10.491 | 14.549 | 0 | 7.28 / 3.92 | 7.832 | 10.084 | 0 | 6.032 | 11.175 | 0 | 278230008 | 668400144 | 428.9 | 221.4 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.601 | 9.236 | 16.197 | 0 | 6.62 / 3.73 | 6.97 | 7.495 | 0 | 5.708 | 9.962 | 0 | 278210888 | 668400144 | 441.6 | 176.7 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.916 | 7.661 | 9.949 | 0 | 6.94 / 3.91 | 7.686 | 9.949 | 0 | 6.013 | 7.611 | 0 | 278230008 | 668400144 | 439.1 | 252.9 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.616 | 9.312 | 16.949 | 1 | 6.82 / 3.78 | 11.909 | 16.949 | 1 | 5.652 | 6.799 | 0 | 278210888 | 668400144 | 426.2 | 172.8 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.799 | 10.512 | 13.615 | 0 | 6.88 / 3.82 | 8.119 | 9.517 | 0 | 5.871 | 11.647 | 0 | 278230008 | 668400144 | 442.2 | 173.9 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.582 | 10.199 | 14.449 | 0 | 6.7 / 3.63 | 7.082 | 7.937 | 0 | 5.632 | 11.459 | 0 | 278210888 | 668400144 | 435.3 | 215.2 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.91 | 7.686 | 9.929 | 0 | 6.92 / 3.84 | 7.667 | 9.887 | 0 | 6.008 | 7.687 | 0 | 278230008 | 668400144 | 444 | 172.9 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.655 | 9.289 | 13.599 | 0 | 6.82 / 3.9 | 12.265 | 13.599 | 0 | 5.688 | 6.965 | 0 | 278210888 | 668400144 | 444.7 | 207.3 | 7.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.905 | 10.174 | 16.407 | 0 | 6.75 / 3.7 | 8.414 | 9.602 | 0 | 5.994 | 10.461 | 0 | 278230008 | 668400144 | 452.6 | 214.9 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.543 | 6.875 | 8.225 | 0 | 6.9 / 3.8 | 6.682 | 7.224 | 0 | 5.592 | 6.903 | 0 | 278210888 | 668400144 | 445.6 | 174.6 | 6.9 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 11.256 | 15.691 | 18.895 | 5 | 8.95 / 5.56 | 13.871 | 14.228 | 0 | 11.473 | 16.547 | 5 | 278230008 | 668203536 | 522.6 | 176.4 | 12.3 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.632 | 11.869 | 13.584 | 0 | 7.62 / 4.39 | 9.88 | 10.279 | 0 | 7.831 | 12.147 | 0 | 278230008 | 668269072 | 437.3 | 227.8 | 9 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.824 | 8.854 | 9.244 | 0 | 7.16 / 4.28 | 8.841 | 9.244 | 0 | 6.959 | 8.856 | 0 | 278230008 | 668334608 | 446.9 | 175.2 | 8.1 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 5.955 | 8.08 | 8.82 | 0 | 6.88 / 3.8 | 7.877 | 8.82 | 0 | 6.107 | 8.115 | 0 | 278230008 | 668531216 | 448.6 | 283.6 | 7.7 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 7.004 | 11.947 | 15.675 | 0 | 7.43 / 4.21 | 14.483 | 15.675 | 0 | 7.107 | 9.096 | 0 | 278230008 | 668400144 | 500.5 | 197 | 8.5 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 5.855 | 10.486 | 26.027 | 2 | 26.03 / 7.57 | 9.115 | 21.332 | 1 | 5.969 | 10.486 | 0 | 278230008 | 668400144 |  | 120.3 | 7 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.323 | 5.934 | 8.328 | 0 | 8.33 / 3.59 | 6.447 | 7.15 | 0 | 0.317 | 0.383 | 0 | 196038896 | 668400144 | 428.5 | 186.9 | 2.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.888 | 8.742 | 14.656 | 0 | 6.68 / 3.81 | 7.864 | 9.092 | 0 | 5.92 | 8.915 | 0 | 405628416 | 668400144 | 433.4 | 176.8 | 18.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.318 | 7.158 | 8.755 | 0 | 8.13 / 3.84 | 7.08 | 8.755 | 0 | 5.369 | 7.158 | 0 | 222452960 | 668400144 | 442.1 | 178.4 | 5.3 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.168 | 9.392 | 12.534 | 0 | 7.72 / 3.45 | 11.583 | 12.534 | 0 | 5.141 | 6.341 | 0 | 222603776 | 668400144 | 439.6 | 168.9 | 5.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.449 | 6.888 | 10.598 | 0 | 7.7 / 3.61 | 7.743 | 10.598 | 0 | 5.523 | 6.871 | 0 | 222407312 | 668400144 | 439.4 | 255.7 | 5.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.198 | 6.547 | 7.76 | 0 | 7.76 / 3.37 | 6.729 | 6.894 | 0 | 5.183 | 6.441 | 0 | 222564304 | 668400144 | 453.8 | 226.7 | 5.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.191 | 13.243 | 18.993 | 3 | 9.3 / 6.06 | 11.543 | 14.588 | 0 | 7.282 | 14.17 | 3 | 278246392 | 668400144 | 542 | 198.8 | 8.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.186 | 13.116 | 17.853 | 1 | 9.47 / 7.68 | 10.646 | 10.881 | 0 | 7.303 | 14.139 | 1 | 278246392 | 668400144 | 533.6 | 356.4 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.205 | 12.379 | 18.115 | 1 | 9.27 / 5.5 | 10.578 | 12.323 | 0 | 7.308 | 14.567 | 1 | 278246392 | 668400144 | 539.1 | 188.9 | 8.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.16 | 11.885 | 15.709 | 0 | 9.83 / 5.51 | 9.675 | 11.997 | 0 | 7.218 | 13.032 | 0 | 278246392 | 668400144 | 539.5 | 180.6 | 8.7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.213 | 9.136 | 11.808 | 0 | 9 / 7.63 | 9.829 | 10.838 | 0 | 7.283 | 8.945 | 0 | 278246392 | 668400144 | 514 | 253.5 | 8.7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.23 | 9.413 | 15.528 | 0 | 12.94 / 6.22 | 10.603 | 15.528 | 0 | 7.32 | 9.139 | 0 | 278246392 | 668400144 | 526.7 | 178.3 | 8.7 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.331 | 9.341 | 14.034 | 0 | 11.21 / 5.29 | 11.087 | 14.034 | 0 | 0.324 | 0.507 | 0 | 196055280 | 668400144 | 538.9 | 180.6 | 2.9 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.334 | 7.742 | 11.118 | 0 | 11.12 / 5.3 | 8.436 | 8.799 | 0 | 0.323 | 0.438 | 0 | 196055280 | 668400144 | 539.5 | 176.6 | 2.7 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.337 | 7.662 | 11.185 | 0 | 11.19 / 5 | 8.093 | 10.151 | 0 | 0.328 | 0.429 | 0 | 196055280 | 668400144 | 549.5 | 189.9 | 2.7 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 12.001 | 13 | 0 | 0 | 12.3 | 13.348 | 0 | 22 |
| 128 MiB fixed | 1 | schedstat | 14.794 | 17.802 | 3 | 0 | 14.616 | 17.485 | 3 | 22.1 |
| 512 MiB fixed | 1 | schedstat | 12.933 | 14.944 | 0 | 0 | 12.501 | 15.402 | 0 | 17.7 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 7 | 9.999 | 0 | 0 | 7.109 | 11.129 | 0 | 13.1 |

## Physics claim per Kaggle machine class

Written by `node scripts/kaggle/claims.mjs` from the result files of `heclgang/jayzee-physics-goalpost` named below. A row holds when every repeat has zero ticks over 16.7 ms and a p99 at or under it, warmed, 900 ticks, the whole worker tick timed. The build before the budget has every body awake from tick 0, and the build that held bodies in the world kept a held body asleep at its spawn point. The class is vendor, family, model and stepping from /proc/cpuinfo.

### GenuineIntel-6-79-0 (Intel(R) Xeon(R) CPU @ 2.20GHz)

- Kernel versions: 24, 25, 26, 27, 28, 31. 2 cores, 4 threads, 2200.212 MHz, L2 512 KiB (2 instances), L3 55 MiB (1 instance), avx512 no, cgroup cpu.max 400000 100000.
- Calibration: single thread 567.6 ms, memory chase 206.6 ms, four lanes at once cost 1.048 times one lane.

| bodies | build | workers | repeats | median p99 ms | worst p99 ms | worst max ms | ticks over budget per repeat | repeats with none over | peak awake | last awake tick | holds in every repeat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 12288 | build before the budget | 4 | 3 | 15.355 | 15.723 | 17.306 | 1, 2, 0 | 1 of 3 | 0 | 0 | no |
| 12288 | candidate, awake budget 4096 | 4 | 6 | 6.046 | 7.413 | 13.364 | 0, 0, 0, 0, 0, 0 | 6 of 6 | 4096 | 262 | yes |
| 12288 | candidate, every body awake, tune 0 | 4 | 3 | 15.215 | 15.464 | 18.747 | 1, 3, 0 | 1 of 3 | 12288 | 144 | no |
| 12288 | candidate, every body awake, tune 1 | 4 | 3 | 15.225 | 16.002 | 16.876 | 0, 1, 0 | 2 of 3 | 12288 | 144 | no |
| 12288 | candidate, every body awake, tune 2 | 4 | 3 | 14.776 | 15.555 | 16.56 | 0, 0, 0 | 3 of 3 | 12288 | 145 | yes |
| 12288 | candidate, every body awake, tune 4 | 4 | 3 | 15.775 | 18.918 | 22.693 | 1, 17, 2 | 0 of 3 | 12288 | 144 | no |
| 12288 | candidate, every body awake, tune 7 | 4 | 3 | 15.482 | 15.638 | 17.166 | 2, 0, 1 | 1 of 3 | 12288 | 145 | no |
| 16384 | candidate, awake budget 4096 | 4 | 6 | 6.272 | 9.458 | 13.308 | 0, 0, 0, 0, 0, 0 | 6 of 6 | 4096 | 350 | yes |
| 20480 | build that held bodies in the world, awake budget 4096 | 4 | 3 | 6.459 | 10.094 | 10.942 | 0, 0, 0 | 3 of 3 | 4096 | 413 | yes |
| 20480 | candidate, awake budget 4096 | 4 | 3 | 7.242 | 9.982 | 16.836 | 1, 0, 0 | 2 of 3 | 4096 | 413 | no |
| 24576 | build that held bodies in the world, awake budget 4096 | 4 | 3 | 6.463 | 6.894 | 8.062 | 0, 0, 0 | 3 of 3 | 4096 | 498 | yes |
| 24576 | candidate, awake budget 4096 | 4 | 3 | 6.182 | 10.868 | 14.919 | 0, 0, 0 | 3 of 3 | 4096 | 498 | yes |
| 32768 | build that held bodies in the world, awake budget 4096 | 4 | 3 | 7.289 | 10.411 | 14.015 | 0, 0, 0 | 3 of 3 | 4096 | 631 | yes |
| 32768 | candidate, awake budget 4096 | 4 | 3 | 10.015 | 10.974 | 15.28 | 0, 0, 0 | 3 of 3 | 4096 | 631 | yes |
| 40960 | build that held bodies in the world, awake budget 4096 | 4 | 6 | 7.094 | 10.957 | 15.86 | 0, 0, 0, 0, 0, 0 | 6 of 6 | 4096 | 776 | yes |
| 40960 | candidate, awake budget 4096 | 3 | 8 | 10.86 | 12.871 | 18.778 | 0, 2, 0, 0, 0, 0, 0, 0 | 7 of 8 | 4096 | 776 | no |
| 40960 | candidate, awake budget 4096 | 4 | 56 | 8.261 | 15.125 | 23.371 | 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 | 47 of 56 | 4096 | 776 | no |
| 40960 | candidate, awake budget 4096, node --v8-pool-size=1 | 4 | 8 | 9.662 | 13.698 | 16.772 | 0, 0, 0, 1, 0, 0, 0, 0 | 7 of 8 | 4096 | 776 | no |
| 40960 | candidate, awake budget 6144 | 4 | 3 | 13.47 | 13.721 | 20.648 | 2, 5, 0 | 1 of 3 | 6144 | 534 | no |
| 40960 | candidate, awake budget 8192 | 4 | 3 | 12.21 | 12.548 | 14.375 | 0, 0, 0 | 3 of 3 | 8192 | 411 | yes |
| 40960 | reference build, awake budget 4096 | 4 | 10 | 9.266 | 11.494 | 16.682 | 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 | 10 of 10 | 4096 | 776 | yes |
| 49152 | candidate, awake budget 4096 | 4 | 3 | 9.274 | 9.615 | 12.717 | 0, 0, 0 | 3 of 3 | 4096 | 899 | yes |
| 65536 | candidate, awake budget 4096 | 4 | 3 | 9.073 | 10.515 | 17.596 | 1, 0, 0 | 2 of 3 | 4096 | 899 | no |

### AuthenticAMD-23-49-0 (AMD EPYC 7B12)

- Kernel versions: 29. 2 cores, 4 threads, 2249.998 MHz, L2 1 MiB (2 instances), L3 16 MiB (1 instance), avx512 no, cgroup cpu.max 400000 100000.
- Calibration: single thread 503.7 ms, memory chase 177 ms, four lanes at once cost 1.017 times one lane.

| bodies | build | workers | repeats | median p99 ms | worst p99 ms | worst max ms | ticks over budget per repeat | repeats with none over | peak awake | last awake tick | holds in every repeat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 40960 | candidate, awake budget 4096 | 4 | 5 | 6.784 | 6.859 | 31.775 | 0, 0, 0, 1, 0 | 4 of 5 | 4096 | 776 | no |
| 40960 | reference build, awake budget 4096 | 4 | 5 | 9.156 | 9.427 | 13.629 | 0, 0, 0, 0, 0 | 5 of 5 | 4096 | 776 | yes |
