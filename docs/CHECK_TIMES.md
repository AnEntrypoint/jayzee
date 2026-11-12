# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 180.9 s across 307 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:engine-state-hash-1024` | 14477 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-determinism` | 14463 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:scenario-marble-bowl` | 14266 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:gc-witness` | 11971 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:engine-tiers` | 10165 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:engine-job-wait` | 7308 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:elevation-ab` | 6591 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:pose-allocations` | 5168 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:app-watch` | 4576 |  | Waits on real file-watch events. |
| `check:height-cpu` | 4210 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:alloc-audit` | 4136 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:sphere-population` | 4101 |  | Places the full sphere population and checks every member. |
| `check:engine-release` | 3419 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:vegetation-allocations` | 3400 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:heightmap-cli` | 2896 |  | Runs the heightmap CLI once per fixture case. |
| `check:scenario-lockstep-rts` | 2790 | yes | Six peers per tier on four tiers. |
| `check:scenario-deathrun` | 2767 | yes | Six runs per tier on four tiers. |
| `check:scenario-boss-fight` | 2602 | yes | Six runs per tier on four tiers. |
| `check:scenario-combat-bots` | 2445 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:scenario-allocations` | 2089 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:engine-threads` | 2055 | yes | Runs the threaded scenario at several worker counts. |
| `check:thread-sampler` | 2046 | yes | Samples real threads over a timed window. |
| `check:vegetation-generate-cost` | 1909 |  |  |
| `check:own-display` | 1837 |  |  |
| `check:mapspinner-atmosphere` | 1765 |  |  |
| `check:scenario-character-terrain` | 1523 | yes |  |
| `check:snapshots` | 1462 |  |  |
| `check:planet-witness-scene` | 1447 |  |  |
| `check:scenario-projectile-volley` | 1223 | yes |  |
| `check:scenario-settle` | 1110 | yes |  |
| `check:scenario-planet-landing` | 1089 | yes |  |
| `check:types` | 1045 |  |  |
| `check:engine-raycast` | 1019 |  |  |
| `check:engine-shapecast` | 981 |  |  |
| `check:gc-reuse-rows` | 965 |  |  |
| `check:engine-seal` | 959 |  |  |
| `check:planet-scene-counts` | 958 |  |  |
| `check:scenario-character` | 892 | yes |  |
| `check:wireweave-relay` | 830 |  |  |
| `check:engine-host-witness` | 812 |  |  |
| `check:upload-writes` | 790 |  |  |
| `check:create-app` | 774 |  |  |
| `check:netcode` | 756 |  |  |
| `check:upload-handler` | 692 |  |  |
| `check:engine-awake-budget` | 668 |  |  |
| `check:crowd-dot-buffer` | 656 |  |  |
| `check:terrain-agreement` | 606 |  |  |
| `check:pose-replay` | 605 |  |  |
| `build:kernel` | 591 |  |  |
| `check:transport` | 567 |  |  |
| `check:planet-witness` | 553 |  |  |
| `check:engine-warm` | 528 |  |  |
| `check:socket-server` | 459 |  |  |
| `check:engine-airborne` | 451 |  |  |
| `check:engine-pools` | 410 |  |  |
| `check:ci-engine-glue` | 373 |  |  |
| `check:stall-attribution` | 356 |  |  |
| `check:project-naming` | 314 |  |  |
| `check:physics-pure` | 305 |  |  |
| `check:sharding` | 294 |  |  |
| `check:kernel` | 292 |  |  |
| `check:engine-world` | 290 |  |  |
| `check:engine-materials` | 280 |  |  |
| `check:engine-vegetation` | 279 |  |  |
| `check:collision-placement-options` | 278 |  |  |
| `check:world-config` | 259 |  |  |
| `check:world-query` | 258 |  |  |
| `check:world` | 253 |  |  |
| `check:ccd` | 247 |  |  |
| `check:physics-integration-vehicles` | 232 |  |  |
| `check:packages` | 220 |  |  |
| `check:webgpu-profile` | 214 |  |  |
| `check:collision-mirror` | 213 |  |  |
| `check:vehicles-spoint` | 207 |  |  |
| `check:sdk-surfaces` | 203 |  |  |
| `check:collision-tile-streamer` | 195 |  |  |
| `check:engine-planet` | 192 |  |  |
| `check:player-vat-spoint` | 189 |  |  |
| `check:site-world` | 187 |  |  |
| `check:raycast-spoint` | 187 |  |  |
| `check:dormant-budget-spoint` | 186 |  |  |
| `check:engine-budget-floor` | 186 |  |  |
| `check:dormant-spoint` | 185 |  |  |
| `check:engine-bridge` | 184 |  |  |
| `check:overlap-spoint` | 183 |  |  |
| `check:collision-host` | 182 |  |  |
| `check:vehicle-refusal-spoint` | 182 |  |  |
| `check:vehicle-remove-spoint` | 178 |  |  |
| `check:chart-state-live` | 175 |  |  |
| `check:fire` | 168 |  |  |
| `check:player-lod-renderer` | 168 |  |  |
| `check:recast-bake-spoint` | 167 |  |  |
| `check:engine-sleep` | 163 |  |  |
| `check:rebase-session` | 158 |  |  |
| `check:player-lod-renderer-webgpu` | 156 |  |  |
| `check:bloom-spoint` | 153 |  |  |
| `check:decode-path` | 153 |  |  |
| `check:player-dot-shader-spoint` | 152 |  |  |
| `check:player-dot-material-spoint` | 151 |  |  |
| `check:camera-relative` | 147 |  |  |
| `check:streaming-gltf-mesh` | 140 |  |  |
| `check:scene-setup-spoint` | 134 |  |  |
| `check:engine-leak` | 134 |  |  |
| `check:streamer-p99` | 132 |  |  |
| `check:terrain-static` | 128 |  |  |
| `check:fire-modules` | 127 |  |  |
| `check:cluster-lod-spoint` | 127 |  |  |
| `check:vegetation-leaf-patches` | 124 |  |  |
| `check:upstream-builtin-nav` | 122 |  |  |
| `check:terrain-pure` | 118 |  |  |
| `check:kaggle-regress` | 116 |  |  |
| `check:sample-order` | 112 |  |  |
| `check:vat-spoint` | 109 |  |  |
| `check:engine-interest` | 109 |  |  |
| `check:lockstep` | 108 |  |  |
| `check:engine-codecs` | 108 |  |  |
| `check:timed-result` | 106 |  |  |
| `check:engine-core` | 103 |  |  |
| `check:follow-misuse` | 100 |  |  |
| `check:spline-erosion-witness` | 98 |  |  |
| `check:ssr-spoint` | 98 |  |  |
| `check:fsr1-spoint` | 97 |  |  |
| `check:glue-tier` | 97 |  |  |
| `check:sessions` | 93 |  |  |
| `check:script-limits` | 93 |  |  |
| `check:socket-upgrade` | 93 |  |  |
| `check:bin-snapshot` | 90 |  |  |
| `check:chart-anchor` | 89 |  |  |
| `check:procgen` | 84 |  |  |
| `check:import-scene` | 84 |  |  |
| `check:client-resource-pools` | 84 |  |  |
| `check:client-pure` | 83 |  |  |
| `check:upstream-skill-registry` | 79 |  |  |
| `check:lag-compensation` | 78 |  |  |
| `check:spoint-core-rust` | 78 |  |  |
| `check:replay-file` | 77 |  |  |
| `check:replay-player` | 76 |  |  |
| `check:player-collisions` | 76 |  |  |
| `check:tick-governor` | 73 | yes |  |
| `check:frame-stall-cause` | 72 |  |  |
| `check:behaviours` | 71 |  |  |
| `check:msgpack-packer` | 71 |  |  |
| `check:vegetation-stream` | 71 |  |  |
| `check:lod-tiers` | 69 |  |  |
| `check:spawn` | 68 |  |  |
| `check:collider-streamer` | 68 |  |  |
| `check:chart-reanchor` | 67 |  |  |
| `check:client-message-handler` | 67 |  |  |
| `check:prediction-engine` | 66 |  |  |
| `check:engine-render` | 66 |  |  |
| `check:snapshot-lod` | 65 |  |  |
| `check:netcode-small` | 65 |  |  |
| `check:player-lod-plan` | 65 |  |  |
| `check:controlled-run` | 65 |  |  |
| `check:protocol` | 64 |  |  |
| `check:streaming-gltf-queues` | 64 |  |  |
| `check:hot-reload-spoint` | 64 |  |  |
| `check:protocol-codecs` | 63 |  |  |
| `check:chart-migrators` | 63 |  |  |
| `check:entity-host` | 63 |  |  |
| `check:snapshot-packer` | 62 |  |  |
| `check:wireweave-frame-spoint` | 62 |  |  |
| `check:rollback` | 61 |  |  |
| `check:sdk-misc` | 61 |  |  |
| `check:game-systems` | 60 |  |  |
| `check:behaviour-health-destructible` | 60 |  |  |
| `check:animation-control` | 60 |  |  |
| `check:upstream-skill-bodies` | 60 |  |  |
| `check:behaviours-c` | 60 |  |  |
| `check:upload-route` | 60 |  |  |
| `check:replay-dialect` | 60 |  |  |
| `check:hygiene` | 60 |  |  |
| `check:msgpackr-compat` | 59 |  |  |
| `check:cluster-handoff` | 59 |  |  |
| `check:shared-pure` | 59 |  |  |
| `check:pathfinding` | 58 |  |  |
| `check:negative-zero` | 58 |  |  |
| `check:world-persistence` | 57 |  |  |
| `check:telemetry` | 57 |  |  |
| `check:reduced-pose` | 57 |  |  |
| `check:engine-artifacts` | 57 |  |  |
| `check:paint-store` | 56 |  |  |
| `check:octree` | 56 |  |  |
| `check:aoi` | 56 |  |  |
| `check:event-log` | 56 |  |  |
| `check:apps-a` | 56 |  |  |
| `check:client-machines` | 56 |  |  |
| `check:app-loader` | 56 |  |  |
| `check:mat4-spoint` | 56 |  |  |
| `check:sdk-editor` | 55 |  |  |
| `check:paired-report` | 55 |  |  |
| `check:frequency-runs` | 55 |  |  |
| `check:snapshot-processor` | 54 |  |  |
| `check:upstream-builtin-noise` | 54 |  |  |
| `check:chart-state-server` | 54 |  |  |
| `check:game-systems-spoint` | 54 |  |  |
| `check:collision-placement` | 54 |  |  |
| `check:stage` | 53 |  |  |
| `check:tick-authority` | 53 |  |  |
| `check:client-pure-rows` | 53 |  |  |
| `check:cluster-slice` | 53 |  |  |
| `check:render` | 52 |  |  |
| `check:upstream-door-routes` | 52 |  |  |
| `check:upstream-builtin-water` | 52 |  |  |
| `check:behaviours-a` | 52 |  |  |
| `check:apps-b` | 52 |  |  |
| `check:client-tier-split` | 52 |  |  |
| `check:upstream-builtin-bodies` | 51 |  |  |
| `check:row16-client-decoder` | 50 |  |  |
| `check:chart-transfer` | 50 |  |  |
| `check:upstream-tome-bodies` | 50 |  |  |
| `check:upstream-builtin-physics` | 50 |  |  |
| `check:app-behaviours` | 50 |  |  |
| `check:upstream-builtin-lighting` | 49 |  |  |
| `check:behaviours-b` | 49 |  |  |
| `check:editor-serialize` | 49 |  |  |
| `check:physics-integration` | 49 |  |  |
| `check:spawn-named-errors` | 48 |  |  |
| `check:client-loops` | 48 |  |  |
| `check:feature-gap` | 48 |  |  |
| `check:bundle-freshness-jayzee` | 48 |  |  |
| `check:rollback-bridge` | 48 |  |  |
| `check:clusters` | 48 |  |  |
| `check:material-tier-swap-spoint` | 48 |  |  |
| `check:asset-pipeline` | 48 |  |  |
| `check:planet-gap-class` | 48 |  |  |
| `check:sandbox` | 47 |  |  |
| `check:upstream-endpoints` | 47 |  |  |
| `check:transport-framing` | 47 |  |  |
| `check:anticheat-spoint` | 47 |  |  |
| `check:animation` | 47 |  |  |
| `check:physics-extras` | 47 |  |  |
| `check:consensus` | 47 |  |  |
| `check:navmesh-query-spoint` | 47 |  |  |
| `check:stall-probe` | 47 |  |  |
| `check:site` | 46 |  |  |
| `check:upstream-builtin-easing` | 46 |  |  |
| `check:upstream-builtin-room-routing` | 46 |  |  |
| `check:network-state` | 46 |  |  |
| `check:camera-rig` | 46 |  |  |
| `check:stall-off-cpu` | 46 |  |  |
| `check:rollback-peer` | 45 |  |  |
| `check:upstream-door-dispatch` | 45 |  |  |
| `check:upstream-builtin-env` | 45 |  |  |
| `check:app-runtime-state` | 45 |  |  |
| `check:player-id` | 45 |  |  |
| `check:world-def-clusters` | 45 |  |  |
| `check:upstream-builtins` | 44 |  |  |
| `check:upstream-builtin-path` | 44 |  |  |
| `check:sampler-gap-attribution` | 44 |  |  |
| `check:minidump` | 44 |  |  |
| `check:engine-visibility` | 44 |  |  |
| `check:engine-solver-tier` | 44 |  |  |
| `check:relative-residuals` | 44 |  |  |
| `check:engine-isolation` | 44 |  |  |
| `check:tick-scheduler` | 43 |  |  |
| `check:heightfield-physics` | 43 |  |  |
| `check:upstream-builtin-three` | 43 |  |  |
| `check:upstream-builtin-tsl` | 43 |  |  |
| `check:vec3-read` | 43 |  |  |
| `check:world-resolver` | 43 |  |  |
| `check:tail-report` | 43 |  |  |
| `check:flight-model` | 42 |  |  |
| `check:upstream-tome-lookup` | 42 |  |  |
| `check:upstream-reference` | 42 |  |  |
| `check:hook-order` | 42 |  |  |
| `check:upstream-builtin-postfx` | 42 |  |  |
| `check:upstream-builtin-terrain` | 42 |  |  |
| `check:upstream-builtin-voxels` | 42 |  |  |
| `check:crowd-dot-cells-spoint` | 42 |  |  |
| `check:blend-tree-spoint` | 42 |  |  |
| `check:client-pure-spoint` | 42 |  |  |
| `check:spawn-captured-names` | 42 |  |  |
| `check:spawn-captured-bodies` | 42 |  |  |
| `check:pool-params-spoint` | 42 |  |  |
| `check:content` | 41 |  |  |
| `check:upstream-tome` | 41 |  |  |
| `check:upstream-builtin-tween` | 41 |  |  |
| `check:reexpress-records` | 41 |  |  |
| `check:hot-reload` | 40 |  |  |
| `check:anticheat` | 40 |  |  |
| `check:character-step` | 40 |  |  |
| `check:constraint-limits` | 40 |  |  |
| `check:jolt-limits` | 40 |  |  |
| `check:tick-order` | 40 |  |  |
| `check:relocation-solve` | 40 |  |  |
| `check:upstream-builtin-math` | 40 |  |  |
| `check:upstream-builtin-vec3` | 40 |  |  |
| `check:component-pool` | 40 |  |  |
| `check:postfx-shaders-spoint` | 40 |  |  |
| `check:chromium-launcher` | 40 |  |  |
| `check:upstream-doors` | 39 |  |  |
| `check:named-asset-redirect` | 39 |  |  |
| `check:upstream-builtin-ballistics` | 39 |  |  |
| `check:upstream-builtin-fx` | 39 |  |  |
| `check:upstream-builtin-vibe` | 39 |  |  |
| `check:cube-sphere-cell-key-spoint` | 39 |  |  |
| `check:browser-heap` | 39 |  |  |
| `check:worker-dispatch` | 38 |  |  |
| `check:upstream-skills` | 38 |  |  |
| `check:upstream-builtin-spline` | 38 |  |  |
| `check:collider-layers` | 38 |  |  |
| `check:render-1024-visible` | 37 |  |  |
| `check:messages` | 36 |  |  |
| `check:movement` | 36 |  |  |
| `check:vehicle-tuning` | 35 |  |  |
| `check:worker-bridge` | 35 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 41. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-12T06:32:48.528Z. Queue wait 13 s from the push to the first line of the script. Run time 919.3 s for 90 of 90 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.841 | 13.949 | 16.28 | 0 | 8.56 / 6.07 | 15.023 | 16.28 | 0 | 8.784 | 11.696 | 0 | 278248248 | 668400144 | 1374.8 | 1138.8 | 12 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.276 | 10.586 | 12.258 | 0 | 7.76 / 4.2 | 10.222 | 12.024 | 0 | 7.548 | 10.628 | 0 | 278248248 | 668400144 | 1203.3 | 1119.5 | 10.3 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.522 | 11.77 | 25.927 | 1 | 9.34 / 5.72 | 12.007 | 25.927 | 1 | 8.69 | 11.77 | 0 | 278248248 | 668400144 | 1238.1 | 1165.8 | 11.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.194 | 13.165 | 20.396 | 4 | 7.56 / 4.19 | 12.406 | 15.286 | 0 | 7.314 | 14.041 | 4 | 278248248 | 668400144 | 1200.2 | 1085.3 | 10.3 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.552 | 13.48 | 18.271 | 1 | 8.39 / 5.26 | 12.443 | 12.878 | 0 | 8.664 | 15.142 | 1 | 278248248 | 668400144 | 1271.6 | 1075.6 | 11.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.007 | 11.92 | 20.506 | 2 | 7.34 / 4.23 | 10.065 | 11.407 | 0 | 7.057 | 14.329 | 2 | 278248248 | 668400144 | 1184.5 | 1129.7 | 10.2 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.433 | 14.089 | 22.424 | 4 | 12.46 / 7.07 | 11.692 | 14.845 | 0 | 8.623 | 15.136 | 4 | 278248248 | 668400144 | 1157.1 | 1072.4 | 11.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.262 | 13.213 | 20.386 | 1 | 7.32 / 4.29 | 11.016 | 11.707 | 0 | 7.377 | 13.861 | 1 | 278248248 | 668400144 | 1265.5 | 1114.9 | 10.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 9.038 | 15.073 | 21.663 | 4 | 8.94 / 5.39 | 13.374 | 19.544 | 1 | 9.423 | 15.661 | 3 | 278248248 | 668400144 | 1302.6 | 1149 | 12.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.278 | 13.478 | 20.437 | 3 | 8.05 / 4.26 | 18.208 | 20.437 | 3 | 7.179 | 10.874 | 0 | 278248248 | 668400144 | 1253.1 | 1104 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.019 | 11.346 | 16.693 | 0 | 7.25 / 4.92 | 12.694 | 16.693 | 0 | 7.113 | 10.529 | 0 | 278250856 | 668400144 | 1150.5 | 988 | 9.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.081 | 12.452 | 20.971 | 1 | 6.84 / 3.99 | 14.904 | 20.971 | 1 | 7.359 | 12.151 | 0 | 278248248 | 668400144 | 1181.7 | 987.1 | 10.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.985 | 13.759 | 18.081 | 2 | 7.07 / 5.23 | 16.665 | 18.081 | 2 | 8.227 | 12.608 | 0 | 278250856 | 668400144 | 1173.9 | 1242 | 11.2 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.551 | 11.407 | 14.376 | 0 | 10.93 / 4.85 | 12.37 | 14.376 | 0 | 7.734 | 11.029 | 0 | 278248248 | 668400144 | 1243.5 | 1080.9 | 10.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.183 | 10.293 | 14.222 | 0 | 8.06 / 5.04 | 9.842 | 11.373 | 0 | 7.338 | 10.487 | 0 | 278250856 | 668400144 | 1335.7 | 1048.2 | 10.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.518 | 11.524 | 13.607 | 0 | 7.35 / 4.46 | 10.071 | 13.183 | 0 | 7.847 | 11.911 | 0 | 278248248 | 668400144 | 1238.8 | 1080.2 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.395 | 11.128 | 15.666 | 0 | 8.31 / 4.66 | 10.632 | 10.939 | 0 | 7.605 | 11.255 | 0 | 278250856 | 668400144 | 1341.8 | 1093.5 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.264 | 14.354 | 24.233 | 4 | 7.55 / 4.42 | 10.458 | 11.231 | 0 | 7.47 | 16.41 | 4 | 278248248 | 668400144 | 1261.8 | 1141.2 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.324 | 12.987 | 20.076 | 5 | 7.48 / 4.72 | 10.542 | 12.052 | 0 | 7.438 | 13.559 | 5 | 278250856 | 668400144 | 1241.7 | 1119.4 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.702 | 12.974 | 16.586 | 0 | 7.41 / 4.25 | 10.922 | 15.685 | 0 | 7.983 | 13.681 | 0 | 278248248 | 668400144 | 1305.1 | 1126 | 10.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.651 | 13.332 | 20.804 | 3 | 8.69 / 5.07 | 10.489 | 10.989 | 0 | 7.865 | 15.705 | 3 | 278250856 | 668400144 | 1214.6 | 1169.2 | 10.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.231 | 12.564 | 16.075 | 0 | 7.36 / 4.21 | 9.153 | 10.898 | 0 | 7.501 | 13.277 | 0 | 278248248 | 668400144 | 1272.2 | 1155.4 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.246 | 13.223 | 16.438 | 0 | 7.41 / 5.2 | 10.509 | 12.096 | 0 | 7.324 | 14.13 | 0 | 278250856 | 668400144 | 1244.5 | 1176.4 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.251 | 12.71 | 17.104 | 2 | 7.82 / 4.17 | 9.538 | 10.28 | 0 | 7.679 | 13.604 | 2 | 278248248 | 668400144 | 1197 | 1168.4 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.278 | 12.048 | 19.167 | 1 | 7.39 / 5.3 | 12.048 | 12.459 | 0 | 7.293 | 12.069 | 1 | 278250856 | 668400144 | 1242.8 | 1043.1 | 10.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.092 | 12.643 | 20.538 | 2 | 6.94 / 4.17 | 14.207 | 20.538 | 2 | 7.27 | 11.206 | 0 | 278248248 | 668400144 | 1175.6 | 1053.5 | 10.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.089 | 12.332 | 18.631 | 1 | 7.03 / 4.73 | 15.466 | 18.631 | 1 | 7.358 | 10.746 | 0 | 278250856 | 668400144 | 1202.8 | 993 | 10.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.134 | 12.208 | 15.994 | 0 | 8.25 / 4.75 | 14.41 | 15.994 | 0 | 7.222 | 10.787 | 0 | 278248248 | 668400144 | 1204.6 | 1086.2 | 10.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.807 | 11.452 | 17.684 | 1 | 7.15 / 4.43 | 14.069 | 17.684 | 1 | 6.894 | 9.314 | 0 | 278250856 | 668400144 | 1168.4 | 1052.9 | 9.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.963 | 13.865 | 19.217 | 2 | 7.59 / 4.29 | 16.265 | 19.217 | 2 | 7.074 | 9.671 | 0 | 278248248 | 668400144 | 1164.9 | 966.1 | 9.9 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.412 | 17.031 | 17.807 | 13 | 15.25 / 12.13 | 17.673 | 17.807 | 13 | 0.406 | 0.783 | 0 | 196109184 | 668400144 | 1187.4 | 1015.6 | 4.1 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.453 | 18.049 | 22.536 | 23 | 15.62 / 10.52 | 18.69 | 22.536 | 23 | 0.444 | 0.696 | 0 | 196109184 | 668400144 | 1254.5 | 1124.2 | 4.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.522 | 18.855 | 22.165 | 24 | 16.96 / 12.23 | 21.04 | 22.165 | 23 | 0.492 | 0.973 | 0 | 196109184 | 668400144 | 1310.2 | 1163.4 | 4.6 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.442 | 16.349 | 17.579 | 5 | 16.21 / 10.08 | 17.351 | 17.579 | 5 | 0.433 | 0.758 | 0 | 196109184 | 668400144 | 1306.8 | 956.8 | 4.2 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.518 | 16.995 | 18.86 | 13 | 15.19 / 12.18 | 17.934 | 18.86 | 13 | 0.511 | 0.77 | 0 | 196109184 | 668400144 | 1180.4 | 1167.7 | 4.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.548 | 19.041 | 22.147 | 26 | 18.97 / 13.31 | 21.02 | 22.147 | 25 | 0.509 | 0.931 | 0 | 196109184 | 668400144 | 1172.4 | 1054.4 | 4.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.54 | 19.001 | 20.518 | 26 | 15.37 / 14.33 | 19.794 | 20.518 | 26 | 0.521 | 1.059 | 0 | 196109184 | 668400144 | 1173.5 | 945.2 | 4.3 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.527 | 19.208 | 22.624 | 29 | 16.02 / 10.36 | 20.33 | 22.624 | 29 | 0.498 | 0.896 | 0 | 196109184 | 668400144 | 1162.7 | 957.5 | 4.3 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.493 | 17.384 | 19.17 | 20 | 15.61 / 12.06 | 18.31 | 19.17 | 20 | 0.456 | 1.064 | 0 | 196109184 | 668400144 | 1309.2 | 973.7 | 4.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.415 | 16.857 | 18.08 | 11 | 15.39 / 10.3 | 17.24 | 18.08 | 11 | 0.41 | 0.739 | 0 | 196109184 | 668400144 | 1171.7 | 1032.5 | 4.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.726 | 8.717 | 11.32 | 0 | 7.74 / 4.18 | 8.151 | 8.945 | 0 | 6.799 | 8.738 | 0 | 278227272 | 668400144 | 1242.4 | 1049.3 | 9.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.109 | 7.585 | 8.43 | 0 | 7.35 / 4.13 | 7.63 | 8.43 | 0 | 6.165 | 7.585 | 0 | 278227272 | 668400144 | 1215.1 | 1044.6 | 9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.129 | 7.688 | 10.283 | 0 | 6.9 / 3.99 | 8.124 | 9.835 | 0 | 6.162 | 7.442 | 0 | 278227272 | 668400144 | 1159.9 | 1027.3 | 8.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.444 | 10.297 | 15.053 | 0 | 7.05 / 4.1 | 12.024 | 15.053 | 0 | 6.5 | 8.139 | 0 | 278227272 | 668400144 | 1144.8 | 1081 | 9.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.787 | 11.619 | 15.913 | 0 | 7.57 / 4.21 | 14.598 | 15.913 | 0 | 6.868 | 9.176 | 0 | 278227272 | 668400144 | 1165.6 | 1030 | 9.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.781 | 10.61 | 19.726 | 1 | 6.82 / 4.09 | 12.227 | 19.726 | 1 | 6.873 | 9.822 | 0 | 278248248 | 668400144 | 1152.2 | 951.9 | 9.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.441 | 11.818 | 16.098 | 0 | 7.04 / 4.18 | 13.353 | 16.098 | 0 | 6.428 | 8.861 | 0 | 278248248 | 668400144 | 1165.1 | 993.6 | 9.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.565 | 12.219 | 16.861 | 1 | 6.92 / 4.11 | 14.75 | 16.861 | 1 | 6.586 | 9.159 | 0 | 278330164 | 668400144 | 1165.9 | 1094.5 | 9.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.498 | 11.503 | 18.565 | 1 | 7.15 / 4.16 | 13.848 | 18.565 | 1 | 6.612 | 9.495 | 0 | 278330164 | 668400144 | 1177.6 | 1027.5 | 9.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.112 | 11.983 | 16.73 | 1 | 7.99 / 4.41 | 11.093 | 11.501 | 0 | 7.27 | 12.966 | 1 | 278248248 | 668400144 | 1169.3 | 989.3 | 10.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.234 | 12.556 | 19.65 | 1 | 8.22 / 4.39 | 15.787 | 19.65 | 1 | 7.247 | 10.486 | 0 | 278248248 | 668400144 | 1453.5 | 1203.1 | 10.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.917 | 12.374 | 15.265 | 0 | 7.82 / 4.28 | 14.103 | 15.265 | 0 | 6.957 | 10.358 | 0 | 278330164 | 668400144 | 1176.1 | 1080.2 | 10.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.736 | 12.615 | 15.336 | 0 | 7.53 / 4.08 | 14.494 | 15.336 | 0 | 6.883 | 9.453 | 0 | 278330164 | 668400144 | 1249.5 | 1087.3 | 10 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.82 | 12.744 | 18.498 | 1 | 8.17 / 4.26 | 14.923 | 18.498 | 1 | 6.877 | 9.205 | 0 | 278248248 | 668400144 | 1166.8 | 910.5 | 9.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.064 | 12.458 | 15.322 | 0 | 6.88 / 4.02 | 13.794 | 15.322 | 0 | 7.205 | 10.922 | 0 | 278248248 | 668400144 | 1176.7 | 972.7 | 10 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.786 | 11.863 | 21.491 | 2 | 7.4 / 4.23 | 14.69 | 21.491 | 2 | 6.923 | 9.98 | 0 | 278330164 | 668400144 | 1181 | 1109.7 | 10 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.203 | 13.416 | 17.139 | 1 | 7.62 / 4.06 | 14.622 | 17.139 | 1 | 7.218 | 10.413 | 0 | 278330164 | 668400144 | 1200.6 | 1257.5 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.895 | 11.607 | 14.46 | 0 | 7.14 / 4.07 | 12.841 | 14.46 | 0 | 6.891 | 9.424 | 0 | 278248248 | 668400144 | 1161.2 | 1028.9 | 9.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.023 | 11.199 | 18.697 | 1 | 8.3 / 4.53 | 13.075 | 18.697 | 1 | 7.112 | 10.161 | 0 | 278248248 | 668400144 | 1159.8 | 1082.3 | 10.1 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.674 | 10.81 | 20.726 | 1 | 7.62 / 4.25 | 13.506 | 20.726 | 1 | 6.796 | 10.342 | 0 | 278330164 | 668400144 | 1175.2 | 1144.8 | 9.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.542 | 10.397 | 18.415 | 1 | 7.14 / 4.1 | 13.429 | 18.415 | 1 | 6.551 | 8.949 | 0 | 278330164 | 668400144 | 1175 | 971.8 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 14.093 | 21.011 | 24.679 | 100 | 10.98 / 5.86 | 19.712 | 20.736 | 8 | 14.594 | 21.531 | 92 | 278248248 | 668203536 | 1192.9 | 1099.4 | 16.2 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 9.329 | 14.158 | 15.494 | 0 | 8.07 / 5.04 | 12.935 | 15.494 | 0 | 9.494 | 14.481 | 0 | 278248248 | 668269072 | 1241.1 | 1212.6 | 12.4 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 8.01 | 12.175 | 16.565 | 0 | 7.49 / 4.64 | 13.675 | 16.565 | 0 | 8.188 | 11.622 | 0 | 278248248 | 668334608 | 1182.3 | 998.3 | 10.8 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 6.965 | 11.786 | 16.001 | 0 | 7.01 / 4.13 | 14.11 | 16.001 | 0 | 7.121 | 10.082 | 0 | 278248248 | 668531216 | 1148.1 | 959.5 | 9.9 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 8.158 | 13.085 | 17.911 | 1 | 7.84 / 4.46 | 15.119 | 17.911 | 1 | 8.236 | 10.619 | 0 | 278248248 | 668400144 | 1221.2 | 1172.8 | 11.1 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.966 | 13.103 | 24.168 | 4 | 24.17 / 8.98 | 18.365 | 22.597 | 3 | 6.958 | 9.303 | 0 | 278248248 | 668400144 |  | 848.8 | 8.7 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.431 | 9.674 | 12.533 | 0 | 7.52 / 4.14 | 11.982 | 12.533 | 0 | 0.412 | 0.732 | 0 | 196055280 | 668400144 | 1183.8 | 1270.2 | 4.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.34 | 9.67 | 16.164 | 0 | 7.06 / 4.35 | 9.76 | 10.835 | 0 | 6.323 | 9.67 | 0 | 405657056 | 668400144 | 1152 | 1054.3 | 20.9 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.751 | 7.665 | 10.28 | 0 | 6.78 / 3.97 | 7.279 | 8.46 | 0 | 5.756 | 7.987 | 0 | 222472736 | 668400144 | 1152.2 | 985.5 | 7.1 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.477 | 7.401 | 8.839 | 0 | 6.57 / 3.73 | 7.014 | 7.959 | 0 | 5.49 | 7.686 | 0 | 222620160 | 668400144 | 1189.4 | 1003.3 | 7 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.83 | 11.471 | 16.579 | 0 | 7.3 / 3.77 | 13.454 | 16.579 | 0 | 5.86 | 8.32 | 0 | 222423696 | 668400144 | 1146.7 | 1052.6 | 7.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.524 | 10.364 | 14.34 | 0 | 7.01 / 3.75 | 8.652 | 8.834 | 0 | 5.455 | 11.772 | 0 | 222580688 | 668400144 | 1325.6 | 1075.4 | 7.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.818 | 13.198 | 18.94 | 3 | 12.67 / 8.45 | 12.339 | 12.797 | 0 | 7.797 | 14.327 | 3 | 278248248 | 668400144 | 1211.2 | 1067 | 10.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.985 | 13.626 | 17.478 | 3 | 9.4 / 5.74 | 10.402 | 13.415 | 0 | 8.215 | 15.458 | 3 | 278248248 | 668400144 | 1273.3 | 1052 | 11.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.474 | 13.257 | 17.692 | 2 | 9.38 / 7.98 | 10.035 | 13.257 | 0 | 7.529 | 15.073 | 2 | 278248248 | 668400144 | 1253.9 | 1085.9 | 10.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.807 | 14.935 | 26.236 | 5 | 8.98 / 7.16 | 9.923 | 13.209 | 0 | 8.103 | 16.617 | 5 | 278248248 | 668400144 | 1249.9 | 1040.8 | 10.9 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.056 | 15.137 | 21.463 | 6 | 12.11 / 7.34 | 18.563 | 21.463 | 6 | 7.97 | 11.213 | 0 | 278248248 | 668400144 | 1247.9 | 1040.1 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.91 | 12.536 | 15.786 | 0 | 10.05 / 7.11 | 14.31 | 15.786 | 0 | 8.022 | 11.518 | 0 | 278248248 | 668400144 | 1252.8 | 1108.6 | 10.9 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.472 | 9.587 | 13.996 | 0 | 11.54 / 10.59 | 12.637 | 13.996 | 0 | 0.45 | 0.646 | 0 | 196055280 | 668400144 | 1229.2 | 1015.1 | 4.5 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.439 | 8.983 | 11.372 | 0 | 10.48 / 5.34 | 10.227 | 11.372 | 0 | 0.423 | 0.541 | 0 | 196055280 | 668400144 | 1255 | 1036.5 | 4.6 |
| profile 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.518 | 12.845 | 17.223 | 1 | 11.22 / 6.98 | 14.204 | 17.223 | 1 | 0.472 | 1.007 | 0 | 196055280 | 668400144 | 1247.5 | 938.8 | 4.6 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 13.549 | 16.25 | 0 | 0 | 14.411 | 17.711 | 1 | 22.6 |
| 128 MiB fixed | 1 | schedstat | 14.754 | 17.455 | 2 | 0 | 15.39 | 19.115 | 4 | 22.2 |
| 512 MiB fixed | 1 | schedstat | 13.958 | 14.994 | 0 | 0 | 14.343 | 16.012 | 0 | 17.8 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 9.466 | 12.999 | 0 | 0 | 9.746 | 12.477 | 0 | 17 |

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
