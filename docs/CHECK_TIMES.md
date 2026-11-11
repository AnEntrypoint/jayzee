# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 227.7 s across 307 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:engine-state-hash-1024` | 18371 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-determinism` | 17099 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:scenario-marble-bowl` | 15952 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:engine-tiers` | 15560 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:gc-witness` | 14366 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:pose-allocations` | 10745 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:elevation-ab` | 9349 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:engine-job-wait` | 8115 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:alloc-audit` | 6376 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:sphere-population` | 6273 |  | Places the full sphere population and checks every member. |
| `check:height-cpu` | 6021 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:heightmap-cli` | 4928 |  | Runs the heightmap CLI once per fixture case. |
| `check:app-watch` | 4584 |  | Waits on real file-watch events. |
| `check:engine-release` | 4367 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:vegetation-allocations` | 3626 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:scenario-deathrun` | 2919 | yes | Six runs per tier on four tiers. |
| `check:scenario-lockstep-rts` | 2852 | yes | Six peers per tier on four tiers. |
| `check:scenario-boss-fight` | 2798 | yes | Six runs per tier on four tiers. |
| `check:scenario-combat-bots` | 2648 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:mapspinner-atmosphere` | 2252 |  | Integrates the atmosphere tables against spoint values. |
| `check:scenario-allocations` | 2169 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:engine-threads` | 2161 | yes | Runs the threaded scenario at several worker counts. |
| `check:vegetation-generate-cost` | 2150 |  | Times 512 patches of 1024 instances and 128 patches of 8439. |
| `check:thread-sampler` | 2053 | yes | Samples real threads over a timed window. |
| `check:own-display` | 1859 |  |  |
| `check:planet-witness-scene` | 1722 |  |  |
| `check:snapshots` | 1644 |  |  |
| `check:scenario-character-terrain` | 1631 | yes |  |
| `check:engine-shapecast` | 1333 |  |  |
| `check:types` | 1328 |  |  |
| `check:engine-raycast` | 1305 |  |  |
| `check:scenario-projectile-volley` | 1285 | yes |  |
| `check:engine-seal` | 1257 |  |  |
| `check:gc-reuse-rows` | 1220 |  |  |
| `check:planet-scene-counts` | 1213 |  |  |
| `check:scenario-planet-landing` | 1169 | yes |  |
| `check:scenario-settle` | 1156 | yes |  |
| `check:upload-writes` | 1031 |  |  |
| `check:engine-host-witness` | 1010 |  |  |
| `check:planet-witness` | 959 |  |  |
| `check:scenario-character` | 957 | yes |  |
| `check:wireweave-relay` | 889 |  |  |
| `check:create-app` | 872 |  |  |
| `check:transport` | 867 |  |  |
| `check:netcode` | 863 |  |  |
| `check:pose-replay` | 862 |  |  |
| `check:upload-handler` | 853 |  |  |
| `check:engine-awake-budget` | 805 |  |  |
| `check:engine-warm` | 793 |  |  |
| `check:crowd-dot-buffer` | 750 |  |  |
| `check:project-naming` | 741 |  |  |
| `check:terrain-agreement` | 732 |  |  |
| `check:socket-server` | 591 |  |  |
| `check:engine-pools` | 427 |  |  |
| `build:kernel` | 423 |  |  |
| `check:sharding` | 409 |  |  |
| `check:engine-airborne` | 406 |  |  |
| `check:engine-world` | 402 |  |  |
| `check:engine-vegetation` | 391 |  |  |
| `check:world` | 383 |  |  |
| `check:stall-attribution` | 365 |  |  |
| `check:world-config` | 361 |  |  |
| `check:world-query` | 357 |  |  |
| `check:ccd` | 354 |  |  |
| `check:engine-materials` | 353 |  |  |
| `check:kernel` | 351 |  |  |
| `check:physics-pure` | 351 |  |  |
| `check:collision-placement-options` | 333 |  |  |
| `check:vehicles-spoint` | 310 |  |  |
| `check:physics-integration-vehicles` | 291 |  |  |
| `check:collision-mirror` | 283 |  |  |
| `check:sdk-surfaces` | 273 |  |  |
| `check:engine-budget-floor` | 271 |  |  |
| `check:dormant-spoint` | 270 |  |  |
| `check:packages` | 269 |  |  |
| `check:engine-planet` | 269 |  |  |
| `check:webgpu-profile` | 263 |  |  |
| `check:engine-bridge` | 258 |  |  |
| `check:chart-state-live` | 253 |  |  |
| `check:player-vat-spoint` | 252 |  |  |
| `check:collision-host` | 248 |  |  |
| `check:raycast-spoint` | 248 |  |  |
| `check:vehicle-refusal-spoint` | 244 |  |  |
| `check:dormant-budget-spoint` | 243 |  |  |
| `check:collision-tile-streamer` | 240 |  |  |
| `check:engine-sleep` | 238 |  |  |
| `check:player-lod-renderer` | 235 |  |  |
| `check:overlap-spoint` | 230 |  |  |
| `check:vehicle-remove-spoint` | 223 |  |  |
| `check:rebase-session` | 221 |  |  |
| `check:site-world` | 209 |  |  |
| `check:recast-bake-spoint` | 208 |  |  |
| `check:camera-relative` | 202 |  |  |
| `check:fire` | 200 |  |  |
| `check:player-lod-renderer-webgpu` | 189 |  |  |
| `check:player-dot-material-spoint` | 180 |  |  |
| `check:scene-setup-spoint` | 174 |  |  |
| `check:upstream-builtin-nav` | 173 |  |  |
| `check:player-dot-shader-spoint` | 168 |  |  |
| `check:bloom-spoint` | 162 |  |  |
| `check:fire-modules` | 157 |  |  |
| `check:streaming-gltf-mesh` | 157 |  |  |
| `check:streamer-p99` | 155 |  |  |
| `check:terrain-static` | 154 |  |  |
| `check:decode-path` | 153 |  |  |
| `check:vegetation-leaf-patches` | 150 |  |  |
| `check:engine-leak` | 146 |  |  |
| `check:terrain-pure` | 143 |  |  |
| `check:cluster-lod-spoint` | 143 |  |  |
| `check:lockstep` | 136 |  |  |
| `check:sample-order` | 134 |  |  |
| `check:engine-core` | 134 |  |  |
| `check:follow-misuse` | 127 |  |  |
| `check:engine-codecs` | 127 |  |  |
| `check:engine-interest` | 127 |  |  |
| `check:kaggle-regress` | 125 |  |  |
| `check:vat-spoint` | 123 |  |  |
| `check:ssr-spoint` | 117 |  |  |
| `check:ci-engine-glue` | 117 |  |  |
| `check:fsr1-spoint` | 114 |  |  |
| `check:glue-tier` | 114 |  |  |
| `check:chart-anchor` | 112 |  |  |
| `check:socket-upgrade` | 111 |  |  |
| `check:timed-result` | 111 |  |  |
| `check:spline-erosion-witness` | 110 |  |  |
| `check:script-limits` | 109 |  |  |
| `check:bin-snapshot` | 105 |  |  |
| `check:client-pure` | 105 |  |  |
| `check:client-resource-pools` | 105 |  |  |
| `check:sessions` | 103 |  |  |
| `check:import-scene` | 97 |  |  |
| `check:procgen` | 95 |  |  |
| `check:replay-player` | 92 |  |  |
| `check:vegetation-stream` | 92 |  |  |
| `check:client-message-handler` | 91 |  |  |
| `check:lag-compensation` | 90 |  |  |
| `check:upstream-skill-registry` | 90 |  |  |
| `check:collider-streamer` | 90 |  |  |
| `check:crowd-dot-cells-spoint` | 88 |  |  |
| `check:protocol-codecs` | 87 |  |  |
| `check:player-lod-plan` | 87 |  |  |
| `check:prediction-engine` | 86 |  |  |
| `check:lod-tiers` | 86 |  |  |
| `check:spoint-core-rust` | 86 |  |  |
| `check:replay-file` | 85 |  |  |
| `check:snapshot-lod` | 84 |  |  |
| `check:player-collisions` | 84 |  |  |
| `check:tick-governor` | 83 | yes |  |
| `check:shared-pure` | 83 |  |  |
| `check:frame-stall-cause` | 83 |  |  |
| `check:sdk-misc` | 81 |  |  |
| `check:network-state` | 81 |  |  |
| `check:protocol` | 80 |  |  |
| `check:behaviours` | 80 |  |  |
| `check:animation-control` | 80 |  |  |
| `check:upload-route` | 80 |  |  |
| `check:replay-dialect` | 80 |  |  |
| `check:snapshot-packer` | 78 |  |  |
| `check:spawn-captured-names` | 78 |  |  |
| `check:game-systems` | 77 |  |  |
| `check:streaming-gltf-queues` | 77 |  |  |
| `check:chart-migrators` | 77 |  |  |
| `check:netcode-small` | 77 |  |  |
| `check:rollback` | 76 |  |  |
| `check:behaviours-c` | 76 |  |  |
| `check:app-behaviours` | 76 |  |  |
| `check:spawn` | 75 |  |  |
| `check:cluster-handoff` | 75 |  |  |
| `check:upstream-builtin-three` | 75 |  |  |
| `check:hot-reload-spoint` | 75 |  |  |
| `check:upstream-builtin-water` | 74 |  |  |
| `check:reduced-pose` | 74 |  |  |
| `check:msgpack-packer` | 74 |  |  |
| `check:controlled-run` | 74 |  |  |
| `check:aoi` | 73 |  |  |
| `check:reexpress-records` | 73 |  |  |
| `check:camera-rig` | 73 |  |  |
| `check:chart-state-server` | 73 |  |  |
| `check:negative-zero` | 73 |  |  |
| `check:wireweave-frame-spoint` | 73 |  |  |
| `check:engine-render` | 73 |  |  |
| `check:msgpackr-compat` | 72 |  |  |
| `check:pathfinding` | 72 |  |  |
| `check:chart-reanchor` | 72 |  |  |
| `check:upstream-skill-bodies` | 72 |  |  |
| `check:paint-store` | 71 |  |  |
| `check:behaviour-health-destructible` | 71 |  |  |
| `check:cube-sphere-cell-key-spoint` | 71 |  |  |
| `check:sdk-editor` | 70 |  |  |
| `check:vec3-read` | 70 |  |  |
| `check:asset-pipeline` | 70 |  |  |
| `check:world-persistence` | 69 |  |  |
| `check:entity-host` | 69 |  |  |
| `check:engine-artifacts` | 69 |  |  |
| `check:app-loader` | 68 |  |  |
| `check:mat4-spoint` | 68 |  |  |
| `check:clusters` | 67 |  |  |
| `check:upstream-builtin-lighting` | 67 |  |  |
| `check:upstream-builtin-noise` | 67 |  |  |
| `check:upstream-builtin-spline` | 67 |  |  |
| `check:behaviours-a` | 67 |  |  |
| `check:physics-extras` | 66 |  |  |
| `check:event-log` | 66 |  |  |
| `check:tick-authority` | 66 |  |  |
| `check:row16-client-decoder` | 66 |  |  |
| `check:chart-transfer` | 66 |  |  |
| `check:upstream-builtin-bodies` | 66 |  |  |
| `check:editor-serialize` | 66 |  |  |
| `check:world-resolver` | 66 |  |  |
| `check:hygiene` | 66 |  |  |
| `check:feature-gap` | 65 |  |  |
| `check:anticheat-spoint` | 64 |  |  |
| `check:snapshot-processor` | 64 |  |  |
| `check:upstream-builtins` | 64 |  |  |
| `check:game-systems-spoint` | 64 |  |  |
| `check:render` | 63 |  |  |
| `check:bundle-freshness-jayzee` | 63 |  |  |
| `check:octree` | 63 |  |  |
| `check:material-tier-swap-spoint` | 63 |  |  |
| `check:upstream-endpoints` | 62 |  |  |
| `check:stage` | 62 |  |  |
| `check:apps-b` | 62 |  |  |
| `check:client-machines` | 62 |  |  |
| `check:client-tier-split` | 62 |  |  |
| `check:sampler-gap-attribution` | 62 |  |  |
| `check:paired-report` | 61 |  |  |
| `check:upstream-door-routes` | 60 |  |  |
| `check:apps-a` | 60 |  |  |
| `check:client-pure-rows` | 60 |  |  |
| `check:cluster-slice` | 60 |  |  |
| `check:minidump` | 60 |  |  |
| `check:site` | 59 |  |  |
| `check:transport-framing` | 59 |  |  |
| `check:telemetry` | 59 |  |  |
| `check:app-runtime-state` | 59 |  |  |
| `check:world-def-clusters` | 59 |  |  |
| `check:client-loops` | 58 |  |  |
| `check:animation` | 58 |  |  |
| `check:behaviours-b` | 58 |  |  |
| `check:navmesh-query-spoint` | 58 |  |  |
| `check:frequency-runs` | 58 |  |  |
| `check:sandbox` | 57 |  |  |
| `check:upstream-reference` | 57 |  |  |
| `check:upstream-door-dispatch` | 56 |  |  |
| `check:upstream-tome-bodies` | 56 |  |  |
| `check:engine-isolation` | 56 |  |  |
| `check:upstream-builtin-math` | 55 |  |  |
| `check:upstream-builtin-env` | 55 |  |  |
| `check:upstream-builtin-physics` | 55 |  |  |
| `check:upstream-builtin-path` | 55 |  |  |
| `check:upstream-builtin-tween` | 55 |  |  |
| `check:pool-params-spoint` | 55 |  |  |
| `check:engine-visibility` | 55 |  |  |
| `check:spawn-named-errors` | 54 |  |  |
| `check:consensus` | 54 |  |  |
| `check:client-pure-spoint` | 54 |  |  |
| `check:stall-off-cpu` | 54 |  |  |
| `check:rollback-bridge` | 53 |  |  |
| `check:tick-scheduler` | 53 |  |  |
| `check:upstream-tome` | 53 |  |  |
| `check:stall-probe` | 53 |  |  |
| `check:physics-integration` | 52 |  |  |
| `check:upstream-tome-lookup` | 51 |  |  |
| `check:upstream-builtin-easing` | 51 |  |  |
| `check:upstream-builtin-voxels` | 51 |  |  |
| `check:blend-tree-spoint` | 51 |  |  |
| `check:browser-heap` | 51 |  |  |
| `check:tail-report` | 51 |  |  |
| `check:anticheat` | 50 |  |  |
| `check:upstream-builtin-room-routing` | 50 |  |  |
| `check:upstream-builtin-vibe` | 50 |  |  |
| `check:component-pool` | 50 |  |  |
| `check:spawn-captured-bodies` | 50 |  |  |
| `check:collision-placement` | 50 |  |  |
| `check:relative-residuals` | 50 |  |  |
| `check:messages` | 49 |  |  |
| `check:hot-reload` | 49 |  |  |
| `check:heightfield-physics` | 49 |  |  |
| `check:hook-order` | 49 |  |  |
| `check:postfx-shaders-spoint` | 49 |  |  |
| `check:engine-solver-tier` | 49 |  |  |
| `check:upstream-doors` | 48 |  |  |
| `check:upstream-skills` | 48 |  |  |
| `check:upstream-builtin-vec3` | 48 |  |  |
| `check:upstream-builtin-tsl` | 48 |  |  |
| `check:player-id` | 48 |  |  |
| `check:collider-layers` | 48 |  |  |
| `check:rollback-peer` | 47 |  |  |
| `check:relocation-solve` | 47 |  |  |
| `check:worker-bridge` | 47 |  |  |
| `check:upstream-builtin-fx` | 47 |  |  |
| `check:upstream-builtin-postfx` | 47 |  |  |
| `check:upstream-builtin-terrain` | 47 |  |  |
| `check:character-step` | 46 |  |  |
| `check:constraint-limits` | 46 |  |  |
| `check:named-asset-redirect` | 46 |  |  |
| `check:upstream-builtin-ballistics` | 46 |  |  |
| `check:jolt-limits` | 45 |  |  |
| `check:movement` | 45 |  |  |
| `check:render-1024-visible` | 45 |  |  |
| `check:planet-gap-class` | 45 |  |  |
| `check:content` | 44 |  |  |
| `check:worker-dispatch` | 44 |  |  |
| `check:flight-model` | 43 |  |  |
| `check:vehicle-tuning` | 43 |  |  |
| `check:tick-order` | 43 |  |  |
| `check:chromium-launcher` | 42 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 39. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T23:03:10.203Z. Queue wait 6 s from the push to the first line of the script. Run time 624.6 s for 42 of 42 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone none holds it.
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone none holds it.
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.606 | 11.079 | 14.12 | 0 | 7.95 / 5.17 | 12.925 | 14.12 | 0 | 7.624 | 9.896 | 0 | 278248248 | 668400144 | 1255.2 | 1055.9 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.636 | 10.801 | 12.793 | 0 | 8.41 / 5.63 | 12.544 | 12.793 | 0 | 7.755 | 10.215 | 0 | 278248248 | 668400144 | 1136.3 | 1042.2 | 10.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.742 | 10.569 | 18.504 | 1 | 7.94 / 5.2 | 10.611 | 18.504 | 1 | 7.938 | 10.569 | 0 | 278248248 | 668400144 | 1159.2 | 1076.9 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.677 | 10.391 | 13.78 | 0 | 8.92 / 5.15 | 10.882 | 13.78 | 0 | 7.869 | 10.2 | 0 | 278248248 | 668400144 | 1159.3 | 1132.4 | 10.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.83 | 10.495 | 11.486 | 0 | 7.85 / 5.11 | 10.356 | 11.486 | 0 | 8.012 | 10.573 | 0 | 278248248 | 668400144 | 1224.1 | 1015.3 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.912 | 12.605 | 15.526 | 0 | 9.84 / 5.12 | 11.188 | 14.26 | 0 | 8.018 | 12.996 | 0 | 278248248 | 668400144 | 1262.8 | 1089.9 | 11 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.718 | 13.109 | 15.843 | 0 | 8.47 / 5.22 | 10.316 | 11.402 | 0 | 7.879 | 13.851 | 0 | 278248248 | 668400144 | 1157.7 | 996.7 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.495 | 12.089 | 18.295 | 1 | 8.54 / 5.23 | 10.586 | 11.518 | 0 | 7.625 | 12.774 | 1 | 278248248 | 668400144 | 1201.2 | 1063.7 | 10.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.465 | 11.492 | 21.33 | 1 | 7.87 / 5.85 | 9.375 | 11.003 | 0 | 7.674 | 12.508 | 1 | 278248248 | 668400144 | 1161.8 | 962.5 | 10.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.865 | 14.159 | 17.831 | 1 | 8.64 / 5.13 | 10.702 | 11.219 | 0 | 7.955 | 15.06 | 1 | 278248248 | 668400144 | 1170 | 1040.1 | 10.8 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 14.26 | 20.835 | 22.301 | 90 | 10.75 / 6.85 | 19.209 | 21.833 | 18 | 14.556 | 20.879 | 72 | 278248248 | 668203536 | 1274.3 | 1118.1 | 16.5 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 10.213 | 14.416 | 18.725 | 1 | 10.81 / 6.45 | 14.769 | 16.676 | 0 | 10.436 | 14.222 | 1 | 278248248 | 668269072 | 1279.1 | 1018.1 | 12.9 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 8.84 | 11.77 | 12.778 | 0 | 9.33 / 5.95 | 11.77 | 12.763 | 0 | 8.931 | 11.896 | 0 | 278248248 | 668334608 | 1153.2 | 1023.4 | 11.5 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 7.782 | 10.453 | 11.197 | 0 | 8.71 / 5.04 | 10.453 | 11.194 | 0 | 7.982 | 10.567 | 0 | 278248248 | 668531216 | 1232.3 | 1047.9 | 10.7 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 9.051 | 12.839 | 17.187 | 1 | 8.74 / 5.57 | 12.167 | 12.839 | 0 | 9.302 | 13.416 | 1 | 278248248 | 668400144 | 1372.9 | 983 | 11.9 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 8.465 | 14.629 | 35.042 | 4 | 35.04 / 10.69 | 14.041 | 22.226 | 1 | 8.461 | 14.748 | 2 | 278248248 | 668400144 |  | 830.5 | 10 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 1.189 | 8.563 | 12.948 | 0 | 8.22 / 5.74 | 9.916 | 12.948 | 0 | 1.111 | 2.222 | 0 | 196055280 | 668400144 | 1168.8 | 1080.6 | 5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.838 | 11.576 | 15.882 | 0 | 8.33 / 5.03 | 15.124 | 15.882 | 0 | 7.867 | 11.048 | 0 | 405657056 | 668400144 | 1212.6 | 1059.4 | 25.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.914 | 10.412 | 14.562 | 0 | 7.28 / 4.97 | 9.945 | 10.7 | 0 | 6.93 | 11.91 | 0 | 222472736 | 668400144 | 1175.5 | 1126.6 | 8.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.703 | 8.988 | 11.117 | 0 | 7.96 / 4.69 | 8.629 | 9.359 | 0 | 6.635 | 9.031 | 0 | 222620160 | 668400144 | 1230.8 | 1046.3 | 8.1 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.983 | 9.27 | 11.788 | 0 | 8.56 / 5.11 | 9.06 | 10.496 | 0 | 6.989 | 9.273 | 0 | 222423696 | 668400144 | 1361.7 | 1088.8 | 8.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.711 | 11.195 | 15.769 | 0 | 7.49 / 4.57 | 13.819 | 15.769 | 0 | 6.692 | 8.775 | 0 | 222580688 | 668400144 | 1154.1 | 994.9 | 8.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.521 | 12.555 | 17.066 | 1 | 12.44 / 8.28 | 15.738 | 17.066 | 1 | 8.7 | 11.378 | 0 | 278248248 | 668400144 | 1212.4 | 1176.1 | 11.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.316 | 12.249 | 18.873 | 2 | 10.78 / 5.62 | 15.458 | 18.873 | 2 | 8.432 | 11.07 | 0 | 278248248 | 668400144 | 1187.8 | 1090.3 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.456 | 11.121 | 11.849 | 0 | 11.21 / 5.66 | 11.247 | 11.849 | 0 | 8.538 | 10.962 | 0 | 278248248 | 668400144 | 1196.2 | 1012.9 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.412 | 11.818 | 15.671 | 0 | 10.93 / 5.82 | 11.34 | 13.262 | 0 | 8.512 | 12.116 | 0 | 278248248 | 668400144 | 1221.4 | 997.8 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.221 | 12.793 | 22.772 | 2 | 11.2 / 5.89 | 11.6 | 12.206 | 0 | 8.2 | 13.148 | 2 | 278248248 | 668400144 | 1181.2 | 1078.4 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.342 | 13.573 | 18.675 | 1 | 12.38 / 5.77 | 11.705 | 13.34 | 0 | 8.44 | 14.157 | 1 | 278248248 | 668400144 | 1180.1 | 967.8 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.351 | 14.116 | 18.692 | 1 | 10.31 / 5.5 | 11.292 | 12.55 | 0 | 8.484 | 16.114 | 1 | 278248248 | 668400144 | 1197.8 | 1128.3 | 11.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.292 | 12.455 | 17.654 | 2 | 11.6 / 5.67 | 11.558 | 14.018 | 0 | 8.463 | 13.156 | 2 | 278248248 | 668400144 | 1200.3 | 996.9 | 11.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.388 | 12.965 | 20.709 | 1 | 10.89 / 5.57 | 15.832 | 20.709 | 1 | 8.394 | 11.01 | 0 | 278248248 | 668400144 | 1195.3 | 972.5 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.047 | 12.315 | 17.45 | 3 | 10.96 / 5.78 | 16.956 | 17.45 | 3 | 8.147 | 10.268 | 0 | 278248248 | 668400144 | 1174.3 | 976 | 10.8 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 13.09 | 19.025 | 1 | 0 | 13.643 | 20.069 | 1 | 21.5 |
| 128 MiB fixed | 1 | schedstat | 13.96 | 17.951 | 2 | 0 | 14.15 | 17.534 | 2 | 20.8 |
| 512 MiB fixed | 1 | schedstat | 12.446 | 15.836 | 0 | 0 | 12.71 | 16.914 | 1 | 16.7 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 7.999 | 9.116 | 0 | 0 | 8.505 | 11.453 | 0 | 15.6 |

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
