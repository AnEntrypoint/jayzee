# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 209.3 s across 307 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:engine-host-witness` | 20517 |  | Compiles the native witness when a source under engine/src or engine/test changed; 0.4 s otherwise. |
| `check:scenario-determinism` | 15233 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:engine-state-hash-1024` | 14802 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-marble-bowl` | 14634 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:gc-witness` | 12608 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:engine-tiers` | 11664 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:engine-job-wait` | 8301 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:elevation-ab` | 7529 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:pose-allocations` | 5940 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:height-cpu` | 4922 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:app-watch` | 4580 |  | Waits on real file-watch events. |
| `check:sphere-population` | 4210 |  | Places the full sphere population and checks every member. |
| `check:alloc-audit` | 4049 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:vegetation-allocations` | 3804 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:engine-release` | 3454 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:heightmap-cli` | 3112 |  | Runs the heightmap CLI once per fixture case. |
| `check:scenario-deathrun` | 2840 | yes | Six runs per tier on four tiers. |
| `check:scenario-lockstep-rts` | 2766 | yes | Six peers per tier on four tiers. |
| `check:scenario-boss-fight` | 2758 | yes | Six runs per tier on four tiers. |
| `check:scenario-combat-bots` | 2749 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:engine-threads` | 2273 | yes | Runs the threaded scenario at several worker counts. |
| `check:scenario-allocations` | 2130 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:thread-sampler` | 2050 | yes | Samples real threads over a timed window. |
| `check:vegetation-generate-cost` | 2001 |  | Times 512 patches of 1024 instances and 128 patches of 8439. |
| `check:mapspinner-atmosphere` | 1898 |  |  |
| `check:own-display` | 1846 |  |  |
| `check:scenario-character-terrain` | 1514 | yes |  |
| `check:planet-witness-scene` | 1507 |  |  |
| `check:snapshots` | 1428 |  |  |
| `check:scenario-projectile-volley` | 1294 | yes |  |
| `check:scenario-planet-landing` | 1212 | yes |  |
| `check:types` | 1113 |  |  |
| `check:scenario-settle` | 1093 | yes |  |
| `check:engine-raycast` | 1041 |  |  |
| `check:engine-seal` | 1028 |  |  |
| `check:engine-shapecast` | 1022 |  |  |
| `check:scenario-character` | 1007 | yes |  |
| `check:gc-reuse-rows` | 993 |  |  |
| `check:planet-scene-counts` | 937 |  |  |
| `check:wireweave-relay` | 789 |  |  |
| `check:create-app` | 751 |  |  |
| `check:netcode` | 746 |  |  |
| `check:upload-writes` | 744 |  |  |
| `check:crowd-dot-buffer` | 650 |  |  |
| `check:upload-handler` | 635 |  |  |
| `check:engine-awake-budget` | 596 |  |  |
| `check:terrain-agreement` | 593 |  |  |
| `check:pose-replay` | 566 |  |  |
| `check:planet-witness` | 527 |  |  |
| `check:transport` | 520 |  |  |
| `check:engine-warm` | 499 |  |  |
| `check:socket-server` | 444 |  |  |
| `build:kernel` | 403 |  |  |
| `check:project-naming` | 385 |  |  |
| `check:stall-attribution` | 354 |  |  |
| `check:engine-pools` | 353 |  |  |
| `check:sharding` | 349 |  |  |
| `check:engine-airborne` | 339 |  |  |
| `check:collision-placement-options` | 291 |  |  |
| `check:world-query` | 285 |  |  |
| `check:kernel` | 279 |  |  |
| `check:world-config` | 279 |  |  |
| `check:engine-world` | 277 |  |  |
| `check:world` | 274 |  |  |
| `check:engine-materials` | 267 |  |  |
| `check:ccd` | 264 |  |  |
| `check:physics-pure` | 263 |  |  |
| `check:engine-vegetation` | 256 |  |  |
| `check:engine-planet` | 243 |  |  |
| `check:vehicles-spoint` | 233 |  |  |
| `check:dormant-spoint` | 230 |  |  |
| `check:packages` | 225 |  |  |
| `check:raycast-spoint` | 222 |  |  |
| `check:physics-integration-vehicles` | 222 |  |  |
| `check:collision-mirror` | 219 |  |  |
| `check:sdk-surfaces` | 213 |  |  |
| `check:collision-tile-streamer` | 211 |  |  |
| `check:overlap-spoint` | 204 |  |  |
| `check:webgpu-profile` | 202 |  |  |
| `check:vehicle-remove-spoint` | 196 |  |  |
| `check:fire` | 192 |  |  |
| `check:site-world` | 192 |  |  |
| `check:collision-host` | 190 |  |  |
| `check:vehicle-refusal-spoint` | 190 |  |  |
| `check:dormant-budget-spoint` | 185 |  |  |
| `check:chart-state-live` | 185 |  |  |
| `check:engine-budget-floor` | 181 |  |  |
| `check:engine-bridge` | 179 |  |  |
| `check:player-vat-spoint` | 174 |  |  |
| `check:engine-sleep` | 166 |  |  |
| `check:player-lod-renderer` | 165 |  |  |
| `check:rebase-session` | 160 |  |  |
| `check:recast-bake-spoint` | 157 |  |  |
| `check:player-lod-renderer-webgpu` | 144 |  |  |
| `check:player-dot-shader-spoint` | 142 |  |  |
| `check:decode-path` | 141 |  |  |
| `check:bloom-spoint` | 140 |  |  |
| `check:streaming-gltf-mesh` | 137 |  |  |
| `check:player-dot-material-spoint` | 135 |  |  |
| `check:streamer-p99` | 134 |  |  |
| `check:cluster-lod-spoint` | 131 |  |  |
| `check:terrain-static` | 130 |  |  |
| `check:engine-leak` | 127 |  |  |
| `check:fire-modules` | 124 |  |  |
| `check:scene-setup-spoint` | 124 |  |  |
| `check:camera-relative` | 120 |  |  |
| `check:upstream-builtin-nav` | 118 |  |  |
| `check:vegetation-leaf-patches` | 118 |  |  |
| `check:lockstep` | 115 |  |  |
| `check:ssr-spoint` | 112 |  |  |
| `check:engine-interest` | 112 |  |  |
| `check:vat-spoint` | 108 |  |  |
| `check:ci-engine-glue` | 108 |  |  |
| `check:engine-codecs` | 108 |  |  |
| `check:follow-misuse` | 106 |  |  |
| `check:engine-core` | 106 |  |  |
| `check:terrain-pure` | 102 |  |  |
| `check:sample-order` | 101 |  |  |
| `check:sessions` | 95 |  |  |
| `check:bin-snapshot` | 93 |  |  |
| `check:tick-governor` | 93 | yes |  |
| `check:glue-tier` | 93 |  |  |
| `check:fsr1-spoint` | 90 |  |  |
| `check:spline-erosion-witness` | 89 |  |  |
| `check:script-limits` | 89 |  |  |
| `check:chart-anchor` | 87 |  |  |
| `check:client-resource-pools` | 86 |  |  |
| `check:client-pure` | 85 |  |  |
| `check:socket-upgrade` | 83 |  |  |
| `check:import-scene` | 82 |  |  |
| `check:timed-result` | 82 |  |  |
| `check:procgen` | 81 |  |  |
| `check:spoint-core-rust` | 81 |  |  |
| `check:replay-file` | 77 |  |  |
| `check:snapshot-packer` | 73 |  |  |
| `check:behaviours` | 72 |  |  |
| `check:player-collisions` | 72 |  |  |
| `check:lag-compensation` | 71 |  |  |
| `check:upstream-skill-registry` | 71 |  |  |
| `check:vegetation-stream` | 71 |  |  |
| `check:player-lod-plan` | 70 |  |  |
| `check:replay-player` | 69 |  |  |
| `check:client-message-handler` | 69 |  |  |
| `check:collider-streamer` | 69 |  |  |
| `check:lod-tiers` | 69 |  |  |
| `check:prediction-engine` | 66 |  |  |
| `check:shared-pure` | 66 |  |  |
| `check:frame-stall-cause` | 66 |  |  |
| `check:protocol-codecs` | 65 |  |  |
| `check:streaming-gltf-queues` | 65 |  |  |
| `check:replay-dialect` | 65 |  |  |
| `check:kaggle-regress` | 65 |  |  |
| `check:behaviour-health-destructible` | 64 |  |  |
| `check:snapshot-lod` | 64 |  |  |
| `check:sdk-misc` | 64 |  |  |
| `check:behaviours-c` | 64 |  |  |
| `check:protocol` | 63 |  |  |
| `check:game-systems` | 63 |  |  |
| `check:upload-route` | 63 |  |  |
| `check:bundle-freshness-jayzee` | 62 |  |  |
| `check:animation-control` | 62 |  |  |
| `check:cluster-handoff` | 62 |  |  |
| `check:engine-artifacts` | 62 |  |  |
| `check:controlled-run` | 62 |  |  |
| `check:engine-render` | 62 |  |  |
| `check:spawn` | 61 |  |  |
| `check:paint-store` | 61 |  |  |
| `check:chart-reanchor` | 61 |  |  |
| `check:upstream-skill-bodies` | 61 |  |  |
| `check:hot-reload-spoint` | 61 |  |  |
| `check:wireweave-frame-spoint` | 61 |  |  |
| `check:mat4-spoint` | 61 |  |  |
| `check:msgpackr-compat` | 60 |  |  |
| `check:rollback` | 60 |  |  |
| `check:tick-authority` | 60 |  |  |
| `check:snapshot-processor` | 60 |  |  |
| `check:netcode-small` | 60 |  |  |
| `check:game-systems-spoint` | 60 |  |  |
| `check:hygiene` | 60 |  |  |
| `check:entity-host` | 59 |  |  |
| `check:msgpack-packer` | 59 |  |  |
| `check:upstream-builtin-bodies` | 58 |  |  |
| `check:client-machines` | 58 |  |  |
| `check:chart-migrators` | 58 |  |  |
| `check:reduced-pose` | 58 |  |  |
| `check:negative-zero` | 58 |  |  |
| `check:render` | 57 |  |  |
| `check:aoi` | 57 |  |  |
| `check:event-log` | 57 |  |  |
| `check:app-loader` | 57 |  |  |
| `check:world-persistence` | 56 |  |  |
| `check:row16-client-decoder` | 56 |  |  |
| `check:upstream-builtin-noise` | 56 |  |  |
| `check:cluster-slice` | 56 |  |  |
| `check:pathfinding` | 55 |  |  |
| `check:rollback-bridge` | 55 |  |  |
| `check:sdk-editor` | 55 |  |  |
| `check:behaviours-a` | 55 |  |  |
| `check:chart-state-server` | 55 |  |  |
| `check:client-tier-split` | 55 |  |  |
| `check:anticheat-spoint` | 54 |  |  |
| `check:feature-gap` | 54 |  |  |
| `check:octree` | 54 |  |  |
| `check:material-tier-swap-spoint` | 54 |  |  |
| `check:sampler-gap-attribution` | 54 |  |  |
| `check:anticheat` | 53 |  |  |
| `check:upstream-door-routes` | 53 |  |  |
| `check:apps-a` | 53 |  |  |
| `check:apps-b` | 53 |  |  |
| `check:client-pure-rows` | 53 |  |  |
| `check:sandbox` | 52 |  |  |
| `check:chart-transfer` | 52 |  |  |
| `check:telemetry` | 52 |  |  |
| `check:stage` | 51 |  |  |
| `check:consensus` | 51 |  |  |
| `check:physics-integration` | 51 |  |  |
| `check:paired-report` | 51 |  |  |
| `check:render-1024-visible` | 51 |  |  |
| `check:relative-residuals` | 51 |  |  |
| `check:spawn-named-errors` | 50 |  |  |
| `check:upstream-builtin-vec3` | 50 |  |  |
| `check:upstream-builtin-physics` | 50 |  |  |
| `check:upstream-builtin-voxels` | 50 |  |  |
| `check:behaviours-b` | 50 |  |  |
| `check:stall-off-cpu` | 50 |  |  |
| `check:client-loops` | 49 |  |  |
| `check:upstream-tome-bodies` | 49 |  |  |
| `check:upstream-tome-lookup` | 49 |  |  |
| `check:upstream-builtin-easing` | 49 |  |  |
| `check:upstream-builtin-env` | 49 |  |  |
| `check:postfx-shaders-spoint` | 49 |  |  |
| `check:minidump` | 49 |  |  |
| `check:engine-visibility` | 49 |  |  |
| `check:physics-extras` | 48 |  |  |
| `check:clusters` | 48 |  |  |
| `check:upstream-builtin-lighting` | 48 |  |  |
| `check:editor-serialize` | 48 |  |  |
| `check:app-runtime-state` | 48 |  |  |
| `check:navmesh-query-spoint` | 48 |  |  |
| `check:client-pure-spoint` | 48 |  |  |
| `check:stall-probe` | 48 |  |  |
| `check:frequency-runs` | 48 |  |  |
| `check:browser-heap` | 48 |  |  |
| `check:engine-solver-tier` | 48 |  |  |
| `check:collision-placement` | 48 |  |  |
| `check:tick-order` | 47 |  |  |
| `check:upstream-door-dispatch` | 47 |  |  |
| `check:upstream-builtins` | 47 |  |  |
| `check:reexpress-records` | 47 |  |  |
| `check:world-resolver` | 47 |  |  |
| `check:crowd-dot-cells-spoint` | 47 |  |  |
| `check:spawn-captured-names` | 47 |  |  |
| `check:upstream-endpoints` | 46 |  |  |
| `check:transport-framing` | 46 |  |  |
| `check:animation` | 46 |  |  |
| `check:tick-scheduler` | 46 |  |  |
| `check:upstream-reference` | 46 |  |  |
| `check:upstream-builtin-spline` | 46 |  |  |
| `check:upstream-builtin-three` | 46 |  |  |
| `check:upstream-builtin-water` | 46 |  |  |
| `check:app-behaviours` | 46 |  |  |
| `check:vec3-read` | 46 |  |  |
| `check:network-state` | 46 |  |  |
| `check:camera-rig` | 46 |  |  |
| `check:cube-sphere-cell-key-spoint` | 46 |  |  |
| `check:asset-pipeline` | 46 |  |  |
| `check:engine-isolation` | 46 |  |  |
| `check:site` | 45 |  |  |
| `check:upstream-tome` | 45 |  |  |
| `check:upstream-builtin-math` | 45 |  |  |
| `check:upstream-builtin-path` | 45 |  |  |
| `check:upstream-builtin-tween` | 45 |  |  |
| `check:world-def-clusters` | 45 |  |  |
| `check:pool-params-spoint` | 45 |  |  |
| `check:tail-report` | 45 |  |  |
| `check:planet-gap-class` | 45 |  |  |
| `check:messages` | 44 |  |  |
| `check:relocation-solve` | 44 |  |  |
| `check:upstream-doors` | 44 |  |  |
| `check:upstream-skills` | 44 |  |  |
| `check:named-asset-redirect` | 44 |  |  |
| `check:upstream-builtin-ballistics` | 44 |  |  |
| `check:collider-layers` | 44 |  |  |
| `check:hot-reload` | 43 |  |  |
| `check:worker-bridge` | 43 |  |  |
| `check:upstream-builtin-fx` | 43 |  |  |
| `check:upstream-builtin-postfx` | 43 |  |  |
| `check:upstream-builtin-terrain` | 43 |  |  |
| `check:upstream-builtin-tsl` | 43 |  |  |
| `check:component-pool` | 43 |  |  |
| `check:blend-tree-spoint` | 43 |  |  |
| `check:movement` | 42 |  |  |
| `check:rollback-peer` | 42 |  |  |
| `check:hook-order` | 42 |  |  |
| `check:upstream-builtin-room-routing` | 42 |  |  |
| `check:upstream-builtin-vibe` | 42 |  |  |
| `check:spawn-captured-bodies` | 42 |  |  |
| `check:heightfield-physics` | 41 |  |  |
| `check:character-step` | 40 |  |  |
| `check:player-id` | 40 |  |  |
| `check:flight-model` | 38 |  |  |
| `check:jolt-limits` | 37 |  |  |
| `check:vehicle-tuning` | 37 |  |  |
| `check:worker-dispatch` | 37 |  |  |
| `check:content` | 36 |  |  |
| `check:constraint-limits` | 36 |  |  |
| `check:chromium-launcher` | 36 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 38. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T22:34:45.115Z. Queue wait 7 s from the push to the first line of the script. Run time 608.6 s for 58 of 58 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 2); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.422 | 10.824 | 32.632 | 1 | 8.3 / 7.77 | 13.324 | 32.632 | 1 | 6.419 | 8.485 | 0 | 278248248 | 668400144 | 1239.4 | 987.5 | 9.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.319 | 9.763 | 11.716 | 0 | 7.94 / 4.76 | 10.902 | 11.716 | 0 | 6.349 | 8.43 | 0 | 278248248 | 668400144 | 1131.7 | 1037.2 | 9.2 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.627 | 11.303 | 44.303 | 2 | 8.12 / 4.73 | 12.385 | 44.303 | 1 | 6.645 | 9.004 | 1 | 278248248 | 668400144 | 1245.5 | 1071.9 | 9.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.627 | 11.97 | 19.217 | 1 | 8 / 4.71 | 12.901 | 19.217 | 1 | 6.701 | 8.869 | 0 | 278248248 | 668400144 | 1150.7 | 1002.9 | 9.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.463 | 11.153 | 51.366 | 2 | 8.36 / 5.08 | 15.386 | 51.366 | 2 | 6.459 | 8.298 | 0 | 278248248 | 668400144 | 1156.8 | 1062.3 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.284 | 10.553 | 42.85 | 1 | 7.96 / 4.74 | 10.553 | 42.85 | 1 | 6.358 | 10.731 | 0 | 278248248 | 668400144 | 1138.3 | 1076.8 | 9.3 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.375 | 10.784 | 30.322 | 1 | 8.01 / 4.78 | 9.395 | 30.322 | 1 | 6.495 | 11.331 | 0 | 278248248 | 668400144 | 1210.9 | 1050.8 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.385 | 10.917 | 14.704 | 0 | 8.21 / 4.66 | 9.312 | 14.704 | 0 | 6.471 | 11.221 | 0 | 278248248 | 668400144 | 1149.8 | 1018.5 | 9.4 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.359 | 11.209 | 14.839 | 0 | 8.05 / 4.48 | 8.819 | 11.19 | 0 | 6.455 | 11.972 | 0 | 278248248 | 668400144 | 1252.5 | 1010.1 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.441 | 10.853 | 12.925 | 0 | 8.11 / 4.77 | 9.381 | 12.669 | 0 | 6.572 | 11.369 | 0 | 278248248 | 668400144 | 1151.8 | 1020.5 | 9.4 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 11.057 | 16.844 | 42.811 | 10 | 9.69 / 6.15 | 12.751 | 42.811 | 1 | 11.709 | 17.475 | 9 | 278248248 | 668203536 | 1155.1 | 980.1 | 13.5 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 8.722 | 12.584 | 15.499 | 0 | 8.68 / 5.32 | 11.685 | 12.584 | 0 | 8.827 | 13.459 | 0 | 278248248 | 668269072 | 1175.5 | 1007.2 | 11.4 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 7.485 | 10.933 | 33.248 | 1 | 8.47 / 5.45 | 13.449 | 33.248 | 1 | 7.509 | 9.486 | 0 | 278248248 | 668334608 | 1159.6 | 1054.4 | 10.4 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 6.566 | 10.793 | 16.911 | 1 | 8.14 / 4.78 | 14.752 | 16.911 | 1 | 6.623 | 8.713 | 0 | 278248248 | 668531216 | 1190.3 | 1012.3 | 9.7 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 8.068 | 13.263 | 21.793 | 2 | 8.79 / 5.58 | 16.384 | 21.793 | 2 | 8.172 | 10.081 | 0 | 278248248 | 668400144 | 1270.5 | 1024.9 | 11 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.604 | 12.403 | 30.451 | 2 | 30.45 / 8.59 | 14.493 | 24.783 | 1 | 6.657 | 8.675 | 0 | 278248248 | 668400144 |  | 877.6 | 8.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.799 | 6.436 | 8.255 | 0 | 8.25 / 4.25 | 6.795 | 8.197 | 0 | 0.781 | 1.143 | 0 | 196055280 | 668400144 | 1147.5 | 1032.6 | 4.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.564 | 9.21 | 24.379 | 1 | 7.99 / 4.78 | 8.859 | 24.379 | 1 | 6.604 | 9.213 | 0 | 405657056 | 668400144 | 1239.8 | 1028.2 | 21.9 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.002 | 7.478 | 8.801 | 0 | 8.05 / 4.22 | 7.811 | 8.801 | 0 | 6.01 | 7.374 | 0 | 222472736 | 668400144 | 1213 | 1110.5 | 7.6 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.665 | 6.993 | 7.638 | 0 | 7.56 / 4.21 | 7.084 | 7.638 | 0 | 5.645 | 6.891 | 0 | 222620160 | 668400144 | 1194.5 | 1024.5 | 7.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.974 | 9.546 | 11.583 | 0 | 7.53 / 4.38 | 10.18 | 11.072 | 0 | 5.976 | 7.368 | 0 | 222423696 | 668400144 | 1143.9 | 971.5 | 7.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.734 | 9.784 | 15.707 | 0 | 7.46 / 4.17 | 7.188 | 15.707 | 0 | 5.695 | 10.794 | 0 | 222580688 | 668400144 | 1155.8 | 1048.2 | 7.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.28 | 12.216 | 20.612 | 1 | 10.57 / 5.2 | 9.957 | 20.612 | 1 | 7.42 | 13.622 | 0 | 278248248 | 668400144 | 1205.2 | 1044.1 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.308 | 11.944 | 26.809 | 4 | 10.95 / 5.37 | 10.282 | 26.809 | 1 | 7.43 | 13.051 | 3 | 278248248 | 668400144 | 1215.4 | 1065.6 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.217 | 12.404 | 22.878 | 1 | 11.33 / 5.28 | 10.705 | 22.878 | 1 | 7.279 | 13.93 | 0 | 278248248 | 668400144 | 1227.3 | 1021.4 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.999 | 11.669 | 19.693 | 2 | 10.24 / 5.21 | 9.59 | 19.693 | 1 | 7.161 | 13.042 | 1 | 278248248 | 668400144 | 1271.5 | 1033.2 | 10.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.14 | 11.524 | 16.724 | 1 | 10.09 / 5.4 | 9.762 | 10.912 | 0 | 7.181 | 12.385 | 1 | 278248248 | 668400144 | 1214.5 | 1198.5 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.249 | 12.026 | 16.905 | 1 | 10.92 / 5.45 | 9.883 | 11.184 | 0 | 7.314 | 12.539 | 1 | 278248248 | 668400144 | 1197.7 | 968.1 | 10.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.175 | 12.54 | 17.415 | 2 | 12.23 / 5.36 | 9.506 | 13.711 | 0 | 7.27 | 12.984 | 2 | 278248248 | 668400144 | 1211 | 1032.9 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.355 | 11.092 | 16.218 | 0 | 10.81 / 5.32 | 9.834 | 15.861 | 0 | 7.468 | 11.55 | 0 | 278248248 | 668400144 | 1218.6 | 1083.6 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.366 | 12.969 | 19.087 | 2 | 10.95 / 5.49 | 9.786 | 14.713 | 0 | 7.518 | 13.786 | 2 | 278248248 | 668400144 | 1197.6 | 1030.2 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.391 | 11.526 | 15.795 | 0 | 9.96 / 5.56 | 10.397 | 12.112 | 0 | 7.484 | 11.591 | 0 | 278248248 | 668400144 | 1193 | 1059.7 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.447 | 10.931 | 19.141 | 1 | 10.68 / 5.35 | 13.65 | 19.141 | 1 | 7.543 | 9.494 | 0 | 278248248 | 668400144 | 1233.8 | 1067.3 | 10.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.432 | 11.645 | 17.093 | 1 | 11.59 / 5.42 | 14.937 | 17.093 | 1 | 7.519 | 9.709 | 0 | 278248248 | 668400144 | 1218.1 | 1030 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.125 | 12.797 | 17.689 | 2 | 10.91 / 5.63 | 15.073 | 17.689 | 2 | 7.162 | 10.055 | 0 | 278248248 | 668400144 | 1208.6 | 1144.2 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.151 | 11.559 | 19.136 | 1 | 10.79 / 5.48 | 14.385 | 19.136 | 1 | 7.218 | 9.325 | 0 | 278248248 | 668400144 | 1198.1 | 940.7 | 10.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.219 | 13.215 | 17.458 | 2 | 11.7 / 5.2 | 14.309 | 17.458 | 2 | 7.312 | 9.918 | 0 | 278248248 | 668400144 | 1188.1 | 1118 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.115 | 12.177 | 25.38 | 1 | 10.97 / 5.35 | 15.402 | 25.38 | 1 | 7.156 | 9.259 | 0 | 278248248 | 668400144 | 1189 | 1017.4 | 10.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.527 | 10.064 | 12.999 | 0 | 12.67 / 6.13 | 10.654 | 12.999 | 0 | 7.632 | 9.928 | 0 | 278248248 | 668400144 | 1181.8 | 1017.8 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.217 | 9.397 | 10.79 | 0 | 10.65 / 5.34 | 9.353 | 10.79 | 0 | 7.379 | 9.397 | 0 | 278248248 | 668400144 | 1201.5 | 1119.8 | 10.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.598 | 9.979 | 11.026 | 0 | 10.63 / 5.27 | 9.534 | 10.719 | 0 | 7.845 | 10.226 | 0 | 278248248 | 668400144 | 1186.6 | 1029.8 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.339 | 9.676 | 11.912 | 0 | 11.54 / 5.56 | 10.071 | 11.4 | 0 | 7.344 | 9.563 | 0 | 278248248 | 668400144 | 1234.9 | 1223.4 | 10.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.034 | 9.442 | 13.912 | 0 | 10.39 / 5.44 | 9.845 | 13.912 | 0 | 7.067 | 8.817 | 0 | 278248248 | 668400144 | 1283.5 | 961.9 | 10.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.461 | 9.805 | 12.772 | 0 | 10.59 / 5.25 | 9.575 | 12.772 | 0 | 7.59 | 9.805 | 0 | 278248248 | 668400144 | 1277.9 | 966.1 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.295 | 10.294 | 12.088 | 0 | 10.74 / 5.13 | 9.802 | 10.378 | 0 | 7.379 | 10.395 | 0 | 278248248 | 668400144 | 1238.3 | 911.4 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.328 | 12.766 | 20.92 | 1 | 11.3 / 5.44 | 10.66 | 12.264 | 0 | 7.33 | 13.483 | 1 | 278248248 | 668400144 | 1185.4 | 925.4 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.435 | 12.463 | 16.77 | 1 | 11.53 / 5.23 | 9.982 | 11.015 | 0 | 7.527 | 14.263 | 1 | 278248248 | 668400144 | 1193 | 892.6 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.267 | 12.82 | 17.257 | 1 | 11.13 / 5.52 | 9.536 | 13.348 | 0 | 7.368 | 13.3 | 1 | 278248248 | 668400144 | 1210.4 | 900.8 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.277 | 12.41 | 17.216 | 1 | 11.24 / 5.48 | 9.3 | 12.403 | 0 | 7.372 | 14.392 | 1 | 278248248 | 668400144 | 1221.6 | 902.4 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.371 | 11.238 | 17.184 | 2 | 10.94 / 5.39 | 9.283 | 11.008 | 0 | 7.503 | 13.957 | 2 | 278248248 | 668400144 | 1212 | 911.5 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.253 | 11.079 | 15.601 | 0 | 10.97 / 5.36 | 9.525 | 10.671 | 0 | 7.342 | 12.446 | 0 | 278248248 | 668400144 | 1198 | 895.9 | 10.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.133 | 11.67 | 14.584 | 0 | 12.01 / 5.24 | 9.179 | 11.924 | 0 | 7.223 | 12.198 | 0 | 278248248 | 668400144 | 1214 | 901.5 | 10.1 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 11.993 | 15.001 | 0 | 0 | 11.64 | 14.777 | 0 | 19.6 |
| 128 MiB fixed | 1 | schedstat | 11.02 | 12.011 | 0 | 0 | 11.059 | 12.243 | 0 | 19.8 |
| 512 MiB fixed | 1 | schedstat | 9.47 | 11 | 0 | 0 | 9.289 | 10.344 | 0 | 15.5 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.021 | 9 | 0 | 0 | 6.01 | 9.006 | 0 | 14 |

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
