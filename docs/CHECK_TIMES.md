# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 212.5 s across 309 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:engine-state-hash-1024` | 20967 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-marble-bowl` | 19270 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:engine-tiers` | 13903 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:scenario-determinism` | 13371 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:elevation-ab` | 10879 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:pose-allocations` | 9794 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:engine-job-wait` | 9289 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:alloc-audit` | 6971 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:height-cpu` | 6920 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:sphere-population` | 5772 |  | Places the full sphere population and checks every member. |
| `check:app-watch` | 4589 |  | Waits on real file-watch events. |
| `build:kernel` | 4441 |  | Compiles the kernel with jz. It is skipped when src/kernel and the jz package are unchanged. |
| `check:heightmap-cli` | 4286 |  | Runs the heightmap CLI once per fixture case. |
| `check:vegetation-allocations` | 4012 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:engine-release` | 3077 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:engine-threads` | 2981 | yes | Runs the threaded scenario at several worker counts. |
| `check:scenario-allocations` | 2628 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:mapspinner-atmosphere` | 2420 |  | Integrates the atmosphere tables against spoint values. |
| `check:thread-sampler` | 2063 | yes | Samples real threads over a timed window. |
| `check:own-display` | 1850 |  |  |
| `check:scenario-deathrun` | 1587 | yes |  |
| `check:vegetation-generate-cost` | 1578 |  |  |
| `check:scenario-boss-fight` | 1504 | yes |  |
| `check:gc-witness` | 1461 |  |  |
| `check:scenario-lockstep-rts` | 1428 | yes |  |
| `check:types` | 1352 |  |  |
| `check:scenario-combat-bots` | 1299 | yes |  |
| `check:gc-reuse-rows` | 1264 |  |  |
| `check:engine-footprint` | 1118 |  |  |
| `check:upload-writes` | 1099 |  |  |
| `check:create-app` | 1087 |  |  |
| `check:engine-host-witness` | 1064 |  |  |
| `check:package-surface` | 997 |  |  |
| `check:engine-warm` | 951 |  |  |
| `check:wireweave-relay` | 947 |  |  |
| `check:scenario-projectile-volley` | 908 | yes |  |
| `check:scenario-character-terrain` | 905 | yes |  |
| `check:upload-handler` | 873 |  |  |
| `check:planet-witness-scene` | 824 |  |  |
| `check:engine-awake-budget` | 823 |  |  |
| `check:pose-replay` | 815 |  |  |
| `check:scenario-planet-landing` | 800 | yes |  |
| `check:crowd-dot-buffer` | 784 |  |  |
| `check:transport` | 769 |  |  |
| `check:planet-witness` | 768 |  |  |
| `check:scenario-settle` | 750 | yes |  |
| `check:planet-scene-counts` | 671 |  |  |
| `check:engine-airborne` | 660 |  |  |
| `check:socket-server` | 630 |  |  |
| `check:engine-pools` | 605 |  |  |
| `check:engine-raycast` | 568 |  |  |
| `check:scenario-character` | 527 | yes |  |
| `check:engine-shapecast` | 479 |  |  |
| `check:engine-seal` | 479 |  |  |
| `check:project-naming` | 437 |  |  |
| `check:stall-attribution` | 429 |  |  |
| `check:sharding` | 428 |  |  |
| `check:collision-placement-options` | 422 |  |  |
| `check:terrain-agreement` | 398 |  |  |
| `check:ci-engine-glue` | 377 |  |  |
| `check:vehicles-spoint` | 368 |  |  |
| `check:physics-integration-vehicles` | 355 |  |  |
| `check:collision-mirror` | 349 |  |  |
| `check:packages` | 336 |  |  |
| `check:engine-vegetation` | 333 |  |  |
| `check:sdk-surfaces` | 318 |  |  |
| `check:webgpu-profile` | 303 |  |  |
| `check:camera-relative` | 283 |  |  |
| `check:rebase-session` | 279 |  |  |
| `check:raycast-spoint` | 277 |  |  |
| `check:collision-tile-streamer` | 269 |  |  |
| `check:netcode` | 266 |  |  |
| `check:engine-planet` | 265 |  |  |
| `check:fire` | 264 |  |  |
| `check:player-dot-shader-spoint` | 262 |  |  |
| `check:engine-world` | 262 |  |  |
| `check:streaming-gltf-mesh` | 261 |  |  |
| `check:player-lod-renderer-webgpu` | 257 |  |  |
| `check:recast-bake-spoint` | 256 |  |  |
| `check:chart-state-live` | 252 |  |  |
| `check:site-world` | 251 |  |  |
| `check:vehicle-refusal-spoint` | 251 |  |  |
| `check:overlap-spoint` | 249 |  |  |
| `check:player-dot-material-spoint` | 246 |  |  |
| `check:vehicle-remove-spoint` | 241 |  |  |
| `check:dormant-budget-spoint` | 241 |  |  |
| `check:bloom-spoint` | 240 |  |  |
| `check:collision-host` | 238 |  |  |
| `check:player-lod-renderer` | 238 |  |  |
| `check:snapshots` | 236 |  |  |
| `check:dormant-spoint` | 235 |  |  |
| `check:player-vat-spoint` | 228 |  |  |
| `check:lockstep` | 224 |  |  |
| `check:engine-materials` | 215 |  |  |
| `check:engine-sleep` | 209 |  |  |
| `check:terrain-static` | 199 |  |  |
| `check:vegetation-leaf-patches` | 196 |  |  |
| `check:scene-setup-spoint` | 195 |  |  |
| `check:engine-leak` | 193 |  |  |
| `check:cluster-lod-spoint` | 191 |  |  |
| `check:decode-path` | 191 |  |  |
| `check:engine-bridge` | 189 |  |  |
| `check:engine-codecs` | 182 |  |  |
| `check:upstream-builtin-nav` | 181 |  |  |
| `check:fire-modules` | 168 |  |  |
| `check:engine-budget-floor` | 168 |  |  |
| `check:terrain-pure` | 161 |  |  |
| `check:spline-erosion-witness` | 158 |  |  |
| `check:engine-interest` | 152 |  |  |
| `check:kaggle-regress` | 148 |  |  |
| `check:streamer-p99` | 144 |  |  |
| `check:vat-spoint` | 138 |  |  |
| `check:bin-snapshot` | 137 |  |  |
| `check:sample-order` | 136 |  |  |
| `check:ssr-spoint` | 134 |  |  |
| `check:client-resource-pools` | 124 |  |  |
| `check:sessions` | 120 |  |  |
| `check:fsr1-spoint` | 119 |  |  |
| `check:kernel` | 118 |  |  |
| `check:chart-anchor` | 116 |  |  |
| `check:engine-core` | 116 |  |  |
| `check:mat4-spoint` | 109 |  |  |
| `check:prediction-engine` | 107 |  |  |
| `check:socket-upgrade` | 106 |  |  |
| `check:relative-residuals` | 106 |  |  |
| `check:game-systems` | 105 |  |  |
| `check:procgen` | 105 |  |  |
| `check:hygiene` | 105 |  |  |
| `check:glue-tier` | 105 |  |  |
| `check:anticheat-spoint` | 104 |  |  |
| `check:upstream-builtin-bodies` | 103 |  |  |
| `check:timed-result` | 103 |  |  |
| `check:sdk-misc` | 102 |  |  |
| `check:client-pure` | 101 |  |  |
| `check:event-log` | 101 |  |  |
| `check:animation-control` | 101 |  |  |
| `check:snapshot-packer` | 101 |  |  |
| `check:collider-streamer` | 100 |  |  |
| `check:protocol` | 99 |  |  |
| `check:world-persistence` | 99 |  |  |
| `check:client-pure-rows` | 99 |  |  |
| `check:upload-route` | 99 |  |  |
| `check:client-message-handler` | 99 |  |  |
| `check:chart-transfer` | 98 |  |  |
| `check:import-scene` | 98 |  |  |
| `check:cluster-slice` | 97 |  |  |
| `check:protocol-codecs` | 96 |  |  |
| `check:behaviours` | 96 |  |  |
| `check:spawn` | 95 |  |  |
| `check:render` | 95 |  |  |
| `check:shared-pure` | 95 |  |  |
| `check:follow-misuse` | 95 |  |  |
| `check:spawn-named-errors` | 94 |  |  |
| `check:lag-compensation` | 93 |  |  |
| `check:netcode-small` | 93 |  |  |
| `check:lod-tiers` | 93 |  |  |
| `check:row16-client-decoder` | 92 |  |  |
| `check:physics-integration` | 92 |  |  |
| `check:vegetation-stream` | 92 |  |  |
| `check:upstream-skill-registry` | 91 |  |  |
| `check:physics-pure` | 91 |  |  |
| `check:behaviours-a` | 91 |  |  |
| `check:apps-a` | 91 |  |  |
| `check:spoint-core-rust` | 91 |  |  |
| `check:frame-stall-cause` | 91 |  |  |
| `check:replay-file` | 90 |  |  |
| `check:tick-governor` | 90 | yes |  |
| `check:msgpack-packer` | 90 |  |  |
| `check:hot-reload-spoint` | 90 |  |  |
| `check:msgpackr-compat` | 89 |  |  |
| `check:behaviours-b` | 89 |  |  |
| `check:chart-migrators` | 89 |  |  |
| `check:replay-player` | 88 |  |  |
| `check:chart-reanchor` | 88 |  |  |
| `check:apps-b` | 88 |  |  |
| `check:client-tier-split` | 88 |  |  |
| `check:player-lod-plan` | 88 |  |  |
| `check:replay-dialect` | 88 |  |  |
| `check:game-systems-spoint` | 88 |  |  |
| `check:feature-gap` | 87 |  |  |
| `check:octree` | 87 |  |  |
| `check:aoi` | 87 |  |  |
| `check:rollback` | 87 |  |  |
| `check:tick-authority` | 87 |  |  |
| `check:sandbox` | 86 |  |  |
| `check:stage` | 86 |  |  |
| `check:app-runtime-state` | 86 |  |  |
| `check:chart-state-server` | 86 |  |  |
| `check:paired-report` | 86 |  |  |
| `check:snapshot-lod` | 85 |  |  |
| `check:reduced-pose` | 85 |  |  |
| `check:world` | 84 |  |  |
| `check:consensus` | 84 |  |  |
| `check:upstream-skill-bodies` | 84 |  |  |
| `check:world-query` | 84 |  |  |
| `check:behaviours-c` | 84 |  |  |
| `check:world-config` | 84 |  |  |
| `check:pool-params-spoint` | 84 |  |  |
| `check:sampler-gap-attribution` | 84 |  |  |
| `check:clusters` | 83 |  |  |
| `check:telemetry` | 83 |  |  |
| `check:player-collisions` | 83 |  |  |
| `check:wireweave-frame-spoint` | 83 |  |  |
| `check:upstream-endpoints` | 82 |  |  |
| `check:behaviour-health-destructible` | 82 |  |  |
| `check:snapshot-processor` | 82 |  |  |
| `check:upstream-door-dispatch` | 82 |  |  |
| `check:sdk-editor` | 82 |  |  |
| `check:negative-zero` | 82 |  |  |
| `check:client-loops` | 81 |  |  |
| `check:editor-serialize` | 81 |  |  |
| `check:upstream-tome-bodies` | 80 |  |  |
| `check:controlled-run` | 80 |  |  |
| `check:engine-render` | 80 |  |  |
| `check:transport-framing` | 79 |  |  |
| `check:upstream-door-routes` | 79 |  |  |
| `check:client-machines` | 79 |  |  |
| `check:streaming-gltf-queues` | 78 |  |  |
| `check:frequency-runs` | 78 |  |  |
| `check:pathfinding` | 77 |  |  |
| `check:upstream-builtins` | 77 |  |  |
| `check:bundle-freshness-jayzee` | 76 |  |  |
| `check:upstream-builtin-lighting` | 76 |  |  |
| `check:paint-store` | 75 |  |  |
| `check:character-step` | 75 |  |  |
| `check:upstream-builtin-math` | 75 |  |  |
| `check:upstream-builtin-physics` | 75 |  |  |
| `check:app-loader` | 75 |  |  |
| `check:stall-off-cpu` | 75 |  |  |
| `check:cluster-handoff` | 74 |  |  |
| `check:app-behaviours` | 74 |  |  |
| `check:engine-artifacts` | 74 |  |  |
| `check:upstream-builtin-noise` | 73 |  |  |
| `check:postfx-shaders-spoint` | 73 |  |  |
| `check:physics-extras` | 72 |  |  |
| `check:rollback-bridge` | 71 |  |  |
| `check:tick-order` | 71 |  |  |
| `check:upstream-builtin-three` | 70 |  |  |
| `check:upstream-builtin-tsl` | 70 |  |  |
| `check:collider-layers` | 70 |  |  |
| `check:upstream-tome-lookup` | 69 |  |  |
| `check:upstream-builtin-water` | 69 |  |  |
| `check:camera-rig` | 69 |  |  |
| `check:network-state` | 68 |  |  |
| `check:crowd-dot-cells-spoint` | 68 |  |  |
| `check:spawn-captured-names` | 68 |  |  |
| `check:stall-probe` | 68 |  |  |
| `check:planet-gap-class` | 68 |  |  |
| `check:upstream-builtin-env` | 67 |  |  |
| `check:material-tier-swap-spoint` | 67 |  |  |
| `check:engine-solver-tier` | 67 |  |  |
| `check:tail-report` | 67 |  |  |
| `check:hot-reload` | 66 |  |  |
| `check:flight-model` | 66 |  |  |
| `check:rollback-peer` | 66 |  |  |
| `check:upstream-tome` | 66 |  |  |
| `check:ccd` | 66 |  |  |
| `check:upstream-builtin-room-routing` | 66 |  |  |
| `check:world-def-clusters` | 66 |  |  |
| `check:upstream-doors` | 65 |  |  |
| `check:upstream-skills` | 65 |  |  |
| `check:upstream-builtin-fx` | 65 |  |  |
| `check:upstream-builtin-postfx` | 65 |  |  |
| `check:browser-heap` | 65 |  |  |
| `check:constraint-limits` | 64 |  |  |
| `check:hook-order` | 64 |  |  |
| `check:spawn-captured-bodies` | 64 |  |  |
| `check:upstream-reference` | 63 |  |  |
| `check:named-asset-redirect` | 63 |  |  |
| `check:upstream-builtin-spline` | 63 |  |  |
| `check:upstream-builtin-vibe` | 63 |  |  |
| `check:component-pool` | 63 |  |  |
| `check:entity-host` | 63 |  |  |
| `check:cube-sphere-cell-key-spoint` | 63 |  |  |
| `check:asset-pipeline` | 63 |  |  |
| `check:tick-scheduler` | 62 |  |  |
| `check:upstream-builtin-ballistics` | 62 |  |  |
| `check:upstream-builtin-path` | 62 |  |  |
| `check:vec3-read` | 62 |  |  |
| `check:reexpress-records` | 62 |  |  |
| `check:client-pure-spoint` | 62 |  |  |
| `check:minidump` | 62 |  |  |
| `check:collision-placement` | 62 |  |  |
| `check:engine-isolation` | 62 |  |  |
| `check:site` | 61 |  |  |
| `check:messages` | 61 |  |  |
| `check:worker-dispatch` | 61 |  |  |
| `check:upstream-builtin-vec3` | 61 |  |  |
| `check:script-limits` | 61 |  |  |
| `check:blend-tree-spoint` | 61 |  |  |
| `check:render-1024-visible` | 61 |  |  |
| `check:engine-visibility` | 60 |  |  |
| `check:anticheat` | 59 |  |  |
| `check:animation` | 59 |  |  |
| `check:vehicle-tuning` | 59 |  |  |
| `check:relocation-solve` | 59 |  |  |
| `check:upstream-builtin-terrain` | 59 |  |  |
| `check:player-id` | 59 |  |  |
| `check:world-resolver` | 59 |  |  |
| `check:content` | 58 |  |  |
| `check:upstream-builtin-easing` | 58 |  |  |
| `check:heightfield-physics` | 58 |  |  |
| `check:chromium-launcher` | 58 |  |  |
| `check:navmesh-query-spoint` | 57 |  |  |
| `check:movement` | 56 |  |  |
| `check:upstream-builtin-voxels` | 56 |  |  |
| `check:upstream-builtin-tween` | 55 |  |  |
| `check:jolt-limits` | 54 |  |  |
| `check:worker-bridge` | 54 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 50. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: AMD EPYC 7B12, 4 CPUs, Node v22.23.4, machine class AuthenticAMD-23-49-0 (2 cores, 4 threads).
- Pushed 2026-11-12T13:00:21.812Z. Queue wait 13 s from the push to the first line of the script. Run time 453.7 s for 65 of 65 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.861 | 8.809 | 11.146 | 0 | 5.74 / 3.65 | 7.721 | 8.196 | 0 | 5.941 | 9.096 | 0 | 278248248 | 668400144 | 696.4 | 526.8 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.855 | 6.159 | 7.159 | 0 | 5.18 / 3.38 | 6.372 | 6.916 | 0 | 4.884 | 6.124 | 0 | 278230008 | 668400144 | 266.7 | 130.8 | 5.4 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.934 | 8.232 | 10.042 | 0 | 5.84 / 3.98 | 8.817 | 10.042 | 0 | 6.037 | 7.808 | 0 | 278248248 | 668400144 | 669.5 | 544.1 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.038 | 7.916 | 11.705 | 0 | 4.76 / 3.03 | 6.335 | 6.916 | 0 | 5.116 | 8.185 | 0 | 278230008 | 668400144 | 265.4 | 123.4 | 5.8 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.16 | 7.776 | 24.066 | 1 | 5.68 / 3.71 | 8.744 | 24.066 | 1 | 6.228 | 7.547 | 0 | 278248248 | 668400144 | 668.7 | 542 | 7.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.059 | 7.356 | 8.58 | 0 | 5.05 / 3.07 | 7.398 | 7.853 | 0 | 5.124 | 7.356 | 0 | 278230008 | 668400144 | 260.9 | 128.5 | 5.8 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.873 | 8.872 | 12.318 | 0 | 5.85 / 3.83 | 7.691 | 8.635 | 0 | 5.926 | 9.664 | 0 | 278248248 | 668400144 | 672.6 | 619.3 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.931 | 6.109 | 8.083 | 0 | 4.99 / 3.14 | 6.815 | 8.083 | 0 | 5.012 | 5.994 | 0 | 278230008 | 668400144 | 260.5 | 126.7 | 5.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.927 | 9.317 | 14.432 | 0 | 5.7 / 3.57 | 7.597 | 7.653 | 0 | 6.047 | 10.692 | 0 | 278248248 | 668400144 | 661.7 | 534.2 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.946 | 6.19 | 7.159 | 0 | 4.93 / 2.27 | 6.395 | 6.667 | 0 | 5.008 | 6.19 | 0 | 278230008 | 668400144 | 266.3 | 126.4 | 5.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.855 | 7.514 | 8.781 | 0 | 5.84 / 3.83 | 7.606 | 8.734 | 0 | 5.938 | 7.514 | 0 | 278248248 | 668400144 | 717.4 | 610.7 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.215 | 9.193 | 12.841 | 0 | 5.76 / 3.02 | 6.549 | 6.818 | 0 | 5.322 | 9.668 | 0 | 278230008 | 668400144 | 269.8 | 155.8 | 6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.058 | 9.001 | 10.875 | 0 | 5.31 / 3.57 | 8.527 | 9.39 | 0 | 6.12 | 9.029 | 0 | 278248248 | 668400144 | 649.7 | 544 | 7.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.01 | 6.248 | 7.574 | 0 | 4.81 / 2.57 | 6.656 | 7.574 | 0 | 5.11 | 6.248 | 0 | 278230008 | 668400144 | 267.1 | 126 | 5.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.93 | 8.645 | 13.118 | 0 | 5.67 / 3.57 | 7.548 | 8.985 | 0 | 6.035 | 8.953 | 0 | 278248248 | 668400144 | 655.8 | 554.3 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.982 | 6.14 | 7.198 | 0 | 5.16 / 3.16 | 6.277 | 7.198 | 0 | 5.044 | 6.14 | 0 | 278230008 | 668400144 | 272.5 | 135.1 | 5.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.951 | 7.697 | 8.711 | 0 | 5.52 / 3.59 | 7.646 | 8.711 | 0 | 6.135 | 7.701 | 0 | 278248248 | 668400144 | 661.4 | 555.8 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.149 | 8.171 | 12.005 | 0 | 4.13 / 3.96 | 7.098 | 8.302 | 0 | 5.203 | 8.754 | 0 | 278230008 | 668400144 | 262.9 | 138.1 | 5.9 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.882 | 7.639 | 8.869 | 0 | 4.92 / 4.22 | 8.11 | 8.869 | 0 | 5.977 | 7.639 | 0 | 278248248 | 668400144 | 637.2 | 625.1 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.106 | 6.392 | 8.735 | 0 | 4.96 / 3.19 | 6.26 | 8.735 | 0 | 5.215 | 6.46 | 0 | 278230008 | 668400144 | 295.7 | 171.1 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.061 | 8.031 | 11.039 | 0 | 5.08 / 3.15 | 6.304 | 6.788 | 0 | 5.168 | 8.831 | 0 | 278230008 | 668400144 | 271.1 | 132.6 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.822 | 6.139 | 7.924 | 0 | 5.07 / 3.31 | 5.713 | 7.924 | 0 | 4.889 | 6.179 | 0 | 278210888 | 668400144 | 262.8 | 132.3 | 5.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.972 | 7.874 | 10.726 | 0 | 5.21 / 3.37 | 6.116 | 6.594 | 0 | 5.105 | 9.283 | 0 | 278230008 | 668400144 | 261.2 | 132.8 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.791 | 5.931 | 6.711 | 0 | 5.08 / 3.42 | 5.989 | 6.142 | 0 | 4.842 | 5.931 | 0 | 278210888 | 668400144 | 273.5 | 129.3 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.171 | 8.612 | 12.149 | 0 | 5.71 / 3.52 | 6.679 | 8.375 | 0 | 5.292 | 8.965 | 0 | 278230008 | 668400144 | 267.4 | 135.1 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.943 | 6.153 | 7.494 | 0 | 5.31 / 3.31 | 6.39 | 7.494 | 0 | 4.987 | 5.962 | 0 | 278210888 | 668400144 | 266.5 | 138.4 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.02 | 6.992 | 8.041 | 0 | 4.09 / 3.12 | 7.915 | 8.041 | 0 | 5.041 | 6.121 | 0 | 278230008 | 668400144 | 274.4 | 128.6 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.843 | 6.912 | 10.277 | 0 | 3.93 / 1.97 | 5.731 | 6.309 | 0 | 4.933 | 7.448 | 0 | 278210888 | 668400144 | 266.9 | 129.9 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.053 | 6.542 | 7.836 | 0 | 4.96 / 3.26 | 6.792 | 7.836 | 0 | 5.139 | 6.542 | 0 | 278230008 | 668400144 | 267.3 | 127.7 | 5.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.081 | 9.22 | 12.288 | 0 | 5.01 / 3.6 | 9.305 | 12.288 | 0 | 5.168 | 9.038 | 0 | 278210888 | 668400144 | 276 | 131.8 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.211 | 6.424 | 6.813 | 0 | 5.57 / 3.11 | 6.424 | 6.811 | 0 | 5.273 | 6.502 | 0 | 278230008 | 668400144 | 275.4 | 133.1 | 5.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.837 | 8.381 | 12.549 | 0 | 4.01 / 2.16 | 6.252 | 6.873 | 0 | 4.901 | 9.975 | 0 | 278210888 | 668400144 | 273.1 | 133 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.249 | 6.741 | 9.752 | 0 | 4.96 / 3.24 | 7.211 | 9.752 | 0 | 5.356 | 6.564 | 0 | 278230008 | 668400144 | 273.8 | 130 | 5.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.054 | 6.443 | 8.445 | 0 | 5.02 / 3.04 | 6.736 | 8.445 | 0 | 5.066 | 6.17 | 0 | 278210888 | 668400144 | 275.4 | 136.3 | 5.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.25 | 8.24 | 12.231 | 0 | 5.03 / 3.45 | 6.963 | 7.203 | 0 | 5.299 | 8.774 | 0 | 278230008 | 668400144 | 261.3 | 137.1 | 5.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.96 | 6.049 | 7.256 | 0 | 5.08 / 3.32 | 5.828 | 6.446 | 0 | 5.017 | 6.06 | 0 | 278210888 | 668400144 | 280.1 | 131.5 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 6.533 | 10.905 | 14.669 | 0 | 6.32 / 3.32 | 8.247 | 8.986 | 0 | 6.729 | 11.353 | 0 | 278230008 | 668203536 | 264.5 | 162.8 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.205 | 9.439 | 12.612 | 0 | 5.04 / 2.79 | 8.884 | 9.708 | 0 | 7.329 | 10.101 | 0 | 278230008 | 668269072 | 270.9 | 132.3 | 7.4 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.127 | 7.527 | 8.368 | 0 | 5.3 / 3.55 | 7.403 | 8.368 | 0 | 6.256 | 7.546 | 0 | 278230008 | 668334608 | 278.6 | 134.9 | 6.6 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 5.19 | 8.751 | 10.934 | 0 | 4.08 / 2.19 | 6.48 | 8.751 | 0 | 5.347 | 9.235 | 0 | 278230008 | 668531216 | 275.4 | 140.5 | 5.9 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 5.817 | 7.287 | 8.228 | 0 | 5.5 / 3.75 | 7.632 | 8.228 | 0 | 5.904 | 7.226 | 0 | 278230008 | 668400144 | 312.6 | 127.3 | 6.3 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 5.222 | 6.669 | 20.063 | 1 | 20.06 / 6.18 | 7.268 | 12.417 | 0 | 5.259 | 6.439 | 0 | 278230008 | 668400144 |  | 85.1 | 5.6 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.178 | 5.338 | 5.701 | 0 | 5.58 / 3.23 | 5.584 | 5.701 | 0 | 0.168 | 0.225 | 0 | 196038896 | 668400144 | 266.3 | 130.7 | 1.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.061 | 6.792 | 10.608 | 0 | 5.37 / 3.07 | 6.663 | 6.971 | 0 | 5.1 | 6.89 | 0 | 405628416 | 668400144 | 269.1 | 154.4 | 14.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.759 | 6.149 | 8.124 | 0 | 4 / 2.88 | 6.114 | 8.124 | 0 | 4.836 | 6.191 | 0 | 222452960 | 668400144 | 272.7 | 129 | 4.3 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.652 | 5.839 | 6.674 | 0 | 3.99 / 1.83 | 6.256 | 6.674 | 0 | 4.643 | 5.839 | 0 | 222603776 | 668400144 | 266.5 | 133.6 | 4.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.752 | 6.055 | 8.349 | 0 | 4.96 / 2.24 | 6.211 | 8.349 | 0 | 4.766 | 5.918 | 0 | 222407312 | 668400144 | 274.5 | 133.3 | 4.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.591 | 6.047 | 6.864 | 0 | 5.15 / 3.94 | 6.244 | 6.364 | 0 | 4.492 | 5.98 | 0 | 222564304 | 668400144 | 274.2 | 135.2 | 4.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.082 | 8.968 | 13.533 | 0 | 7.74 / 4.74 | 11.51 | 13.533 | 0 | 6.127 | 7.369 | 0 | 278246392 | 668400144 | 342.3 | 142.4 | 6.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.078 | 8.736 | 16.58 | 0 | 6.25 / 4.44 | 7.595 | 9.132 | 0 | 6.194 | 10.042 | 0 | 278246392 | 668400144 | 342.7 | 130.7 | 6.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.201 | 7.377 | 8.55 | 0 | 6.81 / 4.22 | 7.625 | 8.55 | 0 | 6.259 | 7.377 | 0 | 278246392 | 668400144 | 338.8 | 128.5 | 6.7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.279 | 8.92 | 16.077 | 0 | 6.59 / 4.3 | 11.32 | 16.077 | 0 | 6.361 | 7.947 | 0 | 278246392 | 668400144 | 327.4 | 133.7 | 6.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.31 | 9.282 | 14.168 | 0 | 6.59 / 6.87 | 8.272 | 9.648 | 0 | 6.341 | 9.684 | 0 | 278246392 | 668400144 | 347.7 | 135.9 | 7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.366 | 8.74 | 11.526 | 0 | 6.64 / 4.69 | 8.011 | 8.679 | 0 | 6.508 | 9.343 | 0 | 278246392 | 668400144 | 342.8 | 138.4 | 7 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.191 | 7.137 | 8.027 | 0 | 8.03 / 5.89 | 7.471 | 7.622 | 0 | 0.184 | 0.341 | 0 | 196055280 | 668400144 | 332.3 | 157.9 | 2.1 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.183 | 6.891 | 8.033 | 0 | 8.03 / 4.24 | 7.406 | 7.529 | 0 | 0.175 | 0.242 | 0 | 196055280 | 668400144 | 352.8 | 141.1 | 2.1 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.185 | 7.042 | 7.783 | 0 | 7.15 / 5.07 | 7.384 | 7.783 | 0 | 0.179 | 0.367 | 0 | 196055280 | 668400144 | 344.1 | 135.8 | 2.1 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 8.001 | 9.002 | 0 | 0 | 8.131 | 9.179 | 0 | 13.9 |
| 128 MiB fixed | 1 | schedstat | 8.023 | 10.93 | 0 | 0 | 8.5 | 10.976 | 0 | 14.3 |
| 512 MiB fixed | 1 | schedstat | 7.972 | 9.945 | 0 | 0 | 7.66 | 9.361 | 0 | 11.1 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 7.143 | 8.002 | 0 | 0 | 7.435 | 8.095 | 0 | 10.4 |

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
