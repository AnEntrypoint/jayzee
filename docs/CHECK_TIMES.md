# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 163.5 s across 307 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:scenario-marble-bowl` | 13381 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:scenario-determinism` | 13189 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:engine-state-hash-1024` | 12688 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:gc-witness` | 10798 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:engine-tiers` | 9018 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:engine-job-wait` | 6880 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:elevation-ab` | 6029 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:app-watch` | 4577 |  | Waits on real file-watch events. |
| `check:height-cpu` | 3910 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:sphere-population` | 3685 |  | Places the full sphere population and checks every member. |
| `check:pose-allocations` | 3659 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:alloc-audit` | 3411 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:vegetation-allocations` | 3279 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:engine-release` | 3081 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:scenario-deathrun` | 2644 | yes | Six runs per tier on four tiers. |
| `check:scenario-lockstep-rts` | 2597 | yes | Six peers per tier on four tiers. |
| `check:heightmap-cli` | 2509 |  | Runs the heightmap CLI once per fixture case. |
| `check:scenario-boss-fight` | 2503 | yes | Six runs per tier on four tiers. |
| `check:scenario-combat-bots` | 2394 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:thread-sampler` | 2047 | yes | Samples real threads over a timed window. |
| `check:scenario-allocations` | 1955 | yes |  |
| `check:engine-threads` | 1947 | yes |  |
| `check:own-display` | 1821 |  |  |
| `check:mapspinner-atmosphere` | 1685 |  |  |
| `check:vegetation-generate-cost` | 1638 |  |  |
| `check:scenario-character-terrain` | 1442 | yes |  |
| `check:planet-witness-scene` | 1321 |  |  |
| `check:snapshots` | 1268 |  |  |
| `check:scenario-projectile-volley` | 1132 | yes |  |
| `check:scenario-planet-landing` | 1081 | yes |  |
| `check:scenario-settle` | 1023 | yes |  |
| `check:planet-scene-counts` | 935 |  |  |
| `check:gc-reuse-rows` | 881 |  |  |
| `check:engine-raycast` | 880 |  |  |
| `check:scenario-character` | 867 | yes |  |
| `check:engine-seal` | 845 |  |  |
| `check:engine-shapecast` | 829 |  |  |
| `check:types` | 797 |  |  |
| `check:wireweave-relay` | 789 |  |  |
| `check:upload-writes` | 683 |  |  |
| `check:create-app` | 676 |  |  |
| `check:netcode` | 664 |  |  |
| `check:crowd-dot-buffer` | 656 |  |  |
| `check:engine-host-witness` | 655 |  |  |
| `check:upload-handler` | 610 |  |  |
| `check:engine-awake-budget` | 580 |  |  |
| `check:pose-replay` | 577 |  |  |
| `check:terrain-agreement` | 547 |  |  |
| `check:transport` | 541 |  |  |
| `check:planet-witness` | 519 |  |  |
| `check:engine-warm` | 481 |  |  |
| `check:socket-server` | 437 |  |  |
| `build:kernel` | 362 |  |  |
| `check:stall-attribution` | 349 |  |  |
| `check:engine-pools` | 338 |  |  |
| `check:sharding` | 324 |  |  |
| `check:engine-airborne` | 295 |  |  |
| `check:world-query` | 256 |  |  |
| `check:collision-placement-options` | 248 |  |  |
| `check:engine-world` | 245 |  |  |
| `check:project-naming` | 244 |  |  |
| `check:ccd` | 237 |  |  |
| `check:world` | 236 |  |  |
| `check:world-config` | 232 |  |  |
| `check:engine-materials` | 231 |  |  |
| `check:kernel` | 222 |  |  |
| `check:physics-pure` | 221 |  |  |
| `check:engine-vegetation` | 221 |  |  |
| `check:packages` | 214 |  |  |
| `check:collision-mirror` | 200 |  |  |
| `check:vehicles-spoint` | 196 |  |  |
| `check:sdk-surfaces` | 195 |  |  |
| `check:physics-integration-vehicles` | 194 |  |  |
| `check:webgpu-profile` | 190 |  |  |
| `check:overlap-spoint` | 180 |  |  |
| `check:vehicle-remove-spoint` | 173 |  |  |
| `check:collision-tile-streamer` | 173 |  |  |
| `check:raycast-spoint` | 170 |  |  |
| `check:vehicle-refusal-spoint` | 170 |  |  |
| `check:dormant-budget-spoint` | 170 |  |  |
| `check:player-vat-spoint` | 170 |  |  |
| `check:engine-planet` | 170 |  |  |
| `check:dormant-spoint` | 162 |  |  |
| `check:collision-host` | 160 |  |  |
| `check:chart-state-live` | 160 |  |  |
| `check:site-world` | 152 |  |  |
| `check:engine-bridge` | 150 |  |  |
| `check:player-lod-renderer-webgpu` | 149 |  |  |
| `check:player-lod-renderer` | 148 |  |  |
| `check:fire` | 145 |  |  |
| `check:engine-budget-floor` | 142 |  |  |
| `check:rebase-session` | 141 |  |  |
| `check:engine-sleep` | 141 |  |  |
| `check:recast-bake-spoint` | 138 |  |  |
| `check:bloom-spoint` | 136 |  |  |
| `check:player-dot-shader-spoint` | 135 |  |  |
| `check:player-dot-material-spoint` | 130 |  |  |
| `check:decode-path` | 130 |  |  |
| `check:cluster-lod-spoint` | 125 |  |  |
| `check:camera-relative` | 124 |  |  |
| `check:streaming-gltf-mesh` | 120 |  |  |
| `check:upstream-builtin-nav` | 119 |  |  |
| `check:engine-leak` | 119 |  |  |
| `check:terrain-static` | 116 |  |  |
| `check:lockstep` | 113 |  |  |
| `check:scene-setup-spoint` | 111 |  |  |
| `check:streamer-p99` | 111 |  |  |
| `check:terrain-pure` | 107 |  |  |
| `check:sample-order` | 106 |  |  |
| `check:vegetation-leaf-patches` | 105 |  |  |
| `check:engine-interest` | 105 |  |  |
| `check:engine-codecs` | 104 |  |  |
| `check:fire-modules` | 103 |  |  |
| `check:vat-spoint` | 100 |  |  |
| `check:kaggle-regress` | 100 |  |  |
| `check:ssr-spoint` | 99 |  |  |
| `check:follow-misuse` | 98 |  |  |
| `check:engine-core` | 92 |  |  |
| `check:glue-tier` | 88 |  |  |
| `check:fsr1-spoint` | 85 |  |  |
| `check:socket-upgrade` | 84 |  |  |
| `check:timed-result` | 84 |  |  |
| `check:chart-anchor` | 83 |  |  |
| `check:client-resource-pools` | 83 |  |  |
| `check:bin-snapshot` | 82 |  |  |
| `check:script-limits` | 82 |  |  |
| `check:sessions` | 81 |  |  |
| `check:ci-engine-glue` | 81 |  |  |
| `check:spline-erosion-witness` | 77 |  |  |
| `check:procgen` | 75 |  |  |
| `check:import-scene` | 75 |  |  |
| `check:client-pure` | 74 |  |  |
| `check:lag-compensation` | 72 |  |  |
| `check:behaviours` | 70 |  |  |
| `check:spoint-core-rust` | 70 |  |  |
| `check:replay-file` | 67 |  |  |
| `check:tick-governor` | 67 | yes |  |
| `check:upstream-skill-registry` | 67 |  |  |
| `check:collider-streamer` | 67 |  |  |
| `check:player-collisions` | 67 |  |  |
| `check:replay-player` | 65 |  |  |
| `check:snapshot-lod` | 65 |  |  |
| `check:client-message-handler` | 64 |  |  |
| `check:spawn` | 63 |  |  |
| `check:msgpackr-compat` | 62 |  |  |
| `check:vegetation-stream` | 62 |  |  |
| `check:protocol-codecs` | 61 |  |  |
| `check:upstream-skill-bodies` | 61 |  |  |
| `check:protocol` | 60 |  |  |
| `check:bundle-freshness-jayzee` | 60 |  |  |
| `check:behaviour-health-destructible` | 60 |  |  |
| `check:animation-control` | 60 |  |  |
| `check:prediction-engine` | 60 |  |  |
| `check:lod-tiers` | 60 |  |  |
| `check:wireweave-frame-spoint` | 60 |  |  |
| `check:sdk-misc` | 59 |  |  |
| `check:msgpack-packer` | 59 |  |  |
| `check:replay-dialect` | 59 |  |  |
| `check:game-systems` | 58 |  |  |
| `check:rollback` | 58 |  |  |
| `check:shared-pure` | 57 |  |  |
| `check:snapshot-packer` | 57 |  |  |
| `check:engine-render` | 57 |  |  |
| `check:netcode-small` | 56 |  |  |
| `check:streaming-gltf-queues` | 55 |  |  |
| `check:behaviours-c` | 55 |  |  |
| `check:octree` | 54 |  |  |
| `check:chart-reanchor` | 54 |  |  |
| `check:behaviours-a` | 54 |  |  |
| `check:hot-reload-spoint` | 54 |  |  |
| `check:hygiene` | 54 |  |  |
| `check:paint-store` | 53 |  |  |
| `check:reduced-pose` | 52 |  |  |
| `check:upload-route` | 52 |  |  |
| `check:frame-stall-cause` | 52 |  |  |
| `check:event-log` | 51 |  |  |
| `check:chart-migrators` | 51 |  |  |
| `check:app-loader` | 51 |  |  |
| `check:player-lod-plan` | 51 |  |  |
| `check:controlled-run` | 51 |  |  |
| `check:pathfinding` | 50 |  |  |
| `check:stage` | 50 |  |  |
| `check:cluster-handoff` | 50 |  |  |
| `check:snapshot-processor` | 50 |  |  |
| `check:apps-b` | 50 |  |  |
| `check:entity-host` | 50 |  |  |
| `check:game-systems-spoint` | 50 |  |  |
| `check:physics-extras` | 49 |  |  |
| `check:aoi` | 49 |  |  |
| `check:client-machines` | 49 |  |  |
| `check:chart-state-server` | 49 |  |  |
| `check:negative-zero` | 49 |  |  |
| `check:cluster-slice` | 49 |  |  |
| `check:feature-gap` | 48 |  |  |
| `check:world-persistence` | 48 |  |  |
| `check:upstream-builtin-bodies` | 48 |  |  |
| `check:sdk-editor` | 48 |  |  |
| `check:behaviours-b` | 48 |  |  |
| `check:client-pure-rows` | 48 |  |  |
| `check:anticheat-spoint` | 47 |  |  |
| `check:tick-authority` | 47 |  |  |
| `check:upstream-door-routes` | 47 |  |  |
| `check:apps-a` | 47 |  |  |
| `check:mat4-spoint` | 47 |  |  |
| `check:engine-artifacts` | 47 |  |  |
| `check:render` | 46 |  |  |
| `check:consensus` | 46 |  |  |
| `check:chart-transfer` | 46 |  |  |
| `check:upstream-builtin-lighting` | 46 |  |  |
| `check:upstream-builtin-noise` | 46 |  |  |
| `check:physics-integration` | 46 |  |  |
| `check:client-tier-split` | 46 |  |  |
| `check:material-tier-swap-spoint` | 46 |  |  |
| `check:frequency-runs` | 46 |  |  |
| `check:sandbox` | 45 |  |  |
| `check:telemetry` | 45 |  |  |
| `check:app-behaviours` | 45 |  |  |
| `check:sampler-gap-attribution` | 45 |  |  |
| `check:spawn-named-errors` | 43 |  |  |
| `check:upstream-endpoints` | 43 |  |  |
| `check:row16-client-decoder` | 43 |  |  |
| `check:upstream-tome-bodies` | 43 |  |  |
| `check:upstream-builtin-env` | 43 |  |  |
| `check:editor-serialize` | 43 |  |  |
| `check:camera-rig` | 43 |  |  |
| `check:client-loops` | 42 |  |  |
| `check:clusters` | 42 |  |  |
| `check:anticheat` | 41 |  |  |
| `check:upstream-tome` | 41 |  |  |
| `check:upstream-tome-lookup` | 41 |  |  |
| `check:upstream-reference` | 41 |  |  |
| `check:reexpress-records` | 41 |  |  |
| `check:crowd-dot-cells-spoint` | 41 |  |  |
| `check:client-pure-spoint` | 41 |  |  |
| `check:paired-report` | 41 |  |  |
| `check:stall-off-cpu` | 41 |  |  |
| `check:tail-report` | 41 |  |  |
| `check:relative-residuals` | 41 |  |  |
| `check:upstream-builtin-easing` | 40 |  |  |
| `check:upstream-builtin-tween` | 40 |  |  |
| `check:app-runtime-state` | 40 |  |  |
| `check:network-state` | 40 |  |  |
| `check:navmesh-query-spoint` | 40 |  |  |
| `check:asset-pipeline` | 40 |  |  |
| `check:browser-heap` | 40 |  |  |
| `check:minidump` | 40 |  |  |
| `check:engine-visibility` | 40 |  |  |
| `check:hot-reload` | 39 |  |  |
| `check:rollback-bridge` | 39 |  |  |
| `check:upstream-doors` | 39 |  |  |
| `check:upstream-builtin-vec3` | 39 |  |  |
| `check:upstream-builtin-physics` | 39 |  |  |
| `check:upstream-builtin-path` | 39 |  |  |
| `check:player-id` | 39 |  |  |
| `check:blend-tree-spoint` | 39 |  |  |
| `check:stall-probe` | 39 |  |  |
| `check:site` | 38 |  |  |
| `check:messages` | 38 |  |  |
| `check:content` | 38 |  |  |
| `check:movement` | 38 |  |  |
| `check:upstream-door-dispatch` | 38 |  |  |
| `check:upstream-builtin-spline` | 38 |  |  |
| `check:vec3-read` | 38 |  |  |
| `check:spawn-captured-names` | 38 |  |  |
| `check:pool-params-spoint` | 38 |  |  |
| `check:render-1024-visible` | 38 |  |  |
| `check:transport-framing` | 37 |  |  |
| `check:tick-scheduler` | 37 |  |  |
| `check:upstream-builtins` | 37 |  |  |
| `check:named-asset-redirect` | 37 |  |  |
| `check:upstream-builtin-three` | 37 |  |  |
| `check:upstream-builtin-water` | 37 |  |  |
| `check:world-def-clusters` | 37 |  |  |
| `check:postfx-shaders-spoint` | 37 |  |  |
| `check:spawn-captured-bodies` | 37 |  |  |
| `check:collider-layers` | 37 |  |  |
| `check:collision-placement` | 37 |  |  |
| `check:planet-gap-class` | 37 |  |  |
| `check:jolt-limits` | 36 |  |  |
| `check:upstream-skills` | 36 |  |  |
| `check:upstream-builtin-math` | 36 |  |  |
| `check:upstream-builtin-fx` | 36 |  |  |
| `check:upstream-builtin-room-routing` | 36 |  |  |
| `check:upstream-builtin-terrain` | 36 |  |  |
| `check:upstream-builtin-tsl` | 36 |  |  |
| `check:upstream-builtin-vibe` | 36 |  |  |
| `check:upstream-builtin-voxels` | 36 |  |  |
| `check:component-pool` | 36 |  |  |
| `check:world-resolver` | 36 |  |  |
| `check:engine-isolation` | 36 |  |  |
| `check:character-step` | 35 |  |  |
| `check:constraint-limits` | 35 |  |  |
| `check:rollback-peer` | 35 |  |  |
| `check:tick-order` | 35 |  |  |
| `check:relocation-solve` | 35 |  |  |
| `check:heightfield-physics` | 35 |  |  |
| `check:hook-order` | 35 |  |  |
| `check:upstream-builtin-postfx` | 35 |  |  |
| `check:engine-solver-tier` | 35 |  |  |
| `check:chromium-launcher` | 35 |  |  |
| `check:animation` | 34 |  |  |
| `check:flight-model` | 34 |  |  |
| `check:vehicle-tuning` | 34 |  |  |
| `check:worker-dispatch` | 34 |  |  |
| `check:upstream-builtin-ballistics` | 34 |  |  |
| `check:cube-sphere-cell-key-spoint` | 34 |  |  |
| `check:worker-bridge` | 33 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 40. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T23:29:18.911Z. Queue wait 8 s from the push to the first line of the script. Run time 611.9 s for 58 of 58 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone none holds it.
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.35 | 10.551 | 13.86 | 0 | 8.15 / 5.03 | 12.209 | 13.86 | 0 | 7.414 | 9.496 | 0 | 278248248 | 668400144 | 1231.9 | 1055.5 | 10.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.712 | 9.279 | 15.825 | 0 | 7.26 / 3.93 | 10.427 | 15.825 | 0 | 5.77 | 7.695 | 0 | 278248248 | 668400144 | 1109.4 | 1015.9 | 8.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.142 | 11.237 | 21.27 | 1 | 7.85 / 4.97 | 12.701 | 15.447 | 0 | 7.267 | 9.851 | 1 | 278248248 | 668400144 | 1124.4 | 1032.6 | 10 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.212 | 10.621 | 16.126 | 0 | 6.75 / 3.81 | 14.883 | 16.126 | 0 | 6.241 | 8.321 | 0 | 278248248 | 668400144 | 1174.1 | 1097.7 | 9.3 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.628 | 11.354 | 15.897 | 0 | 8.2 / 5.06 | 10.305 | 11.354 | 0 | 7.725 | 12.281 | 0 | 278248248 | 668400144 | 1126.3 | 1001.6 | 10.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.21 | 9.775 | 12.474 | 0 | 7.27 / 3.92 | 9.123 | 12.082 | 0 | 6.306 | 10.719 | 0 | 278248248 | 668400144 | 1120.7 | 1027.6 | 9.1 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.612 | 11.481 | 17.771 | 1 | 8.7 / 5.36 | 10.628 | 11.481 | 0 | 7.675 | 11.982 | 1 | 278248248 | 668400144 | 1145.6 | 1049.8 | 10.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.148 | 10.351 | 16.579 | 0 | 7.13 / 3.86 | 8.358 | 10.258 | 0 | 6.289 | 10.973 | 0 | 278248248 | 668400144 | 1137.2 | 979.9 | 9 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.674 | 11.774 | 17.896 | 1 | 8.26 / 5.15 | 9.68 | 11.765 | 0 | 7.777 | 12.185 | 1 | 278248248 | 668400144 | 1165.3 | 1073.4 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.174 | 10.551 | 17.199 | 1 | 6.91 / 3.73 | 8.73 | 10.551 | 0 | 6.285 | 12.378 | 1 | 278248248 | 668400144 | 1169.6 | 1024.7 | 9.1 |
| reference 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 1.153 | 16.756 | 18.617 | 9 | 14.49 / 9.89 | 17.789 | 18.617 | 9 | 1.142 | 1.404 | 0 | 196109184 | 668400144 | 1107 | 941.3 | 4.5 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.453 | 14.864 | 15.864 | 0 | 13.69 / 9.16 | 15.313 | 15.864 | 0 | 0.437 | 0.566 | 0 | 196109184 | 668400144 | 1163.6 | 927.9 | 3.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.68 | 11.072 | 14.103 | 0 | 7.28 / 4.82 | 8.925 | 12.25 | 0 | 6.743 | 12.064 | 0 | 342582144 | 668400144 | 1118.9 | 1106.5 | 9.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.492 | 10.562 | 14.177 | 0 | 6.81 / 4.07 | 9.22 | 10.562 | 0 | 6.558 | 11.188 | 0 | 342569792 | 668400144 | 1098.7 | 1039.2 | 9.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.818 | 10.76 | 15.212 | 0 | 6.41 / 4.12 | 8.389 | 9.398 | 0 | 5.951 | 12.072 | 0 | 278250856 | 668400144 | 1159.1 | 1056.3 | 8.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 2 |  | 5.807 | 7.949 | 9.612 | 0 | 6.77 / 3.66 | 7.989 | 9.612 | 0 | 5.917 | 7.949 | 0 | 276984240 | 668400144 | 1136.9 | 1045.8 | 8.7 |
| reference 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 1.019 | 15.888 | 16.643 | 0 | 14.8 / 10.1 | 16.39 | 16.643 | 0 | 0.993 | 1.276 | 0 | 196109184 | 668400144 | 1196.9 | 1038.3 | 4.5 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.422 | 15.003 | 17.764 | 1 | 13.91 / 9.13 | 16.249 | 17.764 | 1 | 0.411 | 0.71 | 0 | 196109184 | 668400144 | 1203.8 | 1076.7 | 4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.768 | 9.01 | 9.704 | 0 | 6.56 / 4.76 | 9.155 | 9.704 | 0 | 6.944 | 9.01 | 0 | 342582144 | 668400144 | 1101.4 | 1088.8 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.964 | 8.684 | 15.101 | 0 | 7.3 / 4.68 | 9.44 | 15.101 | 0 | 6.056 | 8.092 | 0 | 342569792 | 668400144 | 1132.5 | 975.1 | 8.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.827 | 9.386 | 13.421 | 0 | 6.44 / 4.02 | 11.984 | 13.421 | 0 | 5.947 | 8.033 | 0 | 278250856 | 668400144 | 1102.8 | 1044.7 | 8.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 2 |  | 5.717 | 9.856 | 13.808 | 0 | 7.04 / 3.74 | 7.922 | 9.553 | 0 | 5.834 | 10.012 | 0 | 276984240 | 668400144 | 1118.7 | 968.5 | 8.6 |
| reference 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.877 | 15.379 | 16.582 | 0 | 15.53 / 9.86 | 16.4 | 16.582 | 0 | 0.848 | 1.211 | 0 | 196109184 | 668400144 | 1113.4 | 1052.6 | 4.3 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.426 | 14.269 | 15.803 | 0 | 13.86 / 8.62 | 14.985 | 15.803 | 0 | 0.417 | 0.587 | 0 | 196109184 | 668400144 | 1107.1 | 964.7 | 3.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.479 | 11.13 | 17.597 | 2 | 6.44 / 4.63 | 8.511 | 9.654 | 0 | 6.596 | 13.342 | 2 | 342582144 | 668400144 | 1196.8 | 1011.3 | 9.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.407 | 11.53 | 16.363 | 0 | 6.68 / 4.04 | 8.453 | 9.856 | 0 | 6.55 | 12.334 | 0 | 342569792 | 668400144 | 1112.9 | 992.1 | 9.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.523 | 9.599 | 13.791 | 0 | 6.66 / 4.37 | 9.29 | 12.298 | 0 | 6.656 | 9.738 | 0 | 278250856 | 668400144 | 1169.2 | 947.3 | 9.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 2 |  | 5.741 | 7.9 | 10.167 | 0 | 7.38 / 3.74 | 8.523 | 10.167 | 0 | 5.737 | 7.661 | 0 | 276984240 | 668400144 | 1176.2 | 985.5 | 8.7 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 11.381 | 15.801 | 21.968 | 3 | 8.41 / 5.35 | 14.164 | 14.328 | 0 | 11.778 | 16.168 | 3 | 278248248 | 668203536 | 1110.8 | 1074.1 | 13.7 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.309 | 11.363 | 15.678 | 0 | 7.75 / 4.27 | 9.46 | 10.135 | 0 | 7.511 | 12.281 | 0 | 278248248 | 668269072 | 1113.8 | 931.4 | 10 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.968 | 10.381 | 12.959 | 0 | 7.88 / 4.33 | 8.977 | 9.542 | 0 | 7.194 | 11.448 | 0 | 278248248 | 668334608 | 1086.8 | 987.3 | 9.7 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 6.329 | 11.078 | 16.777 | 1 | 6.7 / 3.75 | 8.438 | 9.695 | 0 | 6.477 | 12.267 | 1 | 278248248 | 668531216 | 1097.5 | 986.6 | 9.2 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 7.548 | 13.37 | 25.207 | 2 | 7.14 / 4.25 | 9.747 | 13.564 | 0 | 7.707 | 14.083 | 2 | 278248248 | 668400144 | 1157 | 947.4 | 10.3 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.538 | 9.221 | 25.227 | 2 | 25.23 / 8.9 | 10.933 | 18.488 | 1 | 6.655 | 8.986 | 0 | 278248248 | 668400144 |  | 817.5 | 8.1 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.425 | 6.368 | 8.051 | 0 | 6.71 / 3.7 | 6.77 | 8.051 | 0 | 0.41 | 0.501 | 0 | 196055280 | 668400144 | 1164.1 | 1157.3 | 4.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.225 | 9.208 | 20.863 | 1 | 7.02 / 4.1 | 8.641 | 10.442 | 0 | 6.274 | 9.22 | 1 | 405657056 | 668400144 | 1106.8 | 1093.1 | 20.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.623 | 9.518 | 15.444 | 0 | 6.68 / 3.58 | 7.438 | 9.005 | 0 | 5.631 | 12.08 | 0 | 222472736 | 668400144 | 1165.5 | 948.2 | 7.1 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.48 | 7.18 | 8.673 | 0 | 6.74 / 3.55 | 7.084 | 7.28 | 0 | 5.474 | 7.289 | 0 | 222620160 | 668400144 | 1118.2 | 1019.6 | 6.9 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.688 | 7.272 | 9.318 | 0 | 7.05 / 3.59 | 6.829 | 8.328 | 0 | 5.714 | 7.297 | 0 | 222423696 | 668400144 | 1136.5 | 1136 | 7.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.357 | 9.678 | 11.838 | 0 | 6.83 / 3.81 | 8.974 | 9.825 | 0 | 5.351 | 10.401 | 0 | 222580688 | 668400144 | 1111.6 | 918.1 | 6.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.464 | 10.894 | 15.871 | 0 | 9.99 / 4.2 | 8.965 | 11.881 | 0 | 6.485 | 12.095 | 0 | 278248248 | 668400144 | 1137.3 | 988.1 | 9.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.599 | 10.461 | 15.969 | 0 | 10.46 / 4.05 | 8.515 | 10.105 | 0 | 6.735 | 11.51 | 0 | 278248248 | 668400144 | 1150.6 | 1027.5 | 9.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.405 | 10.847 | 18.321 | 2 | 9.08 / 4.15 | 8.806 | 10.8 | 0 | 6.433 | 12.273 | 2 | 278248248 | 668400144 | 1143 | 1029.9 | 9.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.301 | 10.74 | 15.145 | 0 | 8.36 / 4.01 | 8.466 | 10.957 | 0 | 6.505 | 10.99 | 0 | 278248248 | 668400144 | 1134.1 | 930.6 | 9.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.416 | 8.704 | 10.691 | 0 | 9.03 / 4 | 8.945 | 10.691 | 0 | 6.592 | 8.481 | 0 | 278248248 | 668400144 | 1132.9 | 1098.1 | 9.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.488 | 9.031 | 9.901 | 0 | 9.8 / 4.26 | 9.051 | 9.901 | 0 | 6.581 | 8.893 | 0 | 278248248 | 668400144 | 1158.8 | 1067.8 | 9.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.123 | 8.217 | 9.686 | 0 | 9.34 / 3.88 | 8.265 | 9.686 | 0 | 6.203 | 8.213 | 0 | 278248248 | 668400144 | 1169.3 | 909.6 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.032 | 8.237 | 10.471 | 0 | 8.47 / 3.91 | 8.767 | 10.471 | 0 | 6.115 | 7.976 | 0 | 278248248 | 668400144 | 1134.5 | 1067.8 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.112 | 10.215 | 18.678 | 1 | 9.06 / 3.96 | 12.47 | 18.678 | 1 | 6.192 | 8.234 | 0 | 278248248 | 668400144 | 1118.9 | 927.4 | 9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.207 | 10.49 | 14.66 | 0 | 10.15 / 4.22 | 13.171 | 14.66 | 0 | 6.351 | 8.747 | 0 | 278248248 | 668400144 | 1139.9 | 932.9 | 9.1 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 11.002 | 12.992 | 0 | 0 | 11.219 | 12.817 | 0 | 20 |
| 128 MiB fixed | 1 | schedstat | 11 | 13 | 0 | 0 | 11.325 | 13.27 | 0 | 20 |
| 512 MiB fixed | 1 | schedstat | 9.91 | 10.999 | 0 | 0 | 9.421 | 11.459 | 0 | 15.9 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 7.998 | 8.588 | 0 | 0 | 7.71 | 11.507 | 0 | 14.8 |

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
