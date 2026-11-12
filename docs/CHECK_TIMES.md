# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 172.6 s across 309 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:engine-state-hash-1024` | 16575 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-marble-bowl` | 15805 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:engine-tiers` | 11817 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:scenario-determinism` | 10268 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:pose-allocations` | 8699 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:elevation-ab` | 8574 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:engine-job-wait` | 7180 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:alloc-audit` | 5597 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:height-cpu` | 5091 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:sphere-population` | 4634 |  | Places the full sphere population and checks every member. |
| `check:app-watch` | 4578 |  | Waits on real file-watch events. |
| `check:heightmap-cli` | 3525 |  | Runs the heightmap CLI once per fixture case. |
| `check:vegetation-allocations` | 3325 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:engine-release` | 2864 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:engine-threads` | 2296 | yes | Runs the threaded scenario at several worker counts. |
| `check:kaggle-regress` | 2265 |  | NO REASON RECORDED |
| `check:scenario-allocations` | 2248 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:thread-sampler` | 2055 | yes | Samples real threads over a timed window. |
| `check:mapspinner-atmosphere` | 2035 |  | Integrates the atmosphere tables against spoint values. |
| `check:own-display` | 1847 |  |  |
| `check:vegetation-generate-cost` | 1368 |  |  |
| `check:scenario-deathrun` | 1333 | yes |  |
| `check:gc-witness` | 1279 |  |  |
| `check:types` | 1228 |  |  |
| `check:scenario-lockstep-rts` | 1225 | yes |  |
| `check:gc-reuse-rows` | 1204 |  |  |
| `check:scenario-boss-fight` | 1120 | yes |  |
| `check:scenario-combat-bots` | 980 | yes |  |
| `check:upload-writes` | 954 |  |  |
| `check:create-app` | 949 |  |  |
| `check:engine-host-witness` | 891 |  |  |
| `check:engine-footprint` | 869 |  |  |
| `check:wireweave-relay` | 858 |  |  |
| `check:crowd-dot-buffer` | 790 |  |  |
| `check:scenario-character-terrain` | 789 | yes |  |
| `check:package-surface` | 775 |  |  |
| `check:scenario-projectile-volley` | 770 | yes |  |
| `check:pose-replay` | 761 |  |  |
| `check:upload-handler` | 755 |  |  |
| `check:transport` | 745 |  |  |
| `check:planet-witness` | 743 |  |  |
| `check:planet-witness-scene` | 677 |  |  |
| `check:scenario-planet-landing` | 638 | yes |  |
| `check:scenario-settle` | 625 | yes |  |
| `check:engine-awake-budget` | 617 |  |  |
| `check:project-naming` | 572 |  |  |
| `check:engine-warm` | 532 |  |  |
| `check:socket-server` | 524 |  |  |
| `build:kernel` | 457 |  |  |
| `check:scenario-character` | 430 | yes |  |
| `check:engine-airborne` | 426 |  |  |
| `check:planet-scene-counts` | 393 |  |  |
| `check:sharding` | 388 |  |  |
| `check:engine-pools` | 378 |  |  |
| `check:engine-raycast` | 372 |  |  |
| `check:stall-attribution` | 358 |  |  |
| `check:engine-shapecast` | 331 |  |  |
| `check:engine-seal` | 330 |  |  |
| `check:collision-placement-options` | 322 |  |  |
| `check:physics-integration-vehicles` | 281 |  |  |
| `check:vehicles-spoint` | 273 |  |  |
| `check:terrain-agreement` | 272 |  |  |
| `check:sdk-surfaces` | 269 |  |  |
| `check:webgpu-profile` | 251 |  |  |
| `check:collision-mirror` | 250 |  |  |
| `check:packages` | 244 |  |  |
| `check:engine-vegetation` | 241 |  |  |
| `check:engine-world` | 237 |  |  |
| `check:collision-tile-streamer` | 229 |  |  |
| `check:raycast-spoint` | 216 |  |  |
| `check:site-world` | 214 |  |  |
| `check:chart-state-live` | 214 |  |  |
| `check:overlap-spoint` | 213 |  |  |
| `check:vehicle-remove-spoint` | 211 |  |  |
| `check:engine-materials` | 206 |  |  |
| `check:dormant-spoint` | 204 |  |  |
| `check:vehicle-refusal-spoint` | 204 |  |  |
| `check:player-vat-spoint` | 204 |  |  |
| `check:fire` | 203 |  |  |
| `check:collision-host` | 198 |  |  |
| `check:dormant-budget-spoint` | 198 |  |  |
| `check:player-lod-renderer` | 194 |  |  |
| `check:player-lod-renderer-webgpu` | 194 |  |  |
| `check:recast-bake-spoint` | 189 |  |  |
| `check:snapshots` | 187 |  |  |
| `check:player-dot-shader-spoint` | 179 |  |  |
| `check:netcode` | 177 |  |  |
| `check:streaming-gltf-mesh` | 173 |  |  |
| `check:upstream-builtin-nav` | 173 |  |  |
| `check:player-dot-material-spoint` | 171 |  |  |
| `check:engine-planet` | 168 |  |  |
| `check:fire-modules` | 166 |  |  |
| `check:camera-relative` | 166 |  |  |
| `check:rebase-session` | 164 |  |  |
| `check:engine-bridge` | 163 |  |  |
| `check:scene-setup-spoint` | 161 |  |  |
| `check:decode-path` | 160 |  |  |
| `check:terrain-static` | 158 |  |  |
| `check:bloom-spoint` | 158 |  |  |
| `check:engine-sleep` | 158 |  |  |
| `check:vegetation-leaf-patches` | 152 |  |  |
| `check:engine-budget-floor` | 151 |  |  |
| `check:cluster-lod-spoint` | 142 |  |  |
| `check:terrain-pure` | 140 |  |  |
| `check:engine-leak` | 139 |  |  |
| `check:engine-codecs` | 132 |  |  |
| `check:streamer-p99` | 129 |  |  |
| `check:engine-interest` | 129 |  |  |
| `check:spline-erosion-witness` | 128 |  |  |
| `check:vat-spoint` | 121 |  |  |
| `check:ci-engine-glue` | 121 |  |  |
| `check:engine-core` | 120 |  |  |
| `check:kernel` | 119 |  |  |
| `check:lockstep` | 119 |  |  |
| `check:chart-anchor` | 117 |  |  |
| `check:bin-snapshot` | 114 |  |  |
| `check:rollback` | 109 |  |  |
| `check:sample-order` | 107 |  |  |
| `check:ssr-spoint` | 105 |  |  |
| `check:timed-result` | 104 |  |  |
| `check:sessions` | 103 |  |  |
| `check:fsr1-spoint` | 103 |  |  |
| `check:glue-tier` | 103 |  |  |
| `check:tick-authority` | 102 |  |  |
| `check:socket-upgrade` | 102 |  |  |
| `check:snapshot-lod` | 100 |  |  |
| `check:client-resource-pools` | 97 |  |  |
| `check:import-scene` | 95 |  |  |
| `check:tick-governor` | 94 | yes |  |
| `check:client-pure` | 92 |  |  |
| `check:procgen` | 90 |  |  |
| `check:collider-streamer` | 90 |  |  |
| `check:spoint-core-rust` | 90 |  |  |
| `check:follow-misuse` | 89 |  |  |
| `check:behaviours` | 86 |  |  |
| `check:replay-file` | 85 |  |  |
| `check:lag-compensation` | 85 |  |  |
| `check:upstream-skill-registry` | 85 |  |  |
| `check:vegetation-stream` | 85 |  |  |
| `check:protocol-codecs` | 84 |  |  |
| `check:reduced-pose` | 84 |  |  |
| `check:physics-pure` | 82 |  |  |
| `check:snapshot-packer` | 82 |  |  |
| `check:player-collisions` | 82 |  |  |
| `check:lod-tiers` | 79 |  |  |
| `check:world` | 78 |  |  |
| `check:netcode-small` | 78 |  |  |
| `check:mat4-spoint` | 78 |  |  |
| `check:replay-player` | 77 |  |  |
| `check:msgpack-packer` | 77 |  |  |
| `check:aoi` | 76 |  |  |
| `check:prediction-engine` | 76 |  |  |
| `check:upstream-skill-bodies` | 76 |  |  |
| `check:msgpackr-compat` | 75 |  |  |
| `check:octree` | 75 |  |  |
| `check:animation-control` | 74 |  |  |
| `check:behaviours-c` | 74 |  |  |
| `check:wireweave-frame-spoint` | 74 |  |  |
| `check:controlled-run` | 74 |  |  |
| `check:sandbox` | 73 |  |  |
| `check:behaviours-a` | 73 |  |  |
| `check:client-message-handler` | 73 |  |  |
| `check:replay-dialect` | 73 |  |  |
| `check:stage` | 72 |  |  |
| `check:player-lod-plan` | 72 |  |  |
| `check:hot-reload-spoint` | 72 |  |  |
| `check:engine-render` | 72 |  |  |
| `check:spawn` | 71 |  |  |
| `check:cluster-handoff` | 71 |  |  |
| `check:chart-reanchor` | 71 |  |  |
| `check:sdk-misc` | 71 |  |  |
| `check:world-config` | 71 |  |  |
| `check:chart-state-server` | 71 |  |  |
| `check:negative-zero` | 71 |  |  |
| `check:game-systems` | 70 |  |  |
| `check:event-log` | 70 |  |  |
| `check:streaming-gltf-queues` | 70 |  |  |
| `check:frame-stall-cause` | 70 |  |  |
| `check:behaviour-health-destructible` | 69 |  |  |
| `check:shared-pure` | 69 |  |  |
| `check:upload-route` | 69 |  |  |
| `check:hygiene` | 69 |  |  |
| `check:paired-report` | 69 |  |  |
| `check:upstream-builtin-bodies` | 68 |  |  |
| `check:protocol` | 67 |  |  |
| `check:telemetry` | 67 |  |  |
| `check:upstream-door-routes` | 67 |  |  |
| `check:world-query` | 67 |  |  |
| `check:chart-migrators` | 67 |  |  |
| `check:paint-store` | 66 |  |  |
| `check:snapshot-processor` | 66 |  |  |
| `check:app-runtime-state` | 66 |  |  |
| `check:app-loader` | 66 |  |  |
| `check:world-persistence` | 65 |  |  |
| `check:sdk-editor` | 65 |  |  |
| `check:apps-a` | 65 |  |  |
| `check:apps-b` | 65 |  |  |
| `check:pathfinding` | 64 |  |  |
| `check:consensus` | 64 |  |  |
| `check:row16-client-decoder` | 64 |  |  |
| `check:client-tier-split` | 64 |  |  |
| `check:client-machines` | 63 |  |  |
| `check:game-systems-spoint` | 63 |  |  |
| `check:sampler-gap-attribution` | 63 |  |  |
| `check:anticheat-spoint` | 62 |  |  |
| `check:clusters` | 62 |  |  |
| `check:frequency-runs` | 62 |  |  |
| `check:cluster-slice` | 61 |  |  |
| `check:render` | 60 |  |  |
| `check:client-loops` | 60 |  |  |
| `check:bundle-freshness-jayzee` | 60 |  |  |
| `check:physics-extras` | 60 |  |  |
| `check:client-pure-rows` | 60 |  |  |
| `check:spawn-named-errors` | 59 |  |  |
| `check:upstream-builtin-noise` | 59 |  |  |
| `check:behaviours-b` | 59 |  |  |
| `check:editor-serialize` | 59 |  |  |
| `check:transport-framing` | 58 |  |  |
| `check:chart-transfer` | 58 |  |  |
| `check:upstream-tome-bodies` | 58 |  |  |
| `check:material-tier-swap-spoint` | 58 |  |  |
| `check:engine-artifacts` | 58 |  |  |
| `check:upstream-reference` | 57 |  |  |
| `check:app-behaviours` | 57 |  |  |
| `check:physics-integration` | 57 |  |  |
| `check:upstream-endpoints` | 56 |  |  |
| `check:navmesh-query-spoint` | 56 |  |  |
| `check:pool-params-spoint` | 56 |  |  |
| `check:feature-gap` | 55 |  |  |
| `check:stall-off-cpu` | 55 |  |  |
| `check:minidump` | 55 |  |  |
| `check:upstream-door-dispatch` | 54 |  |  |
| `check:upstream-builtin-easing` | 54 |  |  |
| `check:upstream-builtin-voxels` | 54 |  |  |
| `check:stall-probe` | 54 |  |  |
| `check:relative-residuals` | 54 |  |  |
| `check:upstream-tome-lookup` | 53 |  |  |
| `check:script-limits` | 53 |  |  |
| `check:upstream-builtin-env` | 53 |  |  |
| `check:upstream-builtin-lighting` | 53 |  |  |
| `check:asset-pipeline` | 53 |  |  |
| `check:rollback-bridge` | 52 |  |  |
| `check:upstream-builtins` | 52 |  |  |
| `check:ccd` | 52 |  |  |
| `check:upstream-builtin-tsl` | 52 |  |  |
| `check:player-id` | 52 |  |  |
| `check:world-def-clusters` | 52 |  |  |
| `check:network-state` | 52 |  |  |
| `check:chromium-launcher` | 52 |  |  |
| `check:upstream-builtin-physics` | 51 |  |  |
| `check:entity-host` | 51 |  |  |
| `check:crowd-dot-cells-spoint` | 51 |  |  |
| `check:spawn-captured-names` | 51 |  |  |
| `check:messages` | 50 |  |  |
| `check:anticheat` | 50 |  |  |
| `check:heightfield-physics` | 50 |  |  |
| `check:camera-rig` | 50 |  |  |
| `check:blend-tree-spoint` | 50 |  |  |
| `check:engine-visibility` | 50 |  |  |
| `check:collider-layers` | 50 |  |  |
| `check:rollback-peer` | 49 |  |  |
| `check:upstream-skills` | 49 |  |  |
| `check:postfx-shaders-spoint` | 49 |  |  |
| `check:client-pure-spoint` | 49 |  |  |
| `check:render-1024-visible` | 49 |  |  |
| `check:collision-placement` | 49 |  |  |
| `check:planet-gap-class` | 49 |  |  |
| `check:site` | 48 |  |  |
| `check:hot-reload` | 48 |  |  |
| `check:animation` | 48 |  |  |
| `check:tick-order` | 48 |  |  |
| `check:upstream-builtin-math` | 48 |  |  |
| `check:upstream-builtin-vec3` | 48 |  |  |
| `check:upstream-builtin-spline` | 48 |  |  |
| `check:upstream-builtin-three` | 48 |  |  |
| `check:upstream-builtin-tween` | 48 |  |  |
| `check:component-pool` | 48 |  |  |
| `check:cube-sphere-cell-key-spoint` | 48 |  |  |
| `check:content` | 47 |  |  |
| `check:character-step` | 47 |  |  |
| `check:movement` | 47 |  |  |
| `check:upstream-builtin-fx` | 47 |  |  |
| `check:upstream-builtin-vibe` | 47 |  |  |
| `check:upstream-builtin-water` | 47 |  |  |
| `check:vec3-read` | 47 |  |  |
| `check:tail-report` | 47 |  |  |
| `check:engine-isolation` | 47 |  |  |
| `check:tick-scheduler` | 46 |  |  |
| `check:upstream-doors` | 46 |  |  |
| `check:upstream-tome` | 46 |  |  |
| `check:upstream-builtin-postfx` | 46 |  |  |
| `check:upstream-builtin-path` | 46 |  |  |
| `check:upstream-builtin-terrain` | 46 |  |  |
| `check:reexpress-records` | 46 |  |  |
| `check:world-resolver` | 46 |  |  |
| `check:spawn-captured-bodies` | 46 |  |  |
| `check:browser-heap` | 46 |  |  |
| `check:flight-model` | 45 |  |  |
| `check:relocation-solve` | 45 |  |  |
| `check:constraint-limits` | 44 |  |  |
| `check:worker-dispatch` | 44 |  |  |
| `check:hook-order` | 44 |  |  |
| `check:named-asset-redirect` | 44 |  |  |
| `check:upstream-builtin-ballistics` | 44 |  |  |
| `check:upstream-builtin-room-routing` | 44 |  |  |
| `check:engine-solver-tier` | 44 |  |  |
| `check:jolt-limits` | 42 |  |  |
| `check:vehicle-tuning` | 42 |  |  |
| `check:worker-bridge` | 39 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 52. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-12T13:43:21.949Z. Queue wait 10 s from the push to the first line of the script. Run time 485.8 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 4).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone none holds it.
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone none holds it.
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 12288 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4); in the steady window alone 12288 bodies hold it (workers 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.359 | 9.559 | 13.931 | 0 | 7.56 / 3.97 | 9.343 | 9.743 | 0 | 6.437 | 10.299 | 0 | 278230008 | 668400144 | 479.6 | 177.8 | 7.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.44 | 9.962 | 13.25 | 0 | 6.82 / 3.86 | 8.921 | 9.17 | 0 | 6.609 | 11.497 | 0 | 278230008 | 668400144 | 437.6 | 170.1 | 7.8 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.519 | 9.262 | 11.35 | 0 | 7.08 / 4.02 | 9.058 | 11.35 | 0 | 6.739 | 9.287 | 0 | 278230008 | 668400144 | 460.4 | 175 | 7.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.678 | 9.503 | 27.473 | 1 | 7.08 / 4.26 | 10.337 | 27.473 | 1 | 6.8 | 9.503 | 0 | 278230008 | 668400144 | 541.7 | 176.4 | 8.2 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.42 | 11.094 | 13.371 | 0 | 7.05 / 4.17 | 12.642 | 13.371 | 0 | 6.42 | 8.686 | 0 | 278230008 | 668400144 | 434.6 | 197 | 7.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.653 | 9.763 | 12.108 | 0 | 7.04 / 4.06 | 7.522 | 9.148 | 0 | 5.794 | 10.572 | 0 | 278230008 | 668400144 | 398.6 | 165 | 7 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.577 | 7.335 | 11.297 | 0 | 6.4 / 3.78 | 7.85 | 8.346 | 0 | 5.681 | 7.335 | 0 | 278230008 | 668400144 | 375.5 | 162.1 | 6.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.621 | 7.33 | 9.231 | 0 | 7 / 3.88 | 8.073 | 9.231 | 0 | 5.767 | 7.33 | 0 | 278230008 | 668400144 | 413.7 | 217.6 | 6.9 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.601 | 9.752 | 13.494 | 0 | 6.81 / 3.95 | 8.407 | 9.107 | 0 | 5.702 | 10.373 | 0 | 278230008 | 668400144 | 391.7 | 186.2 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.638 | 9.957 | 13.511 | 0 | 6.88 / 3.81 | 7.668 | 9.611 | 0 | 5.735 | 10.15 | 0 | 278230008 | 668400144 | 395.1 | 240.2 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.611 | 10.345 | 13.789 | 0 | 7 / 4.09 | 7.481 | 8.907 | 0 | 5.73 | 10.904 | 0 | 278230008 | 668400144 | 394.2 | 198.2 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.362 | 6.511 | 7.609 | 0 | 6.61 / 3.92 | 6.921 | 7.253 | 0 | 5.411 | 6.481 | 0 | 278210888 | 668400144 | 392.3 | 184.8 | 6.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.644 | 7.286 | 8.591 | 0 | 6.78 / 3.83 | 7.887 | 8.591 | 0 | 5.703 | 7.224 | 0 | 278230008 | 668400144 | 477.9 | 198.8 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.66 | 9.668 | 12.244 | 0 | 6.44 / 3.81 | 7.684 | 7.882 | 0 | 5.731 | 10.028 | 0 | 278210888 | 668400144 | 392.2 | 161.6 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.702 | 11.132 | 12.944 | 0 | 6.85 / 3.92 | 7.919 | 9.04 | 0 | 5.821 | 11.835 | 0 | 278230008 | 668400144 | 387.6 | 231.3 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.347 | 6.552 | 7.461 | 0 | 6.92 / 3.84 | 6.572 | 7.461 | 0 | 5.412 | 6.547 | 0 | 278210888 | 668400144 | 405.1 | 224 | 6.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.663 | 10.528 | 13.947 | 0 | 6.5 / 3.84 | 12.868 | 13.947 | 0 | 5.696 | 7.344 | 0 | 278230008 | 668400144 | 397.3 | 158 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.293 | 9.165 | 13.543 | 0 | 6.73 / 3.82 | 6.783 | 7.035 | 0 | 5.36 | 9.548 | 0 | 278210888 | 668400144 | 394.2 | 163.7 | 6.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.005 | 8.322 | 11.556 | 0 | 6.55 / 3.87 | 7.415 | 8.689 | 0 | 6.281 | 8.529 | 0 | 278230008 | 668400144 | 386.6 | 163.5 | 7.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.512 | 9.702 | 12.36 | 0 | 6.95 / 4.14 | 12.076 | 12.36 | 0 | 6.575 | 9.198 | 0 | 278210888 | 668400144 | 416.1 | 168.3 | 7.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.845 | 11.304 | 15.321 | 0 | 7.69 / 4.51 | 9.764 | 11.304 | 0 | 6.978 | 12.439 | 0 | 278230008 | 668400144 | 480.3 | 187.4 | 8.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.337 | 11.08 | 14.861 | 0 | 7.41 / 5.14 | 8.865 | 9.32 | 0 | 6.437 | 12.054 | 0 | 278210888 | 668400144 | 456.6 | 180.2 | 7.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.491 | 11.422 | 18.695 | 2 | 7.01 / 4.46 | 8.841 | 11.422 | 0 | 6.659 | 12.838 | 2 | 278230008 | 668400144 | 429.4 | 166.4 | 7.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.574 | 9.507 | 14.52 | 0 | 7.75 / 4.43 | 9.507 | 10.487 | 0 | 6.681 | 9.528 | 0 | 278210888 | 668400144 | 444.9 | 179.2 | 7.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.543 | 10.841 | 15.028 | 0 | 7.46 / 4.45 | 12.263 | 15.028 | 0 | 6.525 | 8.468 | 0 | 278230008 | 668400144 | 449.7 | 177.5 | 7.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.26 | 10.365 | 13.44 | 0 | 6.99 / 4.04 | 7.798 | 8.197 | 0 | 6.398 | 11.088 | 0 | 278210888 | 668400144 | 429 | 217 | 7.6 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 13.025 | 19.439 | 21.838 | 53 | 9.08 / 5.54 | 16.724 | 17.028 | 3 | 13.554 | 20.302 | 50 | 278230008 | 668203536 | 444.2 | 194.2 | 13.6 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 8.331 | 12.499 | 13.984 | 0 | 8.3 / 4.92 | 12.648 | 13.867 | 0 | 8.434 | 12.264 | 0 | 278230008 | 668269072 | 428.4 | 173 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 7.837 | 11.426 | 15.181 | 0 | 7.97 / 5.06 | 13.363 | 15.181 | 0 | 7.953 | 10.915 | 0 | 278230008 | 668334608 | 413.1 | 169.9 | 9 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 6.6 | 11.427 | 21.049 | 1 | 6.91 / 4.04 | 9.002 | 9.654 | 0 | 6.784 | 12.376 | 1 | 278230008 | 668531216 | 439.3 | 205.9 | 8.1 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 7.664 | 12.91 | 18.594 | 3 | 7.6 / 4.5 | 11.454 | 12.534 | 0 | 7.778 | 14.958 | 3 | 278230008 | 668400144 | 484.3 | 326.2 | 9.2 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.542 | 12.012 | 24.655 | 4 | 24.65 / 18.17 | 8.858 | 22.179 | 1 | 6.739 | 12.012 | 1 | 278230008 | 668400144 |  | 116.4 | 7.5 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.393 | 7.193 | 9.635 | 0 | 8.82 / 3.76 | 8.222 | 9.635 | 0 | 0.383 | 0.529 | 0 | 196038896 | 668400144 | 453.1 | 172.5 | 2.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.413 | 10.35 | 16.576 | 0 | 6.89 / 3.95 | 8.344 | 9.128 | 0 | 6.481 | 10.465 | 0 | 405628416 | 668400144 | 427.3 | 172.3 | 19.6 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.54 | 7.692 | 10.604 | 0 | 7.29 / 3.61 | 8.021 | 10.604 | 0 | 5.492 | 7.472 | 0 | 222452960 | 668400144 | 404.6 | 171.6 | 5.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.463 | 9.117 | 13.3 | 0 | 7.27 / 3.8 | 11.642 | 13.3 | 0 | 5.322 | 7.885 | 0 | 222603776 | 668400144 | 435.1 | 182.1 | 5.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.916 | 8.515 | 10.026 | 0 | 7.42 / 3.68 | 8.529 | 8.703 | 0 | 5.935 | 8.515 | 0 | 222407312 | 668400144 | 424.2 | 167.6 | 5.8 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.259 | 7.29 | 9.51 | 0 | 7.47 / 3.86 | 6.902 | 7.901 | 0 | 5.274 | 7.343 | 0 | 222564304 | 668400144 | 433.9 | 194.6 | 5.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.563 | 12.536 | 18.424 | 3 | 10.81 / 6.45 | 10.904 | 11.953 | 0 | 7.713 | 14.302 | 3 | 278246392 | 668400144 | 539 | 175.8 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.767 | 12.425 | 21.798 | 2 | 9.59 / 8.59 | 10.244 | 12.316 | 0 | 7.954 | 13.706 | 2 | 278246392 | 668400144 | 515.5 | 165.9 | 9.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.764 | 13.761 | 18.292 | 2 | 9.16 / 9.44 | 10.943 | 13.761 | 0 | 7.913 | 15.395 | 2 | 278246392 | 668400144 | 506 | 166 | 9.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.808 | 12.226 | 19.297 | 2 | 9.67 / 6.88 | 9.999 | 10.997 | 0 | 7.967 | 13.622 | 2 | 278246392 | 668400144 | 524.1 | 271.8 | 9.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.601 | 12.702 | 16.889 | 1 | 9.32 / 7.76 | 9.624 | 11.284 | 0 | 7.763 | 13.61 | 1 | 278246392 | 668400144 | 515.9 | 204.4 | 9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.683 | 13.69 | 23.102 | 2 | 9.49 / 7.51 | 10.99 | 13.69 | 0 | 7.772 | 14.74 | 2 | 278246392 | 668400144 | 543.6 | 186.6 | 9.1 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.395 | 7.933 | 10.516 | 0 | 10.15 / 4.94 | 8.598 | 10.516 | 0 | 0.382 | 0.628 | 0 | 196055280 | 668400144 | 520.9 | 170.2 | 2.7 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.41 | 8.758 | 11.306 | 0 | 10.16 / 6.2 | 9.617 | 11.306 | 0 | 0.398 | 0.648 | 0 | 196055280 | 668400144 | 510.3 | 168 | 2.7 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.399 | 8.167 | 10.315 | 0 | 10.32 / 5.31 | 8.996 | 10.166 | 0 | 0.388 | 0.56 | 0 | 196055280 | 668400144 | 520.3 | 266.1 | 2.8 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 12.999 | 14.144 | 0 | 0 | 13.07 | 14.709 | 0 | 19.2 |
| 128 MiB fixed | 1 | schedstat | 10.002 | 13 | 0 | 0 | 10.198 | 12.626 | 0 | 19.3 |
| 512 MiB fixed | 1 | schedstat | 9.001 | 11.999 | 0 | 0 | 9.277 | 11.601 | 0 | 15.2 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 7.999 | 10 | 0 | 0 | 8.099 | 9.627 | 0 | 11.9 |

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
