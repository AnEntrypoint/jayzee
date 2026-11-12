# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 169.6 s across 309 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:engine-state-hash-1024` | 16518 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-marble-bowl` | 15455 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:engine-tiers` | 11286 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:scenario-determinism` | 10242 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:pose-allocations` | 8265 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:elevation-ab` | 8252 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:engine-job-wait` | 7264 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:alloc-audit` | 5339 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:height-cpu` | 5330 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:sphere-population` | 4815 |  | Places the full sphere population and checks every member. |
| `check:app-watch` | 4573 |  | Waits on real file-watch events. |
| `check:heightmap-cli` | 3825 |  | Runs the heightmap CLI once per fixture case. |
| `check:vegetation-allocations` | 3423 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:engine-release` | 2924 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:engine-threads` | 2243 | yes | Runs the threaded scenario at several worker counts. |
| `check:scenario-allocations` | 2229 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:mapspinner-atmosphere` | 2227 |  | Integrates the atmosphere tables against spoint values. |
| `check:thread-sampler` | 2054 | yes | Samples real threads over a timed window. |
| `check:own-display` | 1839 |  |  |
| `check:vegetation-generate-cost` | 1644 |  |  |
| `check:gc-witness` | 1500 |  |  |
| `check:types` | 1377 |  |  |
| `check:scenario-lockstep-rts` | 1280 | yes |  |
| `check:scenario-deathrun` | 1257 | yes |  |
| `check:gc-reuse-rows` | 1158 |  |  |
| `check:scenario-boss-fight` | 1083 | yes |  |
| `check:create-app` | 1000 |  |  |
| `check:scenario-combat-bots` | 911 | yes |  |
| `check:upload-writes` | 897 |  |  |
| `check:engine-footprint` | 862 |  |  |
| `check:engine-host-witness` | 834 |  |  |
| `check:wireweave-relay` | 833 |  |  |
| `check:pose-replay` | 784 |  |  |
| `check:scenario-character-terrain` | 784 | yes |  |
| `check:upload-handler` | 744 |  |  |
| `check:scenario-projectile-volley` | 742 | yes |  |
| `check:crowd-dot-buffer` | 717 |  |  |
| `check:engine-awake-budget` | 699 |  |  |
| `check:planet-witness-scene` | 670 |  |  |
| `check:planet-witness` | 634 |  |  |
| `check:package-surface` | 634 |  |  |
| `check:transport` | 631 |  |  |
| `check:scenario-planet-landing` | 631 | yes |  |
| `check:engine-warm` | 623 |  |  |
| `check:scenario-settle` | 621 | yes |  |
| `check:socket-server` | 491 |  |  |
| `build:kernel` | 450 |  |  |
| `check:engine-airborne` | 441 |  |  |
| `check:sharding` | 439 |  |  |
| `check:engine-raycast` | 424 |  |  |
| `check:scenario-character` | 423 | yes |  |
| `check:engine-pools` | 417 |  |  |
| `check:planet-scene-counts` | 408 |  |  |
| `check:engine-seal` | 391 |  |  |
| `check:project-naming` | 382 |  |  |
| `check:stall-attribution` | 360 |  |  |
| `check:engine-shapecast` | 343 |  |  |
| `check:collision-placement-options` | 336 |  |  |
| `check:terrain-agreement` | 282 |  |  |
| `check:physics-integration-vehicles` | 275 |  |  |
| `check:collision-mirror` | 265 |  |  |
| `check:packages` | 264 |  |  |
| `check:vehicles-spoint` | 263 |  |  |
| `check:engine-vegetation` | 255 |  |  |
| `check:sdk-surfaces` | 249 |  |  |
| `check:webgpu-profile` | 245 |  |  |
| `check:dormant-budget-spoint` | 235 |  |  |
| `check:overlap-spoint` | 234 |  |  |
| `check:engine-world` | 229 |  |  |
| `check:snapshots` | 226 |  |  |
| `check:fire` | 224 |  |  |
| `check:raycast-spoint` | 224 |  |  |
| `check:vehicle-remove-spoint` | 224 |  |  |
| `check:collision-tile-streamer` | 224 |  |  |
| `check:player-lod-renderer` | 220 |  |  |
| `check:vehicle-refusal-spoint` | 218 |  |  |
| `check:collision-host` | 215 |  |  |
| `check:dormant-spoint` | 215 |  |  |
| `check:player-lod-renderer-webgpu` | 210 |  |  |
| `check:player-vat-spoint` | 205 |  |  |
| `check:chart-state-live` | 204 |  |  |
| `check:engine-materials` | 203 |  |  |
| `check:site-world` | 196 |  |  |
| `check:recast-bake-spoint` | 195 |  |  |
| `check:player-dot-material-spoint` | 192 |  |  |
| `check:netcode` | 187 |  |  |
| `check:bloom-spoint` | 183 |  |  |
| `check:engine-planet` | 182 |  |  |
| `check:rebase-session` | 177 |  |  |
| `check:engine-bridge` | 173 |  |  |
| `check:player-dot-shader-spoint` | 165 |  |  |
| `check:camera-relative` | 163 |  |  |
| `check:streaming-gltf-mesh` | 162 |  |  |
| `check:cluster-lod-spoint` | 161 |  |  |
| `check:engine-sleep` | 160 |  |  |
| `check:terrain-static` | 156 |  |  |
| `check:scene-setup-spoint` | 155 |  |  |
| `check:decode-path` | 146 |  |  |
| `check:engine-interest` | 145 |  |  |
| `check:upstream-builtin-nav` | 143 |  |  |
| `check:engine-budget-floor` | 141 |  |  |
| `check:terrain-pure` | 137 |  |  |
| `check:lockstep` | 137 |  |  |
| `check:streamer-p99` | 135 |  |  |
| `check:vegetation-leaf-patches` | 133 |  |  |
| `check:engine-leak` | 133 |  |  |
| `check:spline-erosion-witness` | 131 |  |  |
| `check:fire-modules` | 124 |  |  |
| `check:bin-snapshot` | 123 |  |  |
| `check:ssr-spoint` | 122 |  |  |
| `check:sample-order` | 122 |  |  |
| `check:chart-anchor` | 121 |  |  |
| `check:vat-spoint` | 121 |  |  |
| `check:engine-codecs` | 115 |  |  |
| `check:engine-core` | 114 |  |  |
| `check:client-pure` | 112 |  |  |
| `check:sessions` | 112 |  |  |
| `check:timed-result` | 112 |  |  |
| `check:kernel` | 111 |  |  |
| `check:socket-upgrade` | 110 |  |  |
| `check:client-resource-pools` | 108 |  |  |
| `check:procgen` | 107 |  |  |
| `check:ci-engine-glue` | 107 |  |  |
| `check:fsr1-spoint` | 106 |  |  |
| `check:import-scene` | 101 |  |  |
| `check:replay-file` | 98 |  |  |
| `check:glue-tier` | 97 |  |  |
| `check:tick-governor` | 96 | yes |  |
| `check:follow-misuse` | 96 |  |  |
| `check:player-collisions` | 93 |  |  |
| `check:spoint-core-rust` | 93 |  |  |
| `check:kaggle-regress` | 92 |  |  |
| `check:lag-compensation` | 90 |  |  |
| `check:collider-streamer` | 87 |  |  |
| `check:behaviours` | 85 |  |  |
| `check:upstream-skill-registry` | 84 |  |  |
| `check:vegetation-stream` | 84 |  |  |
| `check:msgpack-packer` | 83 |  |  |
| `check:lod-tiers` | 83 |  |  |
| `check:replay-player` | 81 |  |  |
| `check:rollback` | 81 |  |  |
| `check:prediction-engine` | 81 |  |  |
| `check:physics-pure` | 80 |  |  |
| `check:client-message-handler` | 80 |  |  |
| `check:player-lod-plan` | 79 |  |  |
| `check:netcode-small` | 78 |  |  |
| `check:replay-dialect` | 77 |  |  |
| `check:protocol-codecs` | 76 |  |  |
| `check:msgpackr-compat` | 76 |  |  |
| `check:bundle-freshness-jayzee` | 76 |  |  |
| `check:cluster-handoff` | 76 |  |  |
| `check:snapshot-lod` | 76 |  |  |
| `check:streaming-gltf-queues` | 75 |  |  |
| `check:sdk-misc` | 75 |  |  |
| `check:snapshot-packer` | 75 |  |  |
| `check:engine-render` | 75 |  |  |
| `check:spawn` | 74 |  |  |
| `check:pathfinding` | 74 |  |  |
| `check:behaviours-c` | 74 |  |  |
| `check:reduced-pose` | 74 |  |  |
| `check:negative-zero` | 74 |  |  |
| `check:aoi` | 72 |  |  |
| `check:animation-control` | 72 |  |  |
| `check:chart-migrators` | 72 |  |  |
| `check:upload-route` | 72 |  |  |
| `check:wireweave-frame-spoint` | 72 |  |  |
| `check:hygiene` | 71 |  |  |
| `check:controlled-run` | 71 |  |  |
| `check:protocol` | 69 |  |  |
| `check:game-systems` | 69 |  |  |
| `check:behaviour-health-destructible` | 69 |  |  |
| `check:chart-reanchor` | 69 |  |  |
| `check:upstream-skill-bodies` | 69 |  |  |
| `check:shared-pure` | 69 |  |  |
| `check:hot-reload-spoint` | 69 |  |  |
| `check:game-systems-spoint` | 69 |  |  |
| `check:world` | 68 |  |  |
| `check:behaviours-a` | 68 |  |  |
| `check:tick-authority` | 67 |  |  |
| `check:client-pure-rows` | 67 |  |  |
| `check:frame-stall-cause` | 67 |  |  |
| `check:snapshot-processor` | 66 |  |  |
| `check:upstream-builtin-bodies` | 65 |  |  |
| `check:sdk-editor` | 65 |  |  |
| `check:world-config` | 65 |  |  |
| `check:mat4-spoint` | 65 |  |  |
| `check:behaviours-b` | 64 |  |  |
| `check:app-loader` | 64 |  |  |
| `check:paint-store` | 63 |  |  |
| `check:octree` | 62 |  |  |
| `check:apps-a` | 62 |  |  |
| `check:anticheat-spoint` | 61 |  |  |
| `check:feature-gap` | 61 |  |  |
| `check:event-log` | 61 |  |  |
| `check:world-persistence` | 61 |  |  |
| `check:chart-transfer` | 61 |  |  |
| `check:upstream-door-routes` | 61 |  |  |
| `check:stage` | 60 |  |  |
| `check:row16-client-decoder` | 60 |  |  |
| `check:telemetry` | 60 |  |  |
| `check:apps-b` | 60 |  |  |
| `check:chart-state-server` | 60 |  |  |
| `check:upstream-builtin-noise` | 59 |  |  |
| `check:client-machines` | 59 |  |  |
| `check:client-tier-split` | 59 |  |  |
| `check:paired-report` | 59 |  |  |
| `check:frequency-runs` | 59 |  |  |
| `check:render` | 58 |  |  |
| `check:client-loops` | 58 |  |  |
| `check:upstream-builtin-lighting` | 58 |  |  |
| `check:cluster-slice` | 58 |  |  |
| `check:material-tier-swap-spoint` | 58 |  |  |
| `check:spawn-named-errors` | 57 |  |  |
| `check:clusters` | 57 |  |  |
| `check:upstream-tome-bodies` | 57 |  |  |
| `check:world-query` | 57 |  |  |
| `check:editor-serialize` | 57 |  |  |
| `check:sandbox` | 56 |  |  |
| `check:upstream-builtin-easing` | 55 |  |  |
| `check:upstream-builtin-physics` | 55 |  |  |
| `check:camera-rig` | 55 |  |  |
| `check:physics-integration` | 55 |  |  |
| `check:client-pure-spoint` | 55 |  |  |
| `check:spawn-captured-names` | 55 |  |  |
| `check:engine-artifacts` | 55 |  |  |
| `check:sampler-gap-attribution` | 55 |  |  |
| `check:physics-extras` | 54 |  |  |
| `check:app-behaviours` | 54 |  |  |
| `check:app-runtime-state` | 54 |  |  |
| `check:stall-off-cpu` | 54 |  |  |
| `check:upstream-tome-lookup` | 53 |  |  |
| `check:upstream-builtin-env` | 53 |  |  |
| `check:network-state` | 53 |  |  |
| `check:entity-host` | 53 |  |  |
| `check:upstream-reference` | 52 |  |  |
| `check:crowd-dot-cells-spoint` | 52 |  |  |
| `check:asset-pipeline` | 52 |  |  |
| `check:consensus` | 51 |  |  |
| `check:ccd` | 51 |  |  |
| `check:script-limits` | 51 |  |  |
| `check:browser-heap` | 51 |  |  |
| `check:collision-placement` | 51 |  |  |
| `check:rollback-peer` | 50 |  |  |
| `check:upstream-door-dispatch` | 50 |  |  |
| `check:upstream-builtin-three` | 50 |  |  |
| `check:vec3-read` | 50 |  |  |
| `check:postfx-shaders-spoint` | 50 |  |  |
| `check:blend-tree-spoint` | 50 |  |  |
| `check:navmesh-query-spoint` | 50 |  |  |
| `check:minidump` | 50 |  |  |
| `check:anticheat` | 49 |  |  |
| `check:constraint-limits` | 49 |  |  |
| `check:upstream-builtins` | 49 |  |  |
| `check:reexpress-records` | 49 |  |  |
| `check:cube-sphere-cell-key-spoint` | 49 |  |  |
| `check:stall-probe` | 49 |  |  |
| `check:relative-residuals` | 49 |  |  |
| `check:site` | 48 |  |  |
| `check:tick-scheduler` | 48 |  |  |
| `check:hook-order` | 48 |  |  |
| `check:upstream-builtin-path` | 48 |  |  |
| `check:upstream-builtin-tween` | 48 |  |  |
| `check:upstream-builtin-voxels` | 48 |  |  |
| `check:component-pool` | 48 |  |  |
| `check:pool-params-spoint` | 48 |  |  |
| `check:engine-solver-tier` | 48 |  |  |
| `check:tail-report` | 48 |  |  |
| `check:engine-isolation` | 48 |  |  |
| `check:upstream-endpoints` | 47 |  |  |
| `check:animation` | 47 |  |  |
| `check:character-step` | 47 |  |  |
| `check:rollback-bridge` | 47 |  |  |
| `check:upstream-builtin-vec3` | 47 |  |  |
| `check:named-asset-redirect` | 47 |  |  |
| `check:upstream-builtin-ballistics` | 47 |  |  |
| `check:upstream-builtin-water` | 47 |  |  |
| `check:world-resolver` | 47 |  |  |
| `check:render-1024-visible` | 47 |  |  |
| `check:collider-layers` | 47 |  |  |
| `check:planet-gap-class` | 47 |  |  |
| `check:hot-reload` | 46 |  |  |
| `check:upstream-skills` | 46 |  |  |
| `check:upstream-builtin-fx` | 46 |  |  |
| `check:upstream-builtin-spline` | 46 |  |  |
| `check:upstream-builtin-terrain` | 46 |  |  |
| `check:player-id` | 46 |  |  |
| `check:world-def-clusters` | 46 |  |  |
| `check:engine-visibility` | 46 |  |  |
| `check:transport-framing` | 45 |  |  |
| `check:relocation-solve` | 45 |  |  |
| `check:worker-dispatch` | 45 |  |  |
| `check:upstream-doors` | 45 |  |  |
| `check:upstream-tome` | 45 |  |  |
| `check:upstream-builtin-math` | 45 |  |  |
| `check:upstream-builtin-room-routing` | 45 |  |  |
| `check:upstream-builtin-vibe` | 45 |  |  |
| `check:spawn-captured-bodies` | 45 |  |  |
| `check:chromium-launcher` | 45 |  |  |
| `check:content` | 44 |  |  |
| `check:flight-model` | 44 |  |  |
| `check:jolt-limits` | 44 |  |  |
| `check:movement` | 44 |  |  |
| `check:worker-bridge` | 44 |  |  |
| `check:heightfield-physics` | 44 |  |  |
| `check:upstream-builtin-postfx` | 44 |  |  |
| `check:messages` | 43 |  |  |
| `check:vehicle-tuning` | 43 |  |  |
| `check:upstream-builtin-tsl` | 43 |  |  |
| `check:tick-order` | 41 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 45. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: AMD EPYC 7B12, 4 CPUs, Node v22.23.4, machine class AuthenticAMD-23-49-0 (2 cores, 4 threads).
- Pushed 2026-11-12T10:56:48.856Z. Queue wait 12 s from the push to the first line of the script. Run time 386.8 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.515 | 8.561 | 11.803 | 0 | 5.59 / 4.06 | 7.45 | 9.619 | 0 | 5.643 | 8.873 | 0 | 278248248 | 668400144 | 686.1 | 529.4 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.94 | 6.008 | 7.18 | 0 | 5.13 / 3.06 | 6.569 | 7.18 | 0 | 4.992 | 5.937 | 0 | 278230008 | 668400144 | 260.6 | 123.1 | 5.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.562 | 8.814 | 11.176 | 0 | 5.52 / 3.79 | 10.713 | 11.176 | 0 | 5.618 | 7.263 | 0 | 278248248 | 668400144 | 661.5 | 522.3 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.86 | 7.082 | 8.838 | 0 | 4.68 / 3 | 6.168 | 8.772 | 0 | 4.992 | 7.245 | 0 | 278230008 | 668400144 | 256.4 | 128.6 | 5.4 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.327 | 6.953 | 31.909 | 1 | 5.29 / 3.21 | 6.91 | 8.334 | 0 | 5.395 | 7.375 | 1 | 278248248 | 668400144 | 693.8 | 526.4 | 6.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.858 | 7.394 | 10.352 | 0 | 4.63 / 2.89 | 6.384 | 8.502 | 0 | 4.974 | 7.524 | 0 | 278230008 | 668400144 | 263.3 | 124.7 | 5.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.539 | 7.337 | 12.155 | 0 | 5.45 / 3.47 | 8.422 | 12.155 | 0 | 5.615 | 7.1 | 0 | 278248248 | 668400144 | 656.7 | 522.8 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.933 | 6.317 | 8.237 | 0 | 5.27 / 3.55 | 6.722 | 8.237 | 0 | 4.971 | 6.161 | 0 | 278230008 | 668400144 | 275.2 | 137.7 | 5.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.808 | 9.819 | 12.384 | 0 | 5.85 / 3.7 | 7.813 | 8.917 | 0 | 5.897 | 10.625 | 0 | 278248248 | 668400144 | 659.1 | 541.8 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.002 | 6.402 | 7.716 | 0 | 5.4 / 3.26 | 6.565 | 7.716 | 0 | 5.039 | 6.254 | 0 | 278230008 | 668400144 | 264.8 | 131.9 | 5.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.984 | 7.795 | 10.361 | 0 | 4.78 / 3.08 | 7.236 | 7.896 | 0 | 5.103 | 8.195 | 0 | 278230008 | 668400144 | 264 | 125.1 | 5.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.783 | 6.009 | 8.037 | 0 | 5.45 / 3.85 | 5.878 | 7.272 | 0 | 4.81 | 6.127 | 0 | 278210888 | 668400144 | 261.9 | 140.5 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.823 | 7.137 | 10.282 | 0 | 4.84 / 3.09 | 9.627 | 10.282 | 0 | 4.792 | 5.939 | 0 | 278230008 | 668400144 | 268.3 | 128.5 | 5.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.712 | 5.676 | 7.198 | 0 | 5.04 / 3.16 | 5.618 | 6.413 | 0 | 4.749 | 5.683 | 0 | 278210888 | 668400144 | 264.6 | 125.4 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.905 | 6.197 | 7.138 | 0 | 6.6 / 2.85 | 6.253 | 7.138 | 0 | 4.975 | 6.175 | 0 | 278230008 | 668400144 | 249.8 | 124.7 | 5.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.724 | 6.814 | 9.78 | 0 | 4.76 / 3.15 | 5.552 | 5.654 | 0 | 4.795 | 7.871 | 0 | 278210888 | 668400144 | 264.8 | 126.7 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.985 | 6.371 | 7.03 | 0 | 3.86 / 1.97 | 6.541 | 6.839 | 0 | 5.053 | 6.325 | 0 | 278230008 | 668400144 | 258.7 | 122.6 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.68 | 7.815 | 10.904 | 0 | 4.88 / 3.13 | 5.886 | 6.272 | 0 | 4.694 | 8.688 | 0 | 278210888 | 668400144 | 266.8 | 125.3 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.875 | 6.189 | 7.069 | 0 | 4.84 / 3.22 | 6.638 | 7.069 | 0 | 4.936 | 6.174 | 0 | 278230008 | 668400144 | 259.2 | 128.9 | 5.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.66 | 6.689 | 7.635 | 0 | 4.93 / 3.15 | 5.944 | 6.553 | 0 | 4.721 | 7.047 | 0 | 278210888 | 668400144 | 262.6 | 126.6 | 5.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.944 | 6.25 | 7.143 | 0 | 4.91 / 2.35 | 6.091 | 7.143 | 0 | 5.042 | 6.344 | 0 | 278230008 | 668400144 | 259 | 130.6 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.713 | 7.875 | 11.126 | 0 | 4.88 / 5.02 | 6.191 | 6.37 | 0 | 4.751 | 8.105 | 0 | 278210888 | 668400144 | 258.6 | 126.9 | 5.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.987 | 6.504 | 7.334 | 0 | 5.13 / 3.32 | 6.531 | 7.334 | 0 | 5.075 | 6.503 | 0 | 278230008 | 668400144 | 266.1 | 124.6 | 5.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.866 | 8.431 | 12.96 | 0 | 5.49 / 3.26 | 10.166 | 12.96 | 0 | 4.903 | 6.158 | 0 | 278210888 | 668400144 | 266.5 | 132.1 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.97 | 6.187 | 8.824 | 0 | 5.13 / 3.13 | 6.658 | 8.824 | 0 | 5.029 | 6.112 | 0 | 278230008 | 668400144 | 266.2 | 125.2 | 5.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 4.817 | 6.078 | 9.277 | 0 | 6.18 / 3.88 | 6.604 | 9.277 | 0 | 4.838 | 5.944 | 0 | 278210888 | 668400144 | 256.8 | 126.7 | 5.5 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 6.3 | 9.979 | 11.372 | 0 | 5.24 / 3.24 | 10.283 | 11.372 | 0 | 6.452 | 9.979 | 0 | 278230008 | 668203536 | 270.9 | 125.8 | 7 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.345 | 8.969 | 9.823 | 0 | 6.31 / 4.33 | 9.006 | 9.823 | 0 | 7.536 | 8.969 | 0 | 278230008 | 668269072 | 259.4 | 131.4 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 5.947 | 7.951 | 9.439 | 0 | 5.43 / 3.5 | 8.304 | 8.737 | 0 | 5.95 | 7.767 | 0 | 278230008 | 668334608 | 271.7 | 147.9 | 6.6 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 5.168 | 8.411 | 11.207 | 0 | 5.26 / 3.45 | 6.619 | 6.969 | 0 | 5.313 | 9.474 | 0 | 278230008 | 668531216 | 275.1 | 133.2 | 5.8 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 6.045 | 7.824 | 8.79 | 0 | 5.36 / 3.35 | 7.904 | 8.79 | 0 | 6.147 | 7.824 | 0 | 278230008 | 668400144 | 310.2 | 132 | 6.6 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 5.158 | 7.004 | 19.238 | 2 | 18.84 / 11.04 | 7.773 | 19.238 | 1 | 5.191 | 6.341 | 0 | 278230008 | 668400144 |  | 77.3 | 5.5 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.182 | 5.64 | 7.223 | 0 | 5.48 / 3.15 | 6.016 | 7.223 | 0 | 0.175 | 0.251 | 0 | 196038896 | 668400144 | 270 | 134 | 1.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.088 | 7.047 | 12.958 | 0 | 4.95 / 3.32 | 6.68 | 7.642 | 0 | 5.103 | 7.141 | 0 | 405628416 | 668400144 | 268.5 | 132.8 | 14.6 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.889 | 6.757 | 7.513 | 0 | 5.71 / 3.44 | 6.232 | 6.398 | 0 | 4.987 | 6.864 | 0 | 222452960 | 668400144 | 324.1 | 129 | 4.6 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.795 | 6.389 | 8.144 | 0 | 5.29 / 3.07 | 6.556 | 6.858 | 0 | 4.779 | 6.382 | 0 | 222603776 | 668400144 | 281.6 | 158.7 | 4.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.226 | 7.1 | 8.073 | 0 | 5.44 / 3.36 | 7.269 | 8.073 | 0 | 5.224 | 6.849 | 0 | 222407312 | 668400144 | 304 | 164.7 | 4.8 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.819 | 6.445 | 7.894 | 0 | 5.63 / 3.15 | 6.18 | 6.433 | 0 | 4.859 | 6.744 | 0 | 222564304 | 668400144 | 269.8 | 139.9 | 4.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.828 | 10.638 | 13.135 | 0 | 6.65 / 3.46 | 12.493 | 13.135 | 0 | 6.859 | 8.916 | 0 | 278246392 | 668400144 | 353.4 | 205 | 7.6 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.762 | 11.234 | 16.456 | 0 | 7.24 / 4.69 | 8.449 | 9.055 | 0 | 6.831 | 12.4 | 0 | 278246392 | 668400144 | 419.2 | 145 | 7.6 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.53 | 10.676 | 12.954 | 0 | 5.53 / 5.4 | 8.893 | 9.295 | 0 | 6.621 | 11.501 | 0 | 278246392 | 668400144 | 359 | 133.4 | 7.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.428 | 8.042 | 9.516 | 0 | 6.93 / 5.61 | 8.484 | 8.675 | 0 | 6.468 | 8.025 | 0 | 278246392 | 668400144 | 383.8 | 163.8 | 7.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.575 | 10.211 | 16.86 | 1 | 7.05 / 5.69 | 13.546 | 16.86 | 1 | 6.685 | 8.589 | 0 | 278246392 | 668400144 | 360.9 | 204.1 | 7.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.53 | 9.668 | 14.939 | 0 | 5.52 / 4.2 | 8.632 | 9.835 | 0 | 6.623 | 10.237 | 0 | 278246392 | 668400144 | 346.7 | 135.8 | 7.3 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.207 | 7.551 | 8.437 | 0 | 8.12 / 3.41 | 8.085 | 8.437 | 0 | 0.198 | 0.439 | 0 | 196055280 | 668400144 | 359.7 | 142.7 | 2.2 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.231 | 7.13 | 7.953 | 0 | 7.95 / 4.2 | 7.461 | 7.677 | 0 | 0.208 | 0.54 | 0 | 196055280 | 668400144 | 356.5 | 131.7 | 2.2 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.217 | 7.991 | 9.282 | 0 | 8.28 / 4.51 | 8.728 | 9.282 | 0 | 0.201 | 0.457 | 0 | 196055280 | 668400144 | 353.4 | 151 | 2.3 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 9.001 | 12.896 | 0 | 0 | 9.185 | 12.089 | 0 | 13.9 |
| 128 MiB fixed | 1 | schedstat | 8.002 | 9.001 | 0 | 0 | 8.426 | 9.2 | 0 | 14 |
| 512 MiB fixed | 1 | schedstat | 7.001 | 8.897 | 0 | 0 | 6.754 | 8.447 | 0 | 11 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.999 | 8 | 0 | 0 | 7.105 | 9.616 | 0 | 10.9 |

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
