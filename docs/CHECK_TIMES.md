# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 202.6 s across 309 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:scenario-marble-bowl` | 22600 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:engine-state-hash-1024` | 20603 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-determinism` | 17049 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:engine-job-wait` | 13286 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:engine-tiers` | 11950 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:elevation-ab` | 8952 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:alloc-audit` | 5897 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:height-cpu` | 5820 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:pose-allocations` | 5213 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:vegetation-allocations` | 5100 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:sphere-population` | 4798 |  | Places the full sphere population and checks every member. |
| `check:app-watch` | 4584 |  | Waits on real file-watch events. |
| `check:engine-threads` | 3959 | yes | Runs the threaded scenario at several worker counts. |
| `check:scenario-allocations` | 3763 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:heightmap-cli` | 3325 |  | Runs the heightmap CLI once per fixture case. |
| `check:engine-release` | 2759 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:kaggle-regress` | 2265 |  | NO REASON RECORDED |
| `check:mapspinner-atmosphere` | 2120 |  | Integrates the atmosphere tables against spoint values. |
| `check:thread-sampler` | 2085 | yes | Samples real threads over a timed window. |
| `check:scenario-lockstep-rts` | 1925 | yes |  |
| `check:scenario-deathrun` | 1867 | yes |  |
| `check:own-display` | 1826 |  |  |
| `check:scenario-boss-fight` | 1607 | yes |  |
| `check:scenario-combat-bots` | 1434 | yes |  |
| `check:vegetation-generate-cost` | 1410 |  |  |
| `check:engine-footprint` | 1318 |  |  |
| `check:types` | 1156 |  |  |
| `check:gc-reuse-rows` | 1128 |  |  |
| `check:gc-witness` | 1125 |  |  |
| `check:scenario-projectile-volley` | 1073 | yes |  |
| `check:scenario-planet-landing` | 1013 | yes |  |
| `check:scenario-character-terrain` | 1010 | yes |  |
| `check:engine-host-witness` | 936 |  |  |
| `check:create-app` | 927 |  |  |
| `check:upload-writes` | 911 |  |  |
| `check:wireweave-relay` | 868 |  |  |
| `check:scenario-settle` | 833 | yes |  |
| `check:package-surface` | 830 |  |  |
| `check:planet-witness` | 820 |  |  |
| `check:upload-handler` | 787 |  |  |
| `check:crowd-dot-buffer` | 734 |  |  |
| `check:transport` | 733 |  |  |
| `check:planet-witness-scene` | 716 |  |  |
| `build:kernel` | 707 |  |  |
| `check:engine-awake-budget` | 693 |  |  |
| `check:engine-warm` | 614 |  |  |
| `check:socket-server` | 570 |  |  |
| `check:scenario-character` | 507 | yes |  |
| `check:engine-airborne` | 504 |  |  |
| `check:sharding` | 496 |  |  |
| `check:engine-pools` | 496 |  |  |
| `check:planet-scene-counts` | 462 |  |  |
| `check:engine-raycast` | 450 |  |  |
| `check:stall-attribution` | 382 |  |  |
| `check:ci-engine-glue` | 346 |  |  |
| `check:project-naming` | 338 |  |  |
| `check:collision-placement-options` | 317 |  |  |
| `check:engine-seal` | 316 |  |  |
| `check:engine-shapecast` | 306 |  |  |
| `check:terrain-agreement` | 279 |  |  |
| `check:vehicles-spoint` | 274 |  |  |
| `check:physics-integration-vehicles` | 274 |  |  |
| `check:sdk-surfaces` | 260 |  |  |
| `check:collision-mirror` | 255 |  |  |
| `check:packages` | 254 |  |  |
| `check:webgpu-profile` | 242 |  |  |
| `check:engine-world` | 235 |  |  |
| `check:collision-host` | 229 |  |  |
| `check:collision-tile-streamer` | 229 |  |  |
| `check:engine-vegetation` | 229 |  |  |
| `check:overlap-spoint` | 228 |  |  |
| `check:raycast-spoint` | 221 |  |  |
| `check:vehicle-remove-spoint` | 220 |  |  |
| `check:vehicle-refusal-spoint` | 213 |  |  |
| `check:dormant-spoint` | 207 |  |  |
| `check:dormant-budget-spoint` | 207 |  |  |
| `check:snapshots` | 205 |  |  |
| `check:chart-state-live` | 205 |  |  |
| `check:player-vat-spoint` | 200 |  |  |
| `check:player-lod-renderer` | 198 |  |  |
| `check:player-dot-material-spoint` | 190 |  |  |
| `check:site-world` | 186 |  |  |
| `check:player-dot-shader-spoint` | 185 |  |  |
| `check:pose-replay` | 185 |  |  |
| `check:fire` | 184 |  |  |
| `check:engine-materials` | 182 |  |  |
| `check:streaming-gltf-mesh` | 181 |  |  |
| `check:player-lod-renderer-webgpu` | 180 |  |  |
| `check:netcode` | 175 |  |  |
| `check:engine-planet` | 172 |  |  |
| `check:camera-relative` | 169 |  |  |
| `check:recast-bake-spoint` | 165 |  |  |
| `check:cluster-lod-spoint` | 161 |  |  |
| `check:engine-bridge` | 161 |  |  |
| `check:rebase-session` | 158 |  |  |
| `check:bloom-spoint` | 155 |  |  |
| `check:engine-sleep` | 155 |  |  |
| `check:upstream-builtin-nav` | 153 |  |  |
| `check:engine-leak` | 146 |  |  |
| `check:scene-setup-spoint` | 145 |  |  |
| `check:decode-path` | 143 |  |  |
| `check:fire-modules` | 141 |  |  |
| `check:terrain-pure` | 141 |  |  |
| `check:lockstep` | 141 |  |  |
| `check:streamer-p99` | 141 |  |  |
| `check:terrain-static` | 135 |  |  |
| `check:engine-codecs` | 135 |  |  |
| `check:timed-result` | 129 |  |  |
| `check:engine-budget-floor` | 127 |  |  |
| `check:sessions` | 125 |  |  |
| `check:ssr-spoint` | 124 |  |  |
| `check:engine-core` | 124 |  |  |
| `check:kernel` | 123 |  |  |
| `check:fsr1-spoint` | 123 |  |  |
| `check:vegetation-leaf-patches` | 123 |  |  |
| `check:engine-interest` | 123 |  |  |
| `check:chart-anchor` | 121 |  |  |
| `check:vat-spoint` | 121 |  |  |
| `check:socket-upgrade` | 121 |  |  |
| `check:tick-governor` | 113 | yes |  |
| `check:client-resource-pools` | 112 |  |  |
| `check:spline-erosion-witness` | 110 |  |  |
| `check:import-scene` | 110 |  |  |
| `check:bin-snapshot` | 108 |  |  |
| `check:sample-order` | 106 |  |  |
| `check:glue-tier` | 106 |  |  |
| `check:client-pure` | 101 |  |  |
| `check:procgen` | 99 |  |  |
| `check:snapshot-lod` | 93 |  |  |
| `check:follow-misuse` | 92 |  |  |
| `check:replay-file` | 91 |  |  |
| `check:spoint-core-rust` | 91 |  |  |
| `check:collider-streamer` | 90 |  |  |
| `check:behaviours` | 89 |  |  |
| `check:vegetation-stream` | 87 |  |  |
| `check:lag-compensation` | 86 |  |  |
| `check:tick-authority` | 84 |  |  |
| `check:prediction-engine` | 84 |  |  |
| `check:upstream-skill-registry` | 84 |  |  |
| `check:physics-pure` | 84 |  |  |
| `check:snapshot-packer` | 84 |  |  |
| `check:player-collisions` | 84 |  |  |
| `check:spawn` | 82 |  |  |
| `check:replay-player` | 82 |  |  |
| `check:msgpack-packer` | 81 |  |  |
| `check:protocol-codecs` | 80 |  |  |
| `check:lod-tiers` | 80 |  |  |
| `check:rollback` | 79 |  |  |
| `check:player-lod-plan` | 79 |  |  |
| `check:msgpackr-compat` | 78 |  |  |
| `check:hot-reload-spoint` | 78 |  |  |
| `check:netcode-small` | 77 |  |  |
| `check:client-message-handler` | 77 |  |  |
| `check:animation-control` | 76 |  |  |
| `check:upstream-skill-bodies` | 74 |  |  |
| `check:pathfinding` | 72 |  |  |
| `check:sdk-misc` | 71 |  |  |
| `check:replay-dialect` | 71 |  |  |
| `check:negative-zero` | 71 |  |  |
| `check:game-systems` | 70 |  |  |
| `check:hygiene` | 70 |  |  |
| `check:behaviour-health-destructible` | 68 |  |  |
| `check:cluster-handoff` | 68 |  |  |
| `check:chart-reanchor` | 68 |  |  |
| `check:shared-pure` | 68 |  |  |
| `check:reduced-pose` | 68 |  |  |
| `check:frame-stall-cause` | 67 |  |  |
| `check:octree` | 66 |  |  |
| `check:aoi` | 66 |  |  |
| `check:upload-route` | 66 |  |  |
| `check:streaming-gltf-queues` | 65 |  |  |
| `check:behaviours-c` | 65 |  |  |
| `check:client-machines` | 65 |  |  |
| `check:mat4-spoint` | 65 |  |  |
| `check:engine-render` | 65 |  |  |
| `check:snapshot-processor` | 64 |  |  |
| `check:apps-a` | 64 |  |  |
| `check:client-pure-rows` | 64 |  |  |
| `check:wireweave-frame-spoint` | 63 |  |  |
| `check:controlled-run` | 63 |  |  |
| `check:world-persistence` | 62 |  |  |
| `check:apps-b` | 62 |  |  |
| `check:chart-migrators` | 62 |  |  |
| `check:anticheat-spoint` | 61 |  |  |
| `check:game-systems-spoint` | 61 |  |  |
| `check:paint-store` | 60 |  |  |
| `check:stage` | 60 |  |  |
| `check:event-log` | 60 |  |  |
| `check:sdk-editor` | 60 |  |  |
| `check:app-loader` | 60 |  |  |
| `check:protocol` | 59 |  |  |
| `check:world-config` | 59 |  |  |
| `check:client-tier-split` | 59 |  |  |
| `check:frequency-runs` | 59 |  |  |
| `check:world` | 58 |  |  |
| `check:clusters` | 58 |  |  |
| `check:row16-client-decoder` | 58 |  |  |
| `check:chart-transfer` | 58 |  |  |
| `check:behaviours-a` | 58 |  |  |
| `check:chart-state-server` | 58 |  |  |
| `check:bundle-freshness-jayzee` | 57 |  |  |
| `check:telemetry` | 57 |  |  |
| `check:upstream-door-routes` | 57 |  |  |
| `check:physics-integration` | 57 |  |  |
| `check:cluster-slice` | 57 |  |  |
| `check:engine-artifacts` | 57 |  |  |
| `check:client-loops` | 56 |  |  |
| `check:consensus` | 56 |  |  |
| `check:spawn-named-errors` | 55 |  |  |
| `check:render` | 55 |  |  |
| `check:feature-gap` | 55 |  |  |
| `check:physics-extras` | 55 |  |  |
| `check:upstream-builtin-bodies` | 55 |  |  |
| `check:upstream-builtin-noise` | 55 |  |  |
| `check:behaviours-b` | 55 |  |  |
| `check:sampler-gap-attribution` | 55 |  |  |
| `check:upstream-tome-bodies` | 54 |  |  |
| `check:editor-serialize` | 54 |  |  |
| `check:material-tier-swap-spoint` | 54 |  |  |
| `check:paired-report` | 54 |  |  |
| `check:sandbox` | 53 |  |  |
| `check:world-query` | 53 |  |  |
| `check:upstream-builtin-env` | 53 |  |  |
| `check:app-behaviours` | 53 |  |  |
| `check:app-runtime-state` | 53 |  |  |
| `check:upstream-endpoints` | 52 |  |  |
| `check:navmesh-query-spoint` | 52 |  |  |
| `check:stall-probe` | 52 |  |  |
| `check:upstream-builtin-easing` | 51 |  |  |
| `check:ccd` | 51 |  |  |
| `check:upstream-builtin-voxels` | 51 |  |  |
| `check:pool-params-spoint` | 51 |  |  |
| `check:relative-residuals` | 51 |  |  |
| `check:site` | 50 |  |  |
| `check:upstream-tome-lookup` | 50 |  |  |
| `check:upstream-reference` | 50 |  |  |
| `check:camera-rig` | 50 |  |  |
| `check:upstream-builtins` | 49 |  |  |
| `check:script-limits` | 49 |  |  |
| `check:upstream-builtin-physics` | 49 |  |  |
| `check:upstream-builtin-room-routing` | 49 |  |  |
| `check:blend-tree-spoint` | 49 |  |  |
| `check:client-pure-spoint` | 49 |  |  |
| `check:spawn-captured-names` | 49 |  |  |
| `check:asset-pipeline` | 49 |  |  |
| `check:stall-off-cpu` | 49 |  |  |
| `check:engine-visibility` | 49 |  |  |
| `check:rollback-bridge` | 48 |  |  |
| `check:upstream-builtin-lighting` | 48 |  |  |
| `check:world-def-clusters` | 48 |  |  |
| `check:entity-host` | 48 |  |  |
| `check:minidump` | 48 |  |  |
| `check:upstream-door-dispatch` | 47 |  |  |
| `check:upstream-skills` | 47 |  |  |
| `check:upstream-builtin-math` | 47 |  |  |
| `check:upstream-builtin-tween` | 47 |  |  |
| `check:world-resolver` | 47 |  |  |
| `check:render-1024-visible` | 47 |  |  |
| `check:collider-layers` | 47 |  |  |
| `check:collision-placement` | 47 |  |  |
| `check:anticheat` | 46 |  |  |
| `check:upstream-builtin-vec3` | 46 |  |  |
| `check:upstream-builtin-ballistics` | 46 |  |  |
| `check:upstream-builtin-path` | 46 |  |  |
| `check:upstream-builtin-spline` | 46 |  |  |
| `check:upstream-builtin-three` | 46 |  |  |
| `check:vec3-read` | 46 |  |  |
| `check:network-state` | 46 |  |  |
| `check:crowd-dot-cells-spoint` | 46 |  |  |
| `check:tail-report` | 46 |  |  |
| `check:messages` | 45 |  |  |
| `check:transport-framing` | 45 |  |  |
| `check:hot-reload` | 45 |  |  |
| `check:rollback-peer` | 45 |  |  |
| `check:named-asset-redirect` | 45 |  |  |
| `check:upstream-builtin-fx` | 45 |  |  |
| `check:upstream-builtin-tsl` | 45 |  |  |
| `check:upstream-builtin-vibe` | 45 |  |  |
| `check:upstream-builtin-water` | 45 |  |  |
| `check:reexpress-records` | 45 |  |  |
| `check:component-pool` | 45 |  |  |
| `check:spawn-captured-bodies` | 45 |  |  |
| `check:engine-solver-tier` | 45 |  |  |
| `check:planet-gap-class` | 45 |  |  |
| `check:animation` | 44 |  |  |
| `check:tick-order` | 44 |  |  |
| `check:tick-scheduler` | 44 |  |  |
| `check:upstream-builtin-terrain` | 44 |  |  |
| `check:player-id` | 44 |  |  |
| `check:postfx-shaders-spoint` | 44 |  |  |
| `check:browser-heap` | 44 |  |  |
| `check:chromium-launcher` | 44 |  |  |
| `check:character-step` | 43 |  |  |
| `check:movement` | 43 |  |  |
| `check:relocation-solve` | 43 |  |  |
| `check:upstream-doors` | 43 |  |  |
| `check:hook-order` | 43 |  |  |
| `check:cube-sphere-cell-key-spoint` | 43 |  |  |
| `check:content` | 42 |  |  |
| `check:jolt-limits` | 42 |  |  |
| `check:upstream-tome` | 42 |  |  |
| `check:heightfield-physics` | 42 |  |  |
| `check:upstream-builtin-postfx` | 42 |  |  |
| `check:vehicle-tuning` | 41 |  |  |
| `check:worker-dispatch` | 41 |  |  |
| `check:engine-isolation` | 41 |  |  |
| `check:constraint-limits` | 39 |  |  |
| `check:flight-model` | 38 |  |  |
| `check:worker-bridge` | 37 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 53. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-12T14:16:11.595Z. Queue wait 7 s from the push to the first line of the script. Run time 501 s for 55 of 55 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.437 | 11.176 | 20.459 | 1 | 10.44 / 6.13 | 15.088 | 20.459 | 1 | 6.484 | 11.061 | 0 | 278230008 | 668400144 | 449.5 | 184.9 | 8.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.355 | 12.377 | 16.361 | 0 | 10.38 / 6.61 | 13.804 | 16.361 | 0 | 6.407 | 10.659 | 0 | 268416056 | 668400144 | 461.9 | 185.3 | 8 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.738 | 14.441 | 33.224 | 3 | 8.96 / 4.22 | 10.552 | 11.308 | 0 | 7.404 | 14.964 | 3 | 278230008 | 668400144 | 442.9 | 208.7 | 8.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.159 | 15.25 | 18.703 | 4 | 7.99 / 4.32 | 10.176 | 11.932 | 0 | 8.912 | 16.186 | 4 | 268416056 | 668400144 | 432.6 | 175.9 | 9.2 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.045 | 13.215 | 17.234 | 2 | 9.05 / 5.93 | 10.295 | 11.786 | 0 | 8.932 | 14.327 | 2 | 278230008 | 668400144 | 466.6 | 199.4 | 9.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.767 | 13.165 | 18.206 | 3 | 10 / 6.17 | 12.22 | 13.31 | 0 | 7.072 | 13.557 | 3 | 268416056 | 668400144 | 427.1 | 181.1 | 8.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.85 | 12.822 | 15.788 | 0 | 8.21 / 4.39 | 14.47 | 15.788 | 0 | 6.671 | 9.789 | 0 | 278230008 | 668400144 | 485.4 | 189.5 | 8.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.54 | 10.734 | 11.85 | 0 | 7.14 / 4.25 | 10.397 | 11.116 | 0 | 6.645 | 10.766 | 0 | 268416056 | 668400144 | 440.9 | 208.9 | 8.3 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.498 | 14.815 | 27.382 | 3 | 10.89 / 6.29 | 17.527 | 27.382 | 3 | 6.42 | 10.377 | 0 | 278230008 | 668400144 | 445.4 | 195.3 | 8.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.692 | 14.583 | 16.478 | 0 | 9.8 / 6.58 | 9.344 | 10.682 | 0 | 6.867 | 14.765 | 0 | 268416056 | 668400144 | 476.5 | 338.1 | 8.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.271 | 12.08 | 15.095 | 0 | 7.73 / 4.36 | 13.33 | 15.095 | 0 | 6.269 | 10.732 | 0 | 268416056 | 668400144 | 444.9 | 257.4 | 8.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.779 | 9.615 | 14.252 | 0 | 7 / 3.95 | 7.666 | 8.545 | 0 | 5.893 | 10.215 | 0 | 268396936 | 668400144 | 412.6 | 176.1 | 7.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.03 | 11.18 | 13.972 | 0 | 7.62 / 4.12 | 8.5 | 8.649 | 0 | 6.135 | 11.616 | 0 | 268416056 | 668400144 | 422.7 | 261.8 | 7.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.773 | 9.962 | 11.291 | 0 | 7.19 / 4.12 | 8.23 | 8.731 | 0 | 5.91 | 10.059 | 0 | 268396936 | 668400144 | 405.6 | 178.4 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.277 | 13.378 | 18.94 | 4 | 8.73 / 5.86 | 17.438 | 18.94 | 4 | 6.344 | 11.01 | 0 | 268416056 | 668400144 | 441.2 | 178.8 | 8.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.981 | 10.294 | 16.426 | 0 | 9.01 / 5.93 | 9.703 | 9.765 | 0 | 6.011 | 10.602 | 0 | 268396936 | 668400144 | 425.1 | 183.8 | 7.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.257 | 11.455 | 14.272 | 0 | 7.1 / 4.09 | 10.908 | 13.083 | 0 | 6.283 | 12.36 | 0 | 268416056 | 668400144 | 430 | 173 | 7.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.276 | 12.195 | 16.554 | 0 | 9.17 / 6.09 | 11.862 | 12.949 | 0 | 6.129 | 12.544 | 0 | 268396936 | 668400144 | 452.1 | 194.5 | 8.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.119 | 8.82 | 14.832 | 0 | 7.06 / 4.05 | 8.556 | 9.014 | 0 | 6.237 | 9.023 | 0 | 268416056 | 668400144 | 420.4 | 213.4 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.864 | 10.493 | 12.428 | 0 | 7.2 / 4.02 | 11.113 | 12.428 | 0 | 5.923 | 8.309 | 0 | 268396936 | 668400144 | 431.4 | 178 | 7.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.002 | 9.713 | 16.23 | 0 | 7.39 / 4.11 | 8.71 | 9.573 | 0 | 6.088 | 10.232 | 0 | 268416056 | 668400144 | 414.3 | 191.9 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.813 | 10.098 | 13.743 | 0 | 7.22 / 4.04 | 7.116 | 7.907 | 0 | 5.91 | 10.68 | 0 | 268396936 | 668400144 | 405 | 168.4 | 7.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.225 | 8.957 | 11.181 | 0 | 7.12 / 4.07 | 10.08 | 10.695 | 0 | 6.394 | 8.957 | 0 | 268416056 | 668400144 | 439.7 | 174 | 7.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.774 | 9.482 | 12.38 | 0 | 7.28 / 4.19 | 11.585 | 12.38 | 0 | 5.741 | 7.011 | 0 | 268396936 | 668400144 | 421.9 | 177.5 | 7.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.035 | 10.48 | 14.264 | 0 | 7.17 / 4.03 | 8.512 | 8.971 | 0 | 6.215 | 10.538 | 0 | 268416056 | 668400144 | 420.9 | 173.2 | 7.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.797 | 9.866 | 15.12 | 0 | 7.11 / 4 | 7.556 | 7.956 | 0 | 5.924 | 10.251 | 0 | 268396936 | 668400144 | 418.9 | 201.2 | 7.2 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 11.154 | 16.631 | 26.602 | 8 | 8.62 / 5.52 | 14.59 | 18.739 | 1 | 11.62 | 17.056 | 7 | 268415992 | 668203536 | 411.3 | 170.6 | 12.1 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 7.617 | 11.757 | 17.039 | 1 | 8.07 / 4.79 | 10.212 | 11.251 | 0 | 7.762 | 12.676 | 1 | 268416056 | 668269072 | 447 | 171.2 | 8.9 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 6.71 | 9.071 | 11.162 | 0 | 7.67 / 4.51 | 9.076 | 10.445 | 0 | 6.815 | 9.071 | 0 | 268416056 | 668334608 | 433.2 | 170.8 | 8 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 5.976 | 8.673 | 10.361 | 0 | 6.93 / 3.92 | 8.414 | 9.783 | 0 | 6.126 | 8.882 | 0 | 268416120 | 668531216 | 444.4 | 179.4 | 7.5 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 7.555 | 13.062 | 20.696 | 2 | 7.79 / 4.58 | 16.678 | 20.696 | 2 | 7.631 | 10.397 | 0 | 268416056 | 668400144 | 488.2 | 179.2 | 9 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.179 | 10.91 | 25.931 | 1 | 25.93 / 9.04 | 12.28 | 15.923 | 0 | 6.311 | 10.871 | 0 | 268416056 | 668400144 |  | 118.4 | 7.2 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.048 | 5.469 | 7.144 | 0 | 4.65 / 3.22 | 5.913 | 7.144 | 0 | 0.047 | 0.111 | 0 | 182090308 | 668400144 | 429.2 | 180.5 | 1.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 5.956 | 9.517 | 15.702 | 0 | 7.41 / 4.21 | 8.247 | 10.334 | 0 | 5.986 | 9.59 | 0 | 395814464 | 668400144 | 424.8 | 190.6 | 18.3 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.977 | 6.864 | 9.46 | 0 | 4.83 / 3.27 | 6.726 | 7.7 | 0 | 5.032 | 7.122 | 0 | 209620160 | 668400144 | 428.7 | 168.8 | 4.9 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.869 | 8.899 | 14.356 | 0 | 5.04 / 3.51 | 11.105 | 14.356 | 0 | 4.867 | 6.682 | 0 | 209770976 | 668400144 | 433.6 | 192.3 | 5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.065 | 7.029 | 11.327 | 0 | 4.94 / 3.14 | 7.378 | 9.599 | 0 | 5.119 | 6.663 | 0 | 209574512 | 668400144 | 430.2 | 170.3 | 5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 4.846 | 9.222 | 11.813 | 0 | 4.94 / 3.25 | 10.044 | 11.813 | 0 | 4.818 | 6.241 | 0 | 209731504 | 668400144 | 452.2 | 167.9 | 5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.474 | 13.504 | 17.322 | 1 | 11.19 / 5.9 | 10.771 | 11.468 | 0 | 7.657 | 14.342 | 1 | 268432440 | 668400144 | 514.8 | 174.2 | 9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.403 | 12.095 | 17.103 | 2 | 10.3 / 5.96 | 10.329 | 12.095 | 0 | 7.514 | 13.01 | 2 | 268432440 | 668400144 | 516.4 | 176.5 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.45 | 12.402 | 18.155 | 2 | 9.66 / 5.46 | 10.438 | 12.627 | 0 | 7.57 | 13.345 | 2 | 268432440 | 668400144 | 527.5 | 185.9 | 8.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.238 | 9.315 | 12.973 | 0 | 10.23 / 5.4 | 9.44 | 12.973 | 0 | 7.367 | 9.295 | 0 | 268432440 | 668400144 | 516.2 | 202.4 | 8.6 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.159 | 9.725 | 16.442 | 0 | 9.56 / 5.87 | 10.204 | 11.458 | 0 | 7.22 | 9.579 | 0 | 268432440 | 668400144 | 566.9 | 299.8 | 8.7 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.324 | 11.884 | 14.725 | 0 | 9.47 / 5.5 | 13.103 | 14.725 | 0 | 7.387 | 9.822 | 0 | 268432440 | 668400144 | 523.2 | 192.7 | 8.8 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.054 | 7.184 | 9.19 | 0 | 7.17 / 4.73 | 8.072 | 9.19 | 0 | 0.052 | 0.152 | 0 | 182106692 | 668400144 | 531.5 | 174.2 | 2.4 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.054 | 7.171 | 11.84 | 0 | 11.84 / 9.6 | 7.656 | 8.874 | 0 | 0.052 | 0.104 | 0 | 182106692 | 668400144 | 548.4 | 186 | 2.4 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.055 | 7.313 | 9.863 | 0 | 7.08 / 4.45 | 8.891 | 9.863 | 0 | 0.053 | 0.121 | 0 | 182106692 | 668400144 | 508 | 183.1 | 2.4 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 13.257 | 17.836 | 2 | 0 | 13.966 | 17.877 | 3 | 21.5 |
| 128 MiB fixed | 1 | schedstat | 12.744 | 16.6 | 0 | 0 | 13.165 | 16.892 | 1 | 21.3 |
| 512 MiB fixed | 1 | schedstat | 11.686 | 14.541 | 0 | 0 | 11.476 | 17.425 | 1 | 16.7 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 8.067 | 9.762 | 0 | 0 | 8.687 | 11.872 | 0 | 13.9 |

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
