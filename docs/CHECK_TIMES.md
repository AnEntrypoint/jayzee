# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 169.8 s across 307 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:engine-state-hash-1024` | 14082 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-determinism` | 14002 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:scenario-marble-bowl` | 13766 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:gc-witness` | 10961 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:engine-tiers` | 8455 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:engine-job-wait` | 7332 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:elevation-ab` | 5847 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:app-watch` | 4566 |  | Waits on real file-watch events. |
| `check:pose-allocations` | 4484 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:sphere-population` | 3915 |  | Places the full sphere population and checks every member. |
| `check:height-cpu` | 3887 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:alloc-audit` | 3464 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:engine-release` | 3375 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:vegetation-allocations` | 3329 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:scenario-lockstep-rts` | 2728 | yes | Six peers per tier on four tiers. |
| `check:heightmap-cli` | 2725 |  | Runs the heightmap CLI once per fixture case. |
| `check:scenario-deathrun` | 2711 | yes | Six runs per tier on four tiers. |
| `check:scenario-boss-fight` | 2592 | yes | Six runs per tier on four tiers. |
| `check:scenario-combat-bots` | 2516 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:scenario-allocations` | 2169 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:engine-threads` | 2064 | yes | Runs the threaded scenario at several worker counts. |
| `check:thread-sampler` | 2053 | yes | Samples real threads over a timed window. |
| `check:vegetation-generate-cost` | 1847 |  |  |
| `check:own-display` | 1825 |  |  |
| `check:mapspinner-atmosphere` | 1787 |  |  |
| `check:planet-witness-scene` | 1487 |  |  |
| `check:scenario-character-terrain` | 1450 | yes |  |
| `check:snapshots` | 1302 |  |  |
| `check:scenario-projectile-volley` | 1185 | yes |  |
| `check:scenario-planet-landing` | 1119 | yes |  |
| `check:scenario-settle` | 1097 | yes |  |
| `check:types` | 1077 |  |  |
| `check:scenario-character` | 934 | yes |  |
| `check:gc-reuse-rows` | 922 |  |  |
| `check:planet-scene-counts` | 897 |  |  |
| `check:engine-raycast` | 873 |  |  |
| `check:engine-shapecast` | 871 |  |  |
| `check:engine-seal` | 836 |  |  |
| `check:wireweave-relay` | 757 |  |  |
| `check:netcode` | 718 |  |  |
| `check:create-app` | 692 |  |  |
| `check:crowd-dot-buffer` | 678 |  |  |
| `check:engine-host-witness` | 668 |  |  |
| `check:upload-handler` | 653 |  |  |
| `check:upload-writes` | 642 |  |  |
| `check:engine-awake-budget` | 617 |  |  |
| `check:pose-replay` | 579 |  |  |
| `check:terrain-agreement` | 544 |  |  |
| `check:transport` | 527 |  |  |
| `check:planet-witness` | 504 |  |  |
| `check:engine-warm` | 484 |  |  |
| `check:socket-server` | 449 |  |  |
| `check:engine-pools` | 371 |  |  |
| `check:stall-attribution` | 359 |  |  |
| `check:engine-airborne` | 359 |  |  |
| `build:kernel` | 353 |  |  |
| `check:project-naming` | 283 |  |  |
| `check:collision-placement-options` | 277 |  |  |
| `check:kernel` | 262 |  |  |
| `check:world-query` | 254 |  |  |
| `check:engine-world` | 252 |  |  |
| `check:engine-vegetation` | 250 |  |  |
| `check:sharding` | 248 |  |  |
| `check:world` | 243 |  |  |
| `check:engine-materials` | 240 |  |  |
| `check:world-config` | 238 |  |  |
| `check:physics-pure` | 227 |  |  |
| `check:ccd` | 221 |  |  |
| `check:vehicles-spoint` | 214 |  |  |
| `check:collision-mirror` | 196 |  |  |
| `check:physics-integration-vehicles` | 193 |  |  |
| `check:sdk-surfaces` | 192 |  |  |
| `check:packages` | 191 |  |  |
| `check:webgpu-profile` | 189 |  |  |
| `check:collision-tile-streamer` | 185 |  |  |
| `check:engine-planet` | 173 |  |  |
| `check:overlap-spoint` | 171 |  |  |
| `check:raycast-spoint` | 170 |  |  |
| `check:site-world` | 167 |  |  |
| `check:vehicle-remove-spoint` | 167 |  |  |
| `check:collision-host` | 165 |  |  |
| `check:dormant-spoint` | 165 |  |  |
| `check:player-vat-spoint` | 165 |  |  |
| `check:dormant-budget-spoint` | 163 |  |  |
| `check:vehicle-refusal-spoint` | 160 |  |  |
| `check:player-lod-renderer` | 157 |  |  |
| `check:engine-bridge` | 155 |  |  |
| `check:recast-bake-spoint` | 152 |  |  |
| `check:rebase-session` | 152 |  |  |
| `check:chart-state-live` | 151 |  |  |
| `check:engine-budget-floor` | 148 |  |  |
| `check:fire` | 145 |  |  |
| `check:player-lod-renderer-webgpu` | 143 |  |  |
| `check:engine-sleep` | 143 |  |  |
| `check:bloom-spoint` | 135 |  |  |
| `check:player-dot-material-spoint` | 132 |  |  |
| `check:player-dot-shader-spoint` | 130 |  |  |
| `check:decode-path` | 130 |  |  |
| `check:scene-setup-spoint` | 129 |  |  |
| `check:engine-leak` | 126 |  |  |
| `check:terrain-static` | 123 |  |  |
| `check:streaming-gltf-mesh` | 120 |  |  |
| `check:upstream-builtin-nav` | 120 |  |  |
| `check:streamer-p99` | 120 |  |  |
| `check:camera-relative` | 120 |  |  |
| `check:vegetation-leaf-patches` | 115 |  |  |
| `check:cluster-lod-spoint` | 109 |  |  |
| `check:terrain-pure` | 106 |  |  |
| `check:engine-interest` | 105 |  |  |
| `check:engine-codecs` | 102 |  |  |
| `check:lockstep` | 101 |  |  |
| `check:engine-core` | 99 |  |  |
| `check:kaggle-regress` | 99 |  |  |
| `check:follow-misuse` | 98 |  |  |
| `check:timed-result` | 97 |  |  |
| `check:vat-spoint` | 96 |  |  |
| `check:fire-modules` | 94 |  |  |
| `check:sample-order` | 94 |  |  |
| `check:chart-anchor` | 89 |  |  |
| `check:fsr1-spoint` | 89 |  |  |
| `check:ssr-spoint` | 88 |  |  |
| `check:spline-erosion-witness` | 87 |  |  |
| `check:sessions` | 86 |  |  |
| `check:script-limits` | 86 |  |  |
| `check:ci-engine-glue` | 85 |  |  |
| `check:socket-upgrade` | 84 |  |  |
| `check:bin-snapshot` | 83 |  |  |
| `check:client-resource-pools` | 81 |  |  |
| `check:glue-tier` | 80 |  |  |
| `check:procgen` | 79 |  |  |
| `check:import-scene` | 78 |  |  |
| `check:client-pure` | 77 |  |  |
| `check:tick-governor` | 76 | yes |  |
| `check:replay-file` | 72 |  |  |
| `check:behaviours` | 72 |  |  |
| `check:player-collisions` | 72 |  |  |
| `check:spoint-core-rust` | 68 |  |  |
| `check:rollback` | 67 |  |  |
| `check:msgpack-packer` | 67 |  |  |
| `check:lod-tiers` | 67 |  |  |
| `check:lag-compensation` | 66 |  |  |
| `check:upstream-skill-registry` | 66 |  |  |
| `check:collider-streamer` | 66 |  |  |
| `check:vegetation-stream` | 64 |  |  |
| `check:engine-render` | 63 |  |  |
| `check:spawn` | 61 |  |  |
| `check:replay-player` | 61 |  |  |
| `check:upstream-skill-bodies` | 61 |  |  |
| `check:client-message-handler` | 61 |  |  |
| `check:sdk-misc` | 60 |  |  |
| `check:replay-dialect` | 60 |  |  |
| `check:snapshot-lod` | 59 |  |  |
| `check:chart-migrators` | 59 |  |  |
| `check:reduced-pose` | 59 |  |  |
| `check:snapshot-packer` | 59 |  |  |
| `check:hot-reload-spoint` | 59 |  |  |
| `check:protocol` | 58 |  |  |
| `check:protocol-codecs` | 58 |  |  |
| `check:netcode-small` | 58 |  |  |
| `check:animation-control` | 57 |  |  |
| `check:frame-stall-cause` | 57 |  |  |
| `check:paint-store` | 56 |  |  |
| `check:behaviour-health-destructible` | 56 |  |  |
| `check:streaming-gltf-queues` | 56 |  |  |
| `check:prediction-engine` | 56 |  |  |
| `check:msgpackr-compat` | 54 |  |  |
| `check:game-systems` | 54 |  |  |
| `check:aoi` | 54 |  |  |
| `check:cluster-handoff` | 54 |  |  |
| `check:chart-reanchor` | 54 |  |  |
| `check:sdk-editor` | 54 |  |  |
| `check:shared-pure` | 54 |  |  |
| `check:player-lod-plan` | 54 |  |  |
| `check:wireweave-frame-spoint` | 54 |  |  |
| `check:upload-route` | 53 |  |  |
| `check:entity-host` | 53 |  |  |
| `check:controlled-run` | 53 |  |  |
| `check:pathfinding` | 52 |  |  |
| `check:world-persistence` | 52 |  |  |
| `check:upstream-builtin-bodies` | 52 |  |  |
| `check:behaviours-a` | 52 |  |  |
| `check:behaviours-c` | 52 |  |  |
| `check:octree` | 51 |  |  |
| `check:editor-serialize` | 51 |  |  |
| `check:game-systems-spoint` | 51 |  |  |
| `check:mat4-spoint` | 51 |  |  |
| `check:event-log` | 50 |  |  |
| `check:tick-authority` | 50 |  |  |
| `check:client-pure-rows` | 50 |  |  |
| `check:negative-zero` | 50 |  |  |
| `check:apps-a` | 49 |  |  |
| `check:apps-b` | 49 |  |  |
| `check:client-machines` | 49 |  |  |
| `check:app-loader` | 49 |  |  |
| `check:paired-report` | 49 |  |  |
| `check:sandbox` | 48 |  |  |
| `check:render` | 48 |  |  |
| `check:snapshot-processor` | 48 |  |  |
| `check:chart-transfer` | 48 |  |  |
| `check:client-tier-split` | 48 |  |  |
| `check:hygiene` | 48 |  |  |
| `check:engine-artifacts` | 48 |  |  |
| `check:feature-gap` | 47 |  |  |
| `check:physics-extras` | 47 |  |  |
| `check:row16-client-decoder` | 47 |  |  |
| `check:telemetry` | 47 |  |  |
| `check:upstream-door-routes` | 47 |  |  |
| `check:chart-state-server` | 47 |  |  |
| `check:sampler-gap-attribution` | 47 |  |  |
| `check:physics-integration` | 46 |  |  |
| `check:upstream-tome-bodies` | 45 |  |  |
| `check:behaviours-b` | 45 |  |  |
| `check:cluster-slice` | 45 |  |  |
| `check:anticheat-spoint` | 44 |  |  |
| `check:stage` | 44 |  |  |
| `check:upstream-builtin-lighting` | 44 |  |  |
| `check:network-state` | 44 |  |  |
| `check:frequency-runs` | 44 |  |  |
| `check:spawn-named-errors` | 43 |  |  |
| `check:client-loops` | 43 |  |  |
| `check:app-behaviours` | 43 |  |  |
| `check:navmesh-query-spoint` | 43 |  |  |
| `check:minidump` | 43 |  |  |
| `check:engine-visibility` | 43 |  |  |
| `check:upstream-endpoints` | 42 |  |  |
| `check:bundle-freshness-jayzee` | 42 |  |  |
| `check:consensus` | 42 |  |  |
| `check:upstream-builtin-physics` | 42 |  |  |
| `check:upstream-builtin-noise` | 42 |  |  |
| `check:client-pure-spoint` | 42 |  |  |
| `check:spawn-captured-names` | 42 |  |  |
| `check:engine-isolation` | 42 |  |  |
| `check:site` | 41 |  |  |
| `check:transport-framing` | 41 |  |  |
| `check:rollback-peer` | 41 |  |  |
| `check:clusters` | 41 |  |  |
| `check:upstream-doors` | 41 |  |  |
| `check:upstream-builtin-fx` | 41 |  |  |
| `check:upstream-builtin-postfx` | 41 |  |  |
| `check:world-def-clusters` | 41 |  |  |
| `check:camera-rig` | 41 |  |  |
| `check:stall-off-cpu` | 41 |  |  |
| `check:browser-heap` | 41 |  |  |
| `check:upstream-tome-lookup` | 40 |  |  |
| `check:upstream-builtins` | 40 |  |  |
| `check:upstream-builtin-easing` | 40 |  |  |
| `check:named-asset-redirect` | 40 |  |  |
| `check:upstream-builtin-path` | 40 |  |  |
| `check:app-runtime-state` | 40 |  |  |
| `check:crowd-dot-cells-spoint` | 40 |  |  |
| `check:material-tier-swap-spoint` | 40 |  |  |
| `check:stall-probe` | 40 |  |  |
| `check:chromium-launcher` | 40 |  |  |
| `check:tail-report` | 40 |  |  |
| `check:hot-reload` | 39 |  |  |
| `check:anticheat` | 39 |  |  |
| `check:relocation-solve` | 39 |  |  |
| `check:upstream-reference` | 39 |  |  |
| `check:relative-residuals` | 39 |  |  |
| `check:upstream-door-dispatch` | 38 |  |  |
| `check:upstream-builtin-spline` | 38 |  |  |
| `check:upstream-builtin-water` | 38 |  |  |
| `check:reexpress-records` | 38 |  |  |
| `check:world-resolver` | 38 |  |  |
| `check:asset-pipeline` | 38 |  |  |
| `check:engine-solver-tier` | 38 |  |  |
| `check:collision-placement` | 38 |  |  |
| `check:worker-dispatch` | 37 |  |  |
| `check:upstream-builtin-ballistics` | 37 |  |  |
| `check:upstream-builtin-env` | 37 |  |  |
| `check:upstream-builtin-voxels` | 37 |  |  |
| `check:postfx-shaders-spoint` | 37 |  |  |
| `check:blend-tree-spoint` | 37 |  |  |
| `check:pool-params-spoint` | 37 |  |  |
| `check:animation` | 36 |  |  |
| `check:movement` | 36 |  |  |
| `check:upstream-skills` | 36 |  |  |
| `check:upstream-builtin-terrain` | 36 |  |  |
| `check:upstream-builtin-tsl` | 36 |  |  |
| `check:vec3-read` | 36 |  |  |
| `check:player-id` | 36 |  |  |
| `check:messages` | 35 |  |  |
| `check:content` | 35 |  |  |
| `check:flight-model` | 35 |  |  |
| `check:rollback-bridge` | 35 |  |  |
| `check:tick-scheduler` | 35 |  |  |
| `check:upstream-tome` | 35 |  |  |
| `check:upstream-builtin-math` | 35 |  |  |
| `check:heightfield-physics` | 35 |  |  |
| `check:hook-order` | 35 |  |  |
| `check:upstream-builtin-tween` | 35 |  |  |
| `check:component-pool` | 35 |  |  |
| `check:cube-sphere-cell-key-spoint` | 35 |  |  |
| `check:spawn-captured-bodies` | 35 |  |  |
| `check:render-1024-visible` | 35 |  |  |
| `check:planet-gap-class` | 35 |  |  |
| `check:worker-bridge` | 34 |  |  |
| `check:upstream-builtin-vec3` | 34 |  |  |
| `check:upstream-builtin-room-routing` | 34 |  |  |
| `check:upstream-builtin-three` | 34 |  |  |
| `check:upstream-builtin-vibe` | 34 |  |  |
| `check:collider-layers` | 34 |  |  |
| `check:character-step` | 33 |  |  |
| `check:constraint-limits` | 33 |  |  |
| `check:vehicle-tuning` | 33 |  |  |
| `check:tick-order` | 32 |  |  |
| `check:jolt-limits` | 31 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 42. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-12T08:41:05.241Z. Queue wait 13 s from the push to the first line of the script. Run time 546.3 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.227 | 11.154 | 13.558 | 0 | 8.48 / 4.86 | 11.846 | 13.558 | 0 | 7.262 | 10.845 | 0 | 278248248 | 668400144 | 1220.5 | 1040.4 | 10.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.684 | 9.907 | 12.808 | 0 | 7.3 / 3.85 | 7.906 | 8.912 | 0 | 5.758 | 10.802 | 0 | 278246392 | 668400144 | 1090 | 1035.7 | 8.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.218 | 11.667 | 27.534 | 2 | 8 / 5.01 | 9.943 | 11.667 | 0 | 7.288 | 13.21 | 2 | 278248248 | 668400144 | 1134.5 | 980.7 | 10 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.745 | 10.263 | 12.382 | 0 | 6.57 / 3.9 | 7.698 | 10.072 | 0 | 5.893 | 11.012 | 0 | 278246392 | 668400144 | 1115.7 | 1024 | 8.7 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.209 | 12.843 | 15.954 | 0 | 7.59 / 4.95 | 9.689 | 13.036 | 0 | 7.341 | 13.575 | 0 | 278248248 | 668400144 | 1195.5 | 1000.7 | 10.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.056 | 10.996 | 16.094 | 0 | 7.18 / 3.89 | 8.796 | 10.996 | 0 | 6.174 | 11.307 | 0 | 278246392 | 668400144 | 1081.6 | 1060.5 | 9 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.31 | 10.824 | 15.494 | 0 | 7.87 / 5.03 | 9.87 | 10.399 | 0 | 7.444 | 12.735 | 0 | 278248248 | 668400144 | 1178.5 | 1039.3 | 10.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.862 | 10.706 | 15.364 | 0 | 6.78 / 4.21 | 7.721 | 8.986 | 0 | 5.981 | 11.887 | 0 | 278246392 | 668400144 | 1120.3 | 1031.1 | 8.8 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.253 | 11.973 | 14.876 | 0 | 7.8 / 4.93 | 9.944 | 10.846 | 0 | 7.365 | 12.489 | 0 | 278248248 | 668400144 | 1092 | 1072.2 | 10.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.82 | 7.919 | 8.999 | 0 | 6.89 / 3.77 | 8.397 | 8.999 | 0 | 5.895 | 7.869 | 0 | 278246392 | 668400144 | 1104.2 | 929.9 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.023 | 8.739 | 11.936 | 0 | 7.16 / 3.8 | 7.776 | 8.52 | 0 | 6.216 | 8.825 | 0 | 278246392 | 668400144 | 1171.9 | 933 | 8.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.639 | 7.229 | 9.463 | 0 | 6.79 / 4 | 7.45 | 9.463 | 0 | 5.635 | 7.125 | 0 | 278227272 | 668400144 | 1099.5 | 1139.8 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.019 | 10.373 | 12.781 | 0 | 6.76 / 3.87 | 11.825 | 12.781 | 0 | 6.07 | 7.981 | 0 | 278246392 | 668400144 | 1105.5 | 1042.8 | 8.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.582 | 9.84 | 13.115 | 0 | 7.02 / 3.93 | 6.873 | 7.681 | 0 | 5.697 | 9.889 | 0 | 278227272 | 668400144 | 1138.5 | 962.3 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.769 | 10.252 | 14.271 | 0 | 7.57 / 4.03 | 8.153 | 8.63 | 0 | 5.916 | 11.312 | 0 | 278246392 | 668400144 | 1129 | 1066.5 | 8.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.459 | 9.488 | 13.829 | 0 | 6.93 / 3.91 | 6.838 | 6.942 | 0 | 5.526 | 11.257 | 0 | 278227272 | 668400144 | 1112.7 | 1038.6 | 8.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.88 | 7.847 | 9.053 | 0 | 7.4 / 4.03 | 8.774 | 9.053 | 0 | 5.932 | 7.713 | 0 | 278246392 | 668400144 | 1098.3 | 976.1 | 8.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.611 | 7.441 | 10.239 | 0 | 7.31 / 3.8 | 6.785 | 7.409 | 0 | 5.696 | 7.747 | 0 | 278227272 | 668400144 | 1135.5 | 1046.6 | 8.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.827 | 8.127 | 9.761 | 0 | 6.62 / 3.82 | 8.524 | 9.761 | 0 | 5.865 | 7.592 | 0 | 278246392 | 668400144 | 1099.1 | 861.8 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.552 | 9.132 | 14.735 | 0 | 6.74 / 3.95 | 11.56 | 14.735 | 0 | 5.586 | 7.161 | 0 | 278227272 | 668400144 | 1108.3 | 993.8 | 8.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.78 | 9.988 | 14.947 | 0 | 7.05 / 3.94 | 7.783 | 11.769 | 0 | 5.846 | 11.745 | 0 | 278246392 | 668400144 | 1107.6 | 1102.4 | 8.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.547 | 10.264 | 15.882 | 0 | 7.32 / 4.16 | 6.877 | 7.067 | 0 | 5.594 | 10.508 | 0 | 278227272 | 668400144 | 1115 | 1090.5 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.794 | 10.28 | 13.719 | 0 | 7.08 / 3.94 | 7.758 | 8.53 | 0 | 5.864 | 10.578 | 0 | 278246392 | 668400144 | 1105.8 | 982.4 | 8.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.464 | 6.957 | 7.569 | 0 | 6.85 / 3.78 | 6.972 | 7.569 | 0 | 5.527 | 6.957 | 0 | 278227272 | 668400144 | 1111.9 | 1099.6 | 8.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.733 | 7.782 | 9.961 | 0 | 7.26 / 3.89 | 8.317 | 9.961 | 0 | 5.824 | 7.782 | 0 | 278246392 | 668400144 | 1125.9 | 949.9 | 8.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.519 | 7.236 | 9.206 | 0 | 6.74 / 3.86 | 7.962 | 9.206 | 0 | 5.593 | 7.012 | 0 | 278227272 | 668400144 | 1121 | 971.2 | 8.3 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 11.17 | 15.405 | 19.065 | 7 | 9.14 / 5.68 | 17.738 | 19.065 | 4 | 11.43 | 14.796 | 3 | 278246392 | 668203536 | 1107.4 | 1012.6 | 13.4 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.733 | 10.513 | 14.649 | 0 | 8.29 / 4.67 | 10.295 | 11.688 | 0 | 7.894 | 10.616 | 0 | 278246392 | 668269072 | 1153.1 | 1073.7 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.662 | 8.459 | 9.952 | 0 | 7.06 / 4.47 | 8.702 | 9.952 | 0 | 6.815 | 8.441 | 0 | 278246392 | 668334608 | 1110.8 | 955.6 | 9.3 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 6.053 | 8.546 | 9.608 | 0 | 7.74 / 4.24 | 7.905 | 9.174 | 0 | 6.176 | 8.675 | 0 | 278246392 | 668531216 | 1145 | 940.8 | 8.9 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 7.325 | 10.54 | 12.593 | 0 | 7.44 / 4.39 | 8.914 | 10.976 | 0 | 7.607 | 10.631 | 0 | 278246392 | 668400144 | 1161.2 | 996.4 | 10.1 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.041 | 10.392 | 27.654 | 2 | 27.65 / 7.08 | 13.695 | 22.624 | 1 | 6.105 | 7.965 | 0 | 278246392 | 668400144 |  | 828.9 | 7.7 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.517 | 6.372 | 7.075 | 0 | 7.06 / 3.99 | 6.824 | 7.075 | 0 | 0.449 | 0.838 | 0 | 196055280 | 668400144 | 1213.8 | 981 | 4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.852 | 8.756 | 14.107 | 0 | 6.59 / 4.02 | 8.44 | 10.268 | 0 | 5.87 | 8.931 | 0 | 405644800 | 668400144 | 1122.1 | 1115.5 | 19.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.339 | 6.755 | 8.069 | 0 | 6.6 / 3.54 | 7.034 | 8.069 | 0 | 5.342 | 6.666 | 0 | 222469344 | 668400144 | 1128 | 917.7 | 6.7 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.156 | 9.365 | 12.918 | 0 | 6.73 / 3.66 | 11.895 | 12.918 | 0 | 5.122 | 6.415 | 0 | 222620160 | 668400144 | 1100.8 | 972.1 | 6.7 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.357 | 6.873 | 8.71 | 0 | 6.46 / 3.65 | 6.873 | 7.588 | 0 | 5.407 | 6.907 | 0 | 222423696 | 668400144 | 1104.6 | 916.7 | 6.7 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.119 | 6.602 | 8.01 | 0 | 7.11 / 3.91 | 6.205 | 7.364 | 0 | 5.101 | 6.68 | 0 | 222580688 | 668400144 | 1101.6 | 966 | 6.6 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.997 | 10.288 | 15.348 | 0 | 8.91 / 6.33 | 12.623 | 15.348 | 0 | 7 | 8.677 | 0 | 278246392 | 668400144 | 1179.4 | 1075.1 | 9.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.024 | 11.474 | 17.86 | 1 | 9.73 / 5.38 | 15.534 | 17.86 | 1 | 7.106 | 8.736 | 0 | 278246392 | 668400144 | 1187.8 | 946.4 | 9.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.957 | 13.037 | 17.705 | 3 | 8.34 / 4.95 | 16.804 | 17.705 | 3 | 7.03 | 9.061 | 0 | 278246392 | 668400144 | 1192.8 | 953.6 | 9.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.989 | 10.535 | 15.387 | 0 | 8.43 / 4.83 | 14.234 | 15.387 | 0 | 7.044 | 8.79 | 0 | 278246392 | 668400144 | 1225.1 | 938.8 | 9.8 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.902 | 12.304 | 17.425 | 1 | 9.33 / 6.58 | 14.293 | 17.425 | 1 | 6.935 | 8.747 | 0 | 278246392 | 668400144 | 1203.5 | 928.8 | 9.7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.852 | 11.787 | 15.31 | 0 | 9.48 / 7.25 | 13.68 | 15.31 | 0 | 6.928 | 8.768 | 0 | 278246392 | 668400144 | 1168.4 | 931.5 | 9.6 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.422 | 7.873 | 10.257 | 0 | 9.4 / 5.07 | 8.208 | 10.257 | 0 | 0.409 | 0.576 | 0 | 196055280 | 668400144 | 1200.6 | 963 | 4.2 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.394 | 7.479 | 9.256 | 0 | 9.26 / 6.34 | 8.211 | 8.525 | 0 | 0.382 | 0.693 | 0 | 196055280 | 668400144 | 1199.2 | 1001.4 | 4.2 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.426 | 7.701 | 9.103 | 0 | 9.1 / 6.32 | 8.047 | 8.067 | 0 | 0.409 | 0.542 | 0 | 196055280 | 668400144 | 1164.6 | 984.9 | 4.2 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 10.939 | 11.003 | 0 | 0 | 10.474 | 11.157 | 0 | 19.7 |
| 128 MiB fixed | 1 | schedstat | 10.969 | 11.958 | 0 | 0 | 10.753 | 12.02 | 0 | 19.8 |
| 512 MiB fixed | 1 | schedstat | 10.001 | 11.004 | 0 | 0 | 10.028 | 11.446 | 0 | 15.7 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.999 | 8.836 | 0 | 0 | 7.01 | 9.448 | 0 | 14.3 |

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
