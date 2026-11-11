# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 233.1 s across 307 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:scenario-marble-bowl` | 18731 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:engine-state-hash-1024` | 17674 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-determinism` | 15787 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:gc-witness` | 15528 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:engine-tiers` | 14870 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:elevation-ab` | 9073 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:pose-allocations` | 8974 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:scenario-boss-fight` | 8826 | yes | Six runs per tier on four tiers. |
| `check:engine-job-wait` | 8599 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:engine-threads` | 6546 | yes | Runs the threaded scenario at several worker counts. |
| `check:height-cpu` | 6032 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:alloc-audit` | 5937 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:sphere-population` | 4797 |  | Places the full sphere population and checks every member. |
| `check:app-watch` | 4575 |  | Waits on real file-watch events. |
| `check:vegetation-allocations` | 3848 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:engine-release` | 3742 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:heightmap-cli` | 3731 |  | Runs the heightmap CLI once per fixture case. |
| `check:scenario-combat-bots` | 3430 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:scenario-deathrun` | 3345 | yes | Six runs per tier on four tiers. |
| `check:scenario-lockstep-rts` | 3046 | yes | Six peers per tier on four tiers. |
| `check:scenario-allocations` | 2670 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:mapspinner-atmosphere` | 2400 |  | Integrates the atmosphere tables against spoint values. |
| `check:vegetation-generate-cost` | 2322 |  | Times 512 patches of 1024 instances and 128 patches of 8439. |
| `check:thread-sampler` | 2066 | yes | Samples real threads over a timed window. |
| `check:snapshots` | 1832 |  |  |
| `check:planet-witness-scene` | 1769 |  |  |
| `check:own-display` | 1705 |  |  |
| `check:scenario-character-terrain` | 1686 | yes |  |
| `check:scenario-settle` | 1454 | yes |  |
| `check:scenario-projectile-volley` | 1319 | yes |  |
| `check:scenario-planet-landing` | 1286 | yes |  |
| `check:planet-scene-counts` | 1235 |  |  |
| `check:types` | 1196 |  |  |
| `check:engine-shapecast` | 1136 |  |  |
| `check:scenario-character` | 1115 | yes |  |
| `check:engine-seal` | 1109 |  |  |
| `check:engine-raycast` | 1070 |  |  |
| `check:gc-reuse-rows` | 1044 |  |  |
| `check:upload-writes` | 991 |  |  |
| `check:create-app` | 963 |  |  |
| `check:netcode` | 930 |  |  |
| `check:wireweave-relay` | 920 |  |  |
| `check:pose-replay` | 820 |  |  |
| `check:upload-handler` | 815 |  |  |
| `check:engine-host-witness` | 808 |  |  |
| `check:engine-awake-budget` | 778 |  |  |
| `check:crowd-dot-buffer` | 743 |  |  |
| `check:planet-witness` | 694 |  |  |
| `check:transport` | 685 |  |  |
| `check:terrain-agreement` | 685 |  |  |
| `build:kernel` | 665 |  |  |
| `check:project-naming` | 587 |  |  |
| `check:socket-server` | 540 |  |  |
| `check:engine-warm` | 523 |  |  |
| `check:engine-pools` | 498 |  |  |
| `check:engine-airborne` | 481 |  |  |
| `check:sharding` | 400 |  |  |
| `check:collision-placement-options` | 379 |  |  |
| `check:engine-world` | 355 |  |  |
| `check:stall-attribution` | 351 |  |  |
| `check:world` | 342 |  |  |
| `check:world-query` | 330 |  |  |
| `check:engine-vegetation` | 329 |  |  |
| `check:physics-pure` | 327 |  |  |
| `check:kernel` | 324 |  |  |
| `check:world-config` | 320 |  |  |
| `check:engine-materials` | 312 |  |  |
| `check:ccd` | 309 |  |  |
| `check:vehicles-spoint` | 257 |  |  |
| `check:vehicle-refusal-spoint` | 241 |  |  |
| `check:physics-integration-vehicles` | 235 |  |  |
| `check:collision-mirror` | 233 |  |  |
| `check:packages` | 232 |  |  |
| `check:webgpu-profile` | 232 |  |  |
| `check:dormant-budget-spoint` | 224 |  |  |
| `check:sdk-surfaces` | 223 |  |  |
| `check:engine-bridge` | 223 |  |  |
| `check:collision-tile-streamer` | 222 |  |  |
| `check:raycast-spoint` | 220 |  |  |
| `check:engine-planet` | 212 |  |  |
| `check:dormant-spoint` | 204 |  |  |
| `check:fire` | 203 |  |  |
| `check:overlap-spoint` | 201 |  |  |
| `check:vehicle-remove-spoint` | 199 |  |  |
| `check:site-world` | 198 |  |  |
| `check:player-vat-spoint` | 198 |  |  |
| `check:engine-budget-floor` | 196 |  |  |
| `check:engine-sleep` | 195 |  |  |
| `check:chart-state-live` | 189 |  |  |
| `check:collision-host` | 188 |  |  |
| `check:rebase-session` | 183 |  |  |
| `check:player-lod-renderer` | 180 |  |  |
| `check:player-dot-material-spoint` | 177 |  |  |
| `check:player-lod-renderer-webgpu` | 175 |  |  |
| `check:recast-bake-spoint` | 175 |  |  |
| `check:streaming-gltf-mesh` | 172 |  |  |
| `check:bloom-spoint` | 169 |  |  |
| `check:player-dot-shader-spoint` | 168 |  |  |
| `check:camera-relative` | 168 |  |  |
| `check:decode-path` | 158 |  |  |
| `check:terrain-static` | 155 |  |  |
| `check:scene-setup-spoint` | 150 |  |  |
| `check:upstream-builtin-nav` | 148 |  |  |
| `check:streamer-p99` | 147 |  |  |
| `check:cluster-lod-spoint` | 146 |  |  |
| `check:vegetation-leaf-patches` | 140 |  |  |
| `check:engine-core` | 137 |  |  |
| `check:engine-leak` | 137 |  |  |
| `check:ci-engine-glue` | 130 |  |  |
| `check:engine-codecs` | 130 |  |  |
| `check:fire-modules` | 129 |  |  |
| `check:engine-interest` | 129 |  |  |
| `check:lockstep` | 127 |  |  |
| `check:terrain-pure` | 125 |  |  |
| `check:sample-order` | 121 |  |  |
| `check:vat-spoint` | 119 |  |  |
| `check:follow-misuse` | 115 |  |  |
| `check:tick-governor` | 110 | yes |  |
| `check:spline-erosion-witness` | 110 |  |  |
| `check:ssr-spoint` | 110 |  |  |
| `check:timed-result` | 108 |  |  |
| `check:sessions` | 107 |  |  |
| `check:fsr1-spoint` | 107 |  |  |
| `check:bin-snapshot` | 104 |  |  |
| `check:chart-anchor` | 102 |  |  |
| `check:script-limits` | 102 |  |  |
| `check:client-resource-pools` | 99 |  |  |
| `check:socket-upgrade` | 98 |  |  |
| `check:glue-tier` | 96 |  |  |
| `check:replay-file` | 94 |  |  |
| `check:procgen` | 92 |  |  |
| `check:import-scene` | 92 |  |  |
| `check:behaviours` | 86 |  |  |
| `check:client-pure` | 86 |  |  |
| `check:lag-compensation` | 84 |  |  |
| `check:replay-player` | 84 |  |  |
| `check:collider-streamer` | 84 |  |  |
| `check:player-collisions` | 84 |  |  |
| `check:spoint-core-rust` | 78 |  |  |
| `check:upstream-skill-registry` | 77 |  |  |
| `check:snapshot-lod` | 76 |  |  |
| `check:client-message-handler` | 76 |  |  |
| `check:app-loader` | 75 |  |  |
| `check:protocol` | 74 |  |  |
| `check:rollback` | 74 |  |  |
| `check:sdk-misc` | 74 |  |  |
| `check:engine-render` | 74 |  |  |
| `check:netcode-small` | 73 |  |  |
| `check:lod-tiers` | 73 |  |  |
| `check:spawn` | 72 |  |  |
| `check:animation-control` | 72 |  |  |
| `check:protocol-codecs` | 71 |  |  |
| `check:msgpackr-compat` | 71 |  |  |
| `check:prediction-engine` | 71 |  |  |
| `check:entity-host` | 71 |  |  |
| `check:msgpack-packer` | 71 |  |  |
| `check:replay-dialect` | 71 |  |  |
| `check:vegetation-stream` | 71 |  |  |
| `check:negative-zero` | 70 |  |  |
| `check:frame-stall-cause` | 70 |  |  |
| `check:tick-authority` | 69 |  |  |
| `check:game-systems-spoint` | 69 |  |  |
| `check:wireweave-frame-spoint` | 69 |  |  |
| `check:kaggle-regress` | 69 |  |  |
| `check:paint-store` | 67 |  |  |
| `check:streaming-gltf-queues` | 67 |  |  |
| `check:chart-reanchor` | 67 |  |  |
| `check:snapshot-packer` | 67 |  |  |
| `check:bundle-freshness-jayzee` | 66 |  |  |
| `check:cluster-handoff` | 66 |  |  |
| `check:snapshot-processor` | 66 |  |  |
| `check:behaviours-c` | 66 |  |  |
| `check:upload-route` | 66 |  |  |
| `check:player-lod-plan` | 66 |  |  |
| `check:anticheat-spoint` | 65 |  |  |
| `check:game-systems` | 65 |  |  |
| `check:aoi` | 65 |  |  |
| `check:upstream-builtin-bodies` | 65 |  |  |
| `check:apps-b` | 65 |  |  |
| `check:reduced-pose` | 65 |  |  |
| `check:controlled-run` | 65 |  |  |
| `check:upstream-skill-bodies` | 64 |  |  |
| `check:upstream-builtin-lighting` | 64 |  |  |
| `check:client-machines` | 64 |  |  |
| `check:mat4-spoint` | 64 |  |  |
| `check:event-log` | 63 |  |  |
| `check:behaviour-health-destructible` | 63 |  |  |
| `check:sdk-editor` | 63 |  |  |
| `check:chart-migrators` | 63 |  |  |
| `check:chart-state-server` | 63 |  |  |
| `check:hot-reload-spoint` | 63 |  |  |
| `check:engine-artifacts` | 63 |  |  |
| `check:tail-report` | 63 |  |  |
| `check:sandbox` | 62 |  |  |
| `check:clusters` | 62 |  |  |
| `check:upstream-builtin-noise` | 62 |  |  |
| `check:shared-pure` | 62 |  |  |
| `check:client-pure-rows` | 62 |  |  |
| `check:client-tier-split` | 62 |  |  |
| `check:client-loops` | 61 |  |  |
| `check:telemetry` | 61 |  |  |
| `check:component-pool` | 61 |  |  |
| `check:blend-tree-spoint` | 61 |  |  |
| `check:hygiene` | 61 |  |  |
| `check:spawn-named-errors` | 60 |  |  |
| `check:world-persistence` | 60 |  |  |
| `check:behaviours-a` | 60 |  |  |
| `check:behaviours-b` | 60 |  |  |
| `check:paired-report` | 60 |  |  |
| `check:site` | 59 |  |  |
| `check:pathfinding` | 59 |  |  |
| `check:octree` | 59 |  |  |
| `check:row16-client-decoder` | 59 |  |  |
| `check:upstream-door-routes` | 59 |  |  |
| `check:asset-pipeline` | 59 |  |  |
| `check:upstream-builtin-math` | 58 |  |  |
| `check:hot-reload` | 57 |  |  |
| `check:world-def-clusters` | 57 |  |  |
| `check:frequency-runs` | 57 |  |  |
| `check:physics-extras` | 56 |  |  |
| `check:app-behaviours` | 56 |  |  |
| `check:engine-isolation` | 56 |  |  |
| `check:stage` | 55 |  |  |
| `check:chart-transfer` | 55 |  |  |
| `check:upstream-door-dispatch` | 55 |  |  |
| `check:apps-a` | 55 |  |  |
| `check:client-pure-spoint` | 55 |  |  |
| `check:minidump` | 55 |  |  |
| `check:feature-gap` | 54 |  |  |
| `check:rollback-peer` | 54 |  |  |
| `check:crowd-dot-cells-spoint` | 54 |  |  |
| `check:stall-off-cpu` | 54 |  |  |
| `check:sampler-gap-attribution` | 54 |  |  |
| `check:planet-gap-class` | 54 |  |  |
| `check:upstream-endpoints` | 53 |  |  |
| `check:render` | 53 |  |  |
| `check:upstream-builtin-vec3` | 53 |  |  |
| `check:upstream-builtin-physics` | 53 |  |  |
| `check:network-state` | 53 |  |  |
| `check:camera-rig` | 53 |  |  |
| `check:cluster-slice` | 53 |  |  |
| `check:spawn-captured-names` | 53 |  |  |
| `check:engine-solver-tier` | 53 |  |  |
| `check:anticheat` | 52 |  |  |
| `check:upstream-tome-bodies` | 52 |  |  |
| `check:editor-serialize` | 52 |  |  |
| `check:navmesh-query-spoint` | 52 |  |  |
| `check:stall-probe` | 52 |  |  |
| `check:browser-heap` | 52 |  |  |
| `check:upstream-doors` | 51 |  |  |
| `check:upstream-builtin-env` | 51 |  |  |
| `check:upstream-builtin-tsl` | 51 |  |  |
| `check:upstream-builtin-vibe` | 51 |  |  |
| `check:app-runtime-state` | 51 |  |  |
| `check:player-id` | 51 |  |  |
| `check:physics-integration` | 51 |  |  |
| `check:material-tier-swap-spoint` | 51 |  |  |
| `check:consensus` | 50 |  |  |
| `check:upstream-reference` | 50 |  |  |
| `check:pool-params-spoint` | 50 |  |  |
| `check:messages` | 49 |  |  |
| `check:character-step` | 49 |  |  |
| `check:flight-model` | 49 |  |  |
| `check:heightfield-physics` | 49 |  |  |
| `check:upstream-builtin-postfx` | 49 |  |  |
| `check:upstream-builtin-spline` | 49 |  |  |
| `check:upstream-builtin-three` | 49 |  |  |
| `check:spawn-captured-bodies` | 49 |  |  |
| `check:collision-placement` | 49 |  |  |
| `check:relative-residuals` | 49 |  |  |
| `check:rollback-bridge` | 48 |  |  |
| `check:tick-order` | 48 |  |  |
| `check:upstream-tome-lookup` | 48 |  |  |
| `check:upstream-builtins` | 48 |  |  |
| `check:upstream-builtin-easing` | 48 |  |  |
| `check:world-resolver` | 48 |  |  |
| `check:upstream-tome` | 47 |  |  |
| `check:upstream-builtin-path` | 47 |  |  |
| `check:upstream-builtin-voxels` | 47 |  |  |
| `check:postfx-shaders-spoint` | 47 |  |  |
| `check:render-1024-visible` | 47 |  |  |
| `check:engine-visibility` | 47 |  |  |
| `check:transport-framing` | 46 |  |  |
| `check:movement` | 46 |  |  |
| `check:upstream-builtin-ballistics` | 46 |  |  |
| `check:upstream-builtin-fx` | 46 |  |  |
| `check:vec3-read` | 46 |  |  |
| `check:cube-sphere-cell-key-spoint` | 46 |  |  |
| `check:animation` | 45 |  |  |
| `check:relocation-solve` | 45 |  |  |
| `check:tick-scheduler` | 45 |  |  |
| `check:worker-bridge` | 45 |  |  |
| `check:upstream-builtin-tween` | 45 |  |  |
| `check:reexpress-records` | 45 |  |  |
| `check:named-asset-redirect` | 44 |  |  |
| `check:upstream-builtin-room-routing` | 44 |  |  |
| `check:upstream-builtin-terrain` | 44 |  |  |
| `check:upstream-builtin-water` | 44 |  |  |
| `check:collider-layers` | 44 |  |  |
| `check:upstream-skills` | 43 |  |  |
| `check:hook-order` | 43 |  |  |
| `check:jolt-limits` | 42 |  |  |
| `check:vehicle-tuning` | 42 |  |  |
| `check:worker-dispatch` | 42 |  |  |
| `check:chromium-launcher` | 42 |  |  |
| `check:content` | 41 |  |  |
| `check:constraint-limits` | 41 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 35. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T20:53:04.732Z. Queue wait 7 s from the push to the first line of the script. Run time 299.2 s for 28 of 28 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.06 | 11.234 | 17.062 | 1 | 8.16 / 4.72 | 12.122 | 17.062 | 1 | 7.058 | 8.858 | 0 | 278248248 | 668400144 | 1211.4 | 888.4 | 9.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.934 | 10.924 | 18.075 | 1 | 8.3 / 4.82 | 13.118 | 18.075 | 1 | 6.942 | 8.868 | 0 | 278248248 | 668400144 | 1082.5 | 790.6 | 9.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.059 | 11.768 | 20.333 | 1 | 8.12 / 5.04 | 13.909 | 15.708 | 0 | 7.143 | 9.238 | 1 | 278248248 | 668400144 | 1149.8 | 882.3 | 9.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.987 | 11.644 | 19.214 | 1 | 8.53 / 4.86 | 14.261 | 19.214 | 1 | 7.062 | 9.137 | 0 | 278248248 | 668400144 | 1090.8 | 786.5 | 9.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.066 | 10.858 | 14.693 | 0 | 7.69 / 4.89 | 12.089 | 14.693 | 0 | 7.132 | 9.05 | 0 | 278248248 | 668400144 | 1083.8 | 786.7 | 9.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.998 | 11.563 | 15.526 | 0 | 8.32 / 5.07 | 9.245 | 10.331 | 0 | 7.147 | 12.223 | 0 | 278248248 | 668400144 | 1103.7 | 881.1 | 9.7 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.021 | 10.926 | 21.129 | 3 | 7.97 / 4.84 | 8.845 | 10.559 | 0 | 7.142 | 11.55 | 3 | 278248248 | 668400144 | 1118.9 | 806.3 | 9.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.858 | 10.526 | 16.716 | 1 | 7.49 / 4.97 | 9.22 | 10.323 | 0 | 6.953 | 11.367 | 1 | 278248248 | 668400144 | 1096.5 | 838.5 | 9.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.942 | 11.209 | 14.708 | 0 | 7.77 / 4.69 | 8.915 | 10.138 | 0 | 7.054 | 11.933 | 0 | 278248248 | 668400144 | 1139.2 | 883.8 | 9.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.912 | 11.464 | 15.202 | 0 | 8.13 / 4.69 | 8.828 | 10.069 | 0 | 7.027 | 11.883 | 0 | 278248248 | 668400144 | 1129.3 | 875.2 | 9.7 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 12.359 | 16.496 | 21.669 | 8 | 9.51 / 6.46 | 14.646 | 14.883 | 0 | 12.7 | 18.776 | 8 | 278248248 | 668203536 | 1102.3 | 803.6 | 14.3 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 8.798 | 11.526 | 14.507 | 0 | 8.87 / 5.52 | 12.576 | 14.065 | 0 | 8.836 | 11.364 | 0 | 278248248 | 668269072 | 1086.5 | 778.9 | 11.1 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 7.98 | 10.368 | 13.663 | 0 | 8.39 / 5.15 | 11.746 | 13.663 | 0 | 8.111 | 10.125 | 0 | 278248248 | 668334608 | 1090.8 | 782.7 | 10.4 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 7.185 | 9.66 | 11.326 | 0 | 8.22 / 4.95 | 9.713 | 11.326 | 0 | 7.339 | 9.553 | 0 | 278248248 | 668531216 | 1094.8 | 798.4 | 9.8 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 8.335 | 10.613 | 12.334 | 0 | 8.39 / 5.36 | 10.626 | 12.334 | 0 | 8.528 | 10.613 | 0 | 278248248 | 668400144 | 1171.8 | 828.1 | 10.9 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 7.408 | 10.614 | 45.208 | 4 | 45.21 / 10.07 | 16.722 | 37.129 | 3 | 7.494 | 9.435 | 0 | 278248248 | 668400144 |  | 804.4 | 8.9 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.973 | 8.936 | 10.962 | 0 | 10.96 / 5.02 | 10.607 | 10.936 | 0 | 0.939 | 1.235 | 0 | 196055280 | 668400144 | 1092.4 | 903.2 | 4.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.862 | 9.197 | 14.72 | 0 | 7.49 / 4.9 | 9.644 | 10.666 | 0 | 6.869 | 9.197 | 0 | 405657056 | 668400144 | 1093.6 | 794.3 | 22.1 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.09 | 10.297 | 16.029 | 0 | 7.23 / 4.39 | 7.854 | 10.042 | 0 | 6.186 | 10.984 | 0 | 222472736 | 668400144 | 1097.7 | 798.6 | 7.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.931 | 7.177 | 8.501 | 0 | 7.43 / 4.36 | 7.177 | 7.959 | 0 | 5.911 | 7.168 | 0 | 222620160 | 668400144 | 1123.6 | 793.5 | 7.1 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.088 | 7.507 | 10.519 | 0 | 7.16 / 4.22 | 7.445 | 9.094 | 0 | 6.171 | 7.523 | 0 | 222423696 | 668400144 | 1175.2 | 794.9 | 7.3 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.107 | 9.7 | 12.056 | 0 | 7.18 / 4.48 | 11.798 | 12.056 | 0 | 6.086 | 7.409 | 0 | 222580688 | 668400144 | 1079.9 | 788.7 | 7.3 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 10.999 | 12.998 | 0 | 0 | 11.187 | 12.459 | 0 | 19.5 |
| 128 MiB fixed | 1 | schedstat | 12.963 | 15.799 | 0 | 0 | 12.988 | 16.083 | 0 | 19.6 |
| 512 MiB fixed | 1 | schedstat | 11.897 | 14.793 | 0 | 0 | 11.846 | 14.448 | 0 | 15.4 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.007 | 8 | 0 | 0 | 6.441 | 8.246 | 0 | 14.1 |

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
