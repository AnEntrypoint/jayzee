# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 174.1 s across 305 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:scenario-marble-bowl` | 18212 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:scenario-determinism` | 16024 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:gc-witness` | 11958 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:engine-state-hash-1024` | 11951 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:engine-job-wait` | 7731 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:elevation-ab` | 6425 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:app-watch` | 4549 |  | Waits on real file-watch events. |
| `check:pose-allocations` | 4328 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:alloc-audit` | 4175 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:height-cpu` | 4112 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:sphere-population` | 4073 |  | Places the full sphere population and checks every member. |
| `check:vegetation-allocations` | 3484 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:scenario-deathrun` | 3294 | yes | Six runs per tier on four tiers. |
| `check:engine-tiers` | 3225 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:engine-release` | 3203 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:scenario-lockstep-rts` | 3181 | yes | Six peers per tier on four tiers. |
| `check:scenario-boss-fight` | 3063 | yes | Six runs per tier on four tiers. |
| `check:heightmap-cli` | 2879 |  | Runs the heightmap CLI once per fixture case. |
| `check:engine-threads` | 2451 | yes | Runs the threaded scenario at several worker counts. |
| `check:scenario-combat-bots` | 2438 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:scenario-allocations` | 2212 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:thread-sampler` | 2050 | yes | Samples real threads over a timed window. |
| `check:vegetation-generate-cost` | 1831 |  |  |
| `check:mapspinner-atmosphere` | 1780 |  |  |
| `check:scenario-character-terrain` | 1464 | yes |  |
| `check:snapshots` | 1429 |  |  |
| `check:planet-witness-scene` | 1334 |  |  |
| `check:types` | 1232 |  |  |
| `check:project-naming` | 1184 |  |  |
| `check:scenario-projectile-volley` | 1156 | yes |  |
| `check:scenario-planet-landing` | 1079 | yes |  |
| `check:scenario-settle` | 1031 | yes |  |
| `check:wireweave-relay` | 986 |  |  |
| `check:planet-scene-counts` | 969 |  |  |
| `check:gc-reuse-rows` | 949 |  |  |
| `check:scenario-character` | 890 | yes |  |
| `check:engine-raycast` | 883 |  |  |
| `check:engine-seal` | 836 |  |  |
| `check:engine-shapecast` | 827 |  |  |
| `check:engine-host-witness` | 781 |  |  |
| `check:netcode` | 733 |  |  |
| `check:create-app` | 729 |  |  |
| `check:upload-writes` | 670 |  |  |
| `check:crowd-dot-buffer` | 653 |  |  |
| `check:pose-replay` | 641 |  |  |
| `check:upload-handler` | 630 |  |  |
| `check:terrain-agreement` | 556 |  |  |
| `check:transport` | 537 |  |  |
| `build:kernel` | 529 |  |  |
| `check:engine-pools` | 517 |  |  |
| `check:engine-awake-budget` | 498 |  |  |
| `check:planet-witness` | 467 |  |  |
| `check:socket-server` | 436 |  |  |
| `check:stall-attribution` | 364 |  |  |
| `check:engine-warm` | 359 |  |  |
| `check:scene-setup-spoint` | 283 |  |  |
| `check:engine-world` | 275 |  |  |
| `check:sharding` | 271 |  |  |
| `check:collision-placement-options` | 257 |  |  |
| `check:world-query` | 250 |  |  |
| `check:physics-pure` | 245 |  |  |
| `check:world` | 237 |  |  |
| `check:ccd` | 237 |  |  |
| `check:engine-vegetation` | 237 |  |  |
| `check:engine-materials` | 237 |  |  |
| `check:kernel` | 236 |  |  |
| `check:packages` | 223 |  |  |
| `check:world-config` | 214 |  |  |
| `check:vehicles-spoint` | 213 |  |  |
| `check:collision-mirror` | 213 |  |  |
| `check:physics-integration-vehicles` | 211 |  |  |
| `check:sdk-surfaces` | 201 |  |  |
| `check:overlap-spoint` | 190 |  |  |
| `check:webgpu-profile` | 187 |  |  |
| `check:vehicle-remove-spoint` | 182 |  |  |
| `check:vehicle-refusal-spoint` | 181 |  |  |
| `check:collision-tile-streamer` | 181 |  |  |
| `check:raycast-spoint` | 180 |  |  |
| `check:dormant-budget-spoint` | 179 |  |  |
| `check:collision-host` | 175 |  |  |
| `check:dormant-spoint` | 175 |  |  |
| `check:player-vat-spoint` | 175 |  |  |
| `check:engine-planet` | 172 |  |  |
| `check:site-world` | 168 |  |  |
| `check:recast-bake-spoint` | 166 |  |  |
| `check:engine-budget-floor` | 166 |  |  |
| `check:decode-path` | 165 |  |  |
| `check:engine-bridge` | 163 |  |  |
| `check:fire` | 162 |  |  |
| `check:player-lod-renderer` | 160 |  |  |
| `check:chart-state-live` | 160 |  |  |
| `check:player-dot-shader-spoint` | 150 |  |  |
| `check:engine-sleep` | 150 |  |  |
| `check:player-lod-renderer-webgpu` | 148 |  |  |
| `check:terrain-static` | 143 |  |  |
| `check:player-dot-material-spoint` | 141 |  |  |
| `check:engine-leak` | 141 |  |  |
| `check:rebase-session` | 138 |  |  |
| `check:streaming-gltf-mesh` | 137 |  |  |
| `check:bloom-spoint` | 136 |  |  |
| `check:camera-relative` | 135 |  |  |
| `check:streamer-p99` | 124 |  |  |
| `check:fire-modules` | 119 |  |  |
| `check:sample-order` | 118 |  |  |
| `check:upstream-builtin-nav` | 116 |  |  |
| `check:cluster-lod-spoint` | 115 |  |  |
| `check:vegetation-leaf-patches` | 114 |  |  |
| `check:lockstep` | 107 |  |  |
| `check:ssr-spoint` | 107 |  |  |
| `check:engine-codecs` | 104 |  |  |
| `check:sessions` | 99 |  |  |
| `check:vat-spoint` | 99 |  |  |
| `check:engine-interest` | 97 |  |  |
| `check:terrain-pure` | 96 |  |  |
| `check:script-limits` | 96 |  |  |
| `check:glue-tier` | 95 |  |  |
| `check:spline-erosion-witness` | 94 |  |  |
| `check:follow-misuse` | 92 |  |  |
| `check:engine-core` | 92 |  |  |
| `check:chart-anchor` | 90 |  |  |
| `check:socket-upgrade` | 90 |  |  |
| `check:timed-result` | 87 |  |  |
| `check:fsr1-spoint` | 86 |  |  |
| `check:bin-snapshot` | 84 |  |  |
| `check:procgen` | 81 |  |  |
| `check:ci-engine-glue` | 81 |  |  |
| `check:import-scene` | 80 |  |  |
| `check:spoint-core-rust` | 78 |  |  |
| `check:client-resource-pools` | 77 |  |  |
| `check:tick-governor` | 75 | yes |  |
| `check:replay-file` | 74 |  |  |
| `check:client-pure` | 74 |  |  |
| `check:lag-compensation` | 73 |  |  |
| `check:replay-player` | 72 |  |  |
| `check:vegetation-stream` | 72 |  |  |
| `check:rollback` | 71 |  |  |
| `check:collider-streamer` | 71 |  |  |
| `check:snapshot-lod` | 70 |  |  |
| `check:player-collisions` | 68 |  |  |
| `check:msgpackr-compat` | 67 |  |  |
| `check:behaviours` | 66 |  |  |
| `check:behaviour-health-destructible` | 66 |  |  |
| `check:upstream-skill-registry` | 66 |  |  |
| `check:protocol-codecs` | 65 |  |  |
| `check:netcode-small` | 65 |  |  |
| `check:client-message-handler` | 64 |  |  |
| `check:lod-tiers` | 64 |  |  |
| `check:protocol` | 63 |  |  |
| `check:spawn` | 63 |  |  |
| `check:prediction-engine` | 63 |  |  |
| `check:sdk-misc` | 63 |  |  |
| `check:replay-dialect` | 63 |  |  |
| `check:engine-render` | 63 |  |  |
| `check:cluster-handoff` | 62 |  |  |
| `check:msgpack-packer` | 62 |  |  |
| `check:snapshot-packer` | 62 |  |  |
| `check:animation-control` | 61 |  |  |
| `check:chart-reanchor` | 61 |  |  |
| `check:hygiene` | 61 |  |  |
| `check:chart-migrators` | 60 |  |  |
| `check:paint-store` | 59 |  |  |
| `check:streaming-gltf-queues` | 59 |  |  |
| `check:sdk-editor` | 59 |  |  |
| `check:game-systems` | 58 |  |  |
| `check:wireweave-frame-spoint` | 58 |  |  |
| `check:upstream-skill-bodies` | 57 |  |  |
| `check:upstream-builtin-bodies` | 57 |  |  |
| `check:entity-host` | 57 |  |  |
| `check:player-lod-plan` | 57 |  |  |
| `check:row16-client-decoder` | 56 |  |  |
| `check:shared-pure` | 56 |  |  |
| `check:pathfinding` | 55 |  |  |
| `check:tick-authority` | 55 |  |  |
| `check:hot-reload-spoint` | 55 |  |  |
| `check:frame-stall-cause` | 55 |  |  |
| `check:snapshot-processor` | 54 |  |  |
| `check:upstream-builtin-voxels` | 54 |  |  |
| `check:client-machines` | 54 |  |  |
| `check:reduced-pose` | 54 |  |  |
| `check:upload-route` | 54 |  |  |
| `check:negative-zero` | 54 |  |  |
| `check:controlled-run` | 54 |  |  |
| `check:aoi` | 53 |  |  |
| `check:upstream-tome-bodies` | 53 |  |  |
| `check:client-pure-rows` | 53 |  |  |
| `check:editor-serialize` | 53 |  |  |
| `check:material-tier-swap-spoint` | 53 |  |  |
| `check:paired-report` | 53 |  |  |
| `check:sampler-gap-attribution` | 53 |  |  |
| `check:behaviours-c` | 52 |  |  |
| `check:apps-a` | 52 |  |  |
| `check:apps-b` | 52 |  |  |
| `check:engine-artifacts` | 52 |  |  |
| `check:kaggle-regress` | 52 |  |  |
| `check:upstream-door-routes` | 51 |  |  |
| `check:camera-rig` | 51 |  |  |
| `check:mat4-spoint` | 51 |  |  |
| `check:event-log` | 50 |  |  |
| `check:chart-transfer` | 50 |  |  |
| `check:behaviours-a` | 50 |  |  |
| `check:game-systems-spoint` | 50 |  |  |
| `check:minidump` | 50 |  |  |
| `check:spawn-named-errors` | 49 |  |  |
| `check:upstream-endpoints` | 49 |  |  |
| `check:bundle-freshness-jayzee` | 49 |  |  |
| `check:octree` | 49 |  |  |
| `check:stage` | 49 |  |  |
| `check:consensus` | 49 |  |  |
| `check:world-persistence` | 49 |  |  |
| `check:upstream-tome-lookup` | 49 |  |  |
| `check:upstream-builtin-physics` | 49 |  |  |
| `check:app-loader` | 49 |  |  |
| `check:collision-placement` | 49 |  |  |
| `check:render` | 48 |  |  |
| `check:client-loops` | 48 |  |  |
| `check:feature-gap` | 48 |  |  |
| `check:telemetry` | 48 |  |  |
| `check:upstream-builtin-easing` | 48 |  |  |
| `check:behaviours-b` | 48 |  |  |
| `check:app-runtime-state` | 48 |  |  |
| `check:world-def-clusters` | 48 |  |  |
| `check:client-tier-split` | 48 |  |  |
| `check:physics-extras` | 47 |  |  |
| `check:upstream-builtin-env` | 47 |  |  |
| `check:upstream-builtin-lighting` | 47 |  |  |
| `check:cluster-slice` | 47 |  |  |
| `check:upstream-reference` | 46 |  |  |
| `check:upstream-builtin-tsl` | 46 |  |  |
| `check:app-behaviours` | 46 |  |  |
| `check:physics-integration` | 46 |  |  |
| `check:chart-state-server` | 46 |  |  |
| `check:blend-tree-spoint` | 46 |  |  |
| `check:frequency-runs` | 46 |  |  |
| `check:relative-residuals` | 46 |  |  |
| `check:sandbox` | 45 |  |  |
| `check:anticheat-spoint` | 45 |  |  |
| `check:navmesh-query-spoint` | 45 |  |  |
| `check:clusters` | 44 |  |  |
| `check:tick-scheduler` | 44 |  |  |
| `check:upstream-builtin-vec3` | 44 |  |  |
| `check:upstream-builtin-three` | 44 |  |  |
| `check:world-resolver` | 44 |  |  |
| `check:crowd-dot-cells-spoint` | 44 |  |  |
| `check:client-pure-spoint` | 44 |  |  |
| `check:site` | 43 |  |  |
| `check:transport-framing` | 43 |  |  |
| `check:rollback-bridge` | 43 |  |  |
| `check:upstream-builtin-math` | 43 |  |  |
| `check:upstream-builtin-postfx` | 43 |  |  |
| `check:upstream-builtin-noise` | 43 |  |  |
| `check:upstream-builtin-tween` | 43 |  |  |
| `check:asset-pipeline` | 43 |  |  |
| `check:jolt-limits` | 42 |  |  |
| `check:named-asset-redirect` | 42 |  |  |
| `check:upstream-builtin-path` | 42 |  |  |
| `check:component-pool` | 42 |  |  |
| `check:network-state` | 42 |  |  |
| `check:stall-probe` | 42 |  |  |
| `check:stall-off-cpu` | 42 |  |  |
| `check:tail-report` | 42 |  |  |
| `check:worker-bridge` | 41 |  |  |
| `check:worker-dispatch` | 41 |  |  |
| `check:hook-order` | 41 |  |  |
| `check:upstream-builtin-fx` | 41 |  |  |
| `check:upstream-builtin-spline` | 41 |  |  |
| `check:upstream-builtin-water` | 41 |  |  |
| `check:reexpress-records` | 41 |  |  |
| `check:spawn-captured-names` | 41 |  |  |
| `check:pool-params-spoint` | 41 |  |  |
| `check:engine-visibility` | 41 |  |  |
| `check:anticheat` | 40 |  |  |
| `check:rollback-peer` | 40 |  |  |
| `check:upstream-tome` | 40 |  |  |
| `check:player-id` | 40 |  |  |
| `check:browser-heap` | 40 |  |  |
| `check:animation` | 39 |  |  |
| `check:upstream-door-dispatch` | 39 |  |  |
| `check:upstream-skills` | 39 |  |  |
| `check:upstream-builtins` | 39 |  |  |
| `check:upstream-builtin-ballistics` | 39 |  |  |
| `check:upstream-builtin-room-routing` | 39 |  |  |
| `check:character-step` | 38 |  |  |
| `check:vec3-read` | 38 |  |  |
| `check:postfx-shaders-spoint` | 38 |  |  |
| `check:messages` | 37 |  |  |
| `check:flight-model` | 37 |  |  |
| `check:constraint-limits` | 37 |  |  |
| `check:movement` | 37 |  |  |
| `check:engine-solver-tier` | 37 |  |  |
| `check:chromium-launcher` | 37 |  |  |
| `check:hot-reload` | 36 |  |  |
| `check:content` | 36 |  |  |
| `check:upstream-doors` | 36 |  |  |
| `check:heightfield-physics` | 36 |  |  |
| `check:upstream-builtin-vibe` | 36 |  |  |
| `check:spawn-captured-bodies` | 36 |  |  |
| `check:render-1024-visible` | 36 |  |  |
| `check:collider-layers` | 36 |  |  |
| `check:engine-isolation` | 36 |  |  |
| `check:planet-gap-class` | 36 |  |  |
| `check:tick-order` | 35 |  |  |
| `check:relocation-solve` | 35 |  |  |
| `check:cube-sphere-cell-key-spoint` | 35 |  |  |
| `check:upstream-builtin-terrain` | 34 |  |  |
| `check:vehicle-tuning` | 33 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 30. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T18:24:00.020Z. Queue wait 7 s from the push to the first line of the script. Run time 335.9 s for 42 of 42 planned runs.
- engine-core-1024mib-threads.mjs, warmed: 40960 bodies hold the budget at p99 with zero ticks over budget (workers 2, 3, 4, 6); in the steady window alone 40960 bodies hold it (workers 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, warmed: 40960 bodies hold the budget at p99 with zero ticks over budget (workers 2, 3, 4, 6); in the steady window alone 40960 bodies hold it (workers 2, 3, 4, 6).
- engine-core-1024mib-threads.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 40960 bodies hold it (workers 2, 3, 6).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 40960 bodies hold it (workers 1, 2, 3, 4, 6).
- cap65536 build of engine-core-1024mib-threads-simd.mjs, warmed: 65536 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4, 6); in the steady window alone 65536 bodies hold it (workers 3, 4, 6).
- cap65536 build of engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 65536 bodies hold it (workers 4).
- Refused by the arena plan: 8 workers (workers-do-not-fit).
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads, warmed | 40960 | 1 | 4 |  | 12.895 | 19.134 | 26.043 | 21 | 8.14 / 8.55 | 14.782 | 15.901 | 0 | 13.234 | 20.741 | 21 | 283619856 | 655890960 | 1467.8 | 942 | 12.8 |
| 1024mib-threads, warmed | 40960 | 2 | 4 |  | 7.962 | 12.223 | 15.095 | 0 | 7.3 / 7.13 | 11.289 | 11.71 | 0 | 7.996 | 13.03 | 0 | 283619856 | 655956496 | 1278.6 | 885.8 | 8.7 |
| 1024mib-threads, warmed | 40960 | 3 | 4 |  | 7.39 | 11.539 | 14.084 | 0 | 6.59 / 5.68 | 8.611 | 10.268 | 0 | 7.502 | 12.151 | 0 | 283619856 | 656022032 | 1263.8 | 941 | 8.2 |
| 1024mib-threads, warmed | 40960 | 4 | 4 |  | 6.654 | 7.876 | 9.467 | 0 | 5.47 / 4.93 | 7.876 | 8.671 | 0 | 6.693 | 8.036 | 0 | 283619856 | 656087568 | 1272.2 | 872.1 | 7.5 |
| 1024mib-threads, warmed | 40960 | 6 | 4 |  | 6.784 | 8.876 | 11.141 | 0 | 8.45 / 8.52 | 9.127 | 11.141 | 0 | 6.824 | 8.844 | 0 | 283619856 | 656218640 | 1257.9 | 919.7 | 7.8 |
| 1024mib-threads-simd, warmed | 40960 | 1 | 4 |  | 10.778 | 13.005 | 17.127 | 1 | 7.68 / 7.39 | 12.807 | 13.292 | 0 | 11.067 | 13.215 | 1 | 283619856 | 655890960 | 1179 | 914.1 | 10.4 |
| 1024mib-threads-simd, warmed | 40960 | 2 | 4 |  | 6.739 | 8.183 | 8.789 | 0 | 6.59 / 6.08 | 7.73 | 7.928 | 0 | 6.916 | 8.247 | 0 | 283619856 | 655956496 | 1257.5 | 870.3 | 7.6 |
| 1024mib-threads-simd, warmed | 40960 | 3 | 4 |  | 5.969 | 10.205 | 13.473 | 0 | 5.46 / 4.78 | 12.431 | 13.473 | 0 | 5.985 | 6.843 | 0 | 283619856 | 656022032 | 1185.3 | 869.8 | 7 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.25 | 6.779 | 9.309 | 0 | 5.24 / 4.49 | 6.782 | 9.309 | 0 | 5.216 | 6.526 | 0 | 283619856 | 656087568 | 1178.2 | 861.4 | 6.4 |
| 1024mib-threads-simd, warmed | 40960 | 6 | 4 |  | 5.326 | 7.627 | 9.187 | 0 | 5.27 / 4.26 | 7.462 | 8.274 | 0 | 5.393 | 7.671 | 0 | 283619856 | 656218640 | 1234.5 | 874.7 | 6.6 |
| 1024mib-threads, cold | 40960 | 1 | 4 |  | 13.048 | 16.567 | 57.009 | 8 | 24.75 / 19.64 | 19.277 | 57.009 | 3 | 13.474 | 16.205 | 3 | 283619856 | 655890960 |  | 867.2 | 11 |
| 1024mib-threads, cold | 40960 | 2 | 4 |  | 8.183 | 10.285 | 19.742 | 2 | 19.74 / 11.62 | 13.804 | 18.405 | 1 | 8.25 | 9.734 | 0 | 283619856 | 655956496 |  | 975.4 | 7.5 |
| 1024mib-threads, cold | 40960 | 3 | 4 |  | 7.744 | 13.962 | 21.785 | 2 | 21.79 / 13.33 | 15.922 | 17.957 | 1 | 7.791 | 9.614 | 0 | 283619856 | 656022032 |  | 873.7 | 7.2 |
| 1024mib-threads, cold | 40960 | 4 | 4 |  | 6.87 | 12.892 | 22.67 | 4 | 22.67 / 12.57 | 10.539 | 20.795 | 1 | 6.971 | 13.932 | 2 | 283619856 | 656087568 |  | 901.7 | 6.6 |
| 1024mib-threads, cold | 40960 | 6 | 4 |  | 7.047 | 10.204 | 21.378 | 3 | 21.24 / 14.9 | 13.929 | 21.378 | 2 | 7.077 | 9.557 | 0 | 283619856 | 656218640 |  | 864 | 6.7 |
| 1024mib-threads-simd, cold | 40960 | 1 | 4 |  | 10.875 | 13.499 | 25.47 | 1 | 25.47 / 13.97 | 13.681 | 15.877 | 0 | 11.002 | 13.366 | 0 | 283619856 | 655890960 |  | 978.3 | 9.4 |
| 1024mib-threads-simd, cold | 40960 | 2 | 4 |  | 6.737 | 10.765 | 18.171 | 1 | 18.17 / 8.46 | 11.558 | 15.463 | 0 | 6.72 | 8.166 | 0 | 283619856 | 655956496 |  | 867.6 | 6.4 |
| 1024mib-threads-simd, cold | 40960 | 3 | 4 |  | 6.092 | 10.617 | 21.198 | 1 | 21.2 / 12.23 | 10.617 | 14.476 | 0 | 6.179 | 10.152 | 0 | 283619856 | 656022032 |  | 874.4 | 5.9 |
| 1024mib-threads-simd, cold | 40960 | 4 | 4 |  | 5.428 | 7.657 | 21.528 | 2 | 21.53 / 12.61 | 10.432 | 20.831 | 1 | 5.462 | 6.64 | 0 | 283619856 | 656087568 |  | 887 | 5.4 |
| 1024mib-threads-simd, cold | 40960 | 6 | 4 |  | 5.704 | 13.561 | 25.044 | 3 | 25.04 / 14.33 | 12.925 | 24.843 | 2 | 5.751 | 13.487 | 0 | 283619856 | 656218640 |  | 876.5 | 5.9 |
| cap65536 1024mib-threads-simd, warmed | 49152 | 3 | 4 |  | 6.554 | 9.482 | 12.716 | 0 | 6.56 / 5.12 | 7.284 | 8.165 | 0 | 6.614 | 11.445 | 0 | 406767680 | 782940688 | 1293.6 | 929.5 | 8.5 |
| cap65536 1024mib-threads-simd, warmed | 49152 | 4 | 4 |  | 5.822 | 6.915 | 8.642 | 0 | 5.84 / 4.77 | 6.951 | 7.5 | 0 | 5.877 | 6.915 | 0 | 406767680 | 783006224 | 1298.2 | 950.4 | 7.8 |
| cap65536 1024mib-threads-simd, warmed | 49152 | 6 | 4 |  | 6.001 | 7.792 | 8.999 | 0 | 5.84 / 4.74 | 7.911 | 8.382 | 0 | 6.036 | 7.718 | 0 | 406767680 | 783137296 | 1272.5 | 876.7 | 8 |
| cap65536 1024mib-threads-simd, warmed | 65536 | 3 | 4 |  | 6.717 | 9.039 | 16.534 | 0 | 7.02 / 5.29 | 12.582 | 16.534 | 0 | 6.816 | 7.904 | 0 | 428111984 | 782940688 | 1184.1 | 882 | 8.6 |
| cap65536 1024mib-threads-simd, warmed | 65536 | 4 | 4 |  | 5.718 | 9.725 | 12.942 | 0 | 5.8 / 4.56 | 11.984 | 12.942 | 0 | 5.798 | 7.552 | 0 | 428111984 | 783006224 | 1195.3 | 877.6 | 7.7 |
| cap65536 1024mib-threads-simd, warmed | 65536 | 6 | 4 |  | 6.063 | 10.816 | 16.264 | 0 | 5.92 / 5.1 | 7.62 | 7.914 | 0 | 6.173 | 12.08 | 0 | 428111984 | 783137296 | 1196.3 | 875.6 | 8.2 |
| cap65536 1024mib-threads-simd, cold | 49152 | 4 | 4 |  | 5.689 | 8.608 | 42.312 | 4 | 24.86 / 8.61 | 20.53 | 42.312 | 3 | 5.689 | 6.675 | 0 | 406767680 | 783006224 |  | 869 | 6.4 |
| cap65536 1024mib-threads-simd, cold | 65536 | 4 | 4 |  | 6.141 | 12.287 | 27.601 | 2 | 27.6 / 10.67 | 13.6 | 18.197 | 1 | 6.182 | 7.218 | 0 | 428111984 | 783006224 |  | 887.6 | 7 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.341 | 10.334 | 14.671 | 0 | 5.1 / 4.23 | 6.775 | 8.191 | 0 | 5.401 | 11.125 | 0 | 283619856 | 656087568 | 1206.9 | 1009.1 | 6.8 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 | warm run 1024x150 | 5.428 | 6.4 | 8.578 | 0 | 5.17 / 6.36 | 6.876 | 8.578 | 0 | 5.469 | 6.382 | 0 | 283619856 | 656087568 | 1049 | 878.9 | 6.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 | warm run 512x90 | 5.389 | 6.677 | 10.272 | 0 | 5.12 / 4.71 | 7.167 | 10.272 | 0 | 5.473 | 6.645 | 0 | 283619856 | 656087568 | 1020.3 | 982.7 | 6.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.123 | 10.145 | 14.973 | 0 | 4.81 / 4.26 | 6.179 | 7.146 | 0 | 5.219 | 11.385 | 0 | 283619856 | 656087568 | 1212 | 886.6 | 6.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 | warm run 1024x150 | 5.242 | 6.577 | 7.681 | 0 | 5.05 / 6.31 | 6.577 | 7.181 | 0 | 5.26 | 6.647 | 0 | 283619856 | 656087568 | 1078.2 | 880.7 | 6.3 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 | warm run 512x90 | 5.15 | 6.144 | 7.831 | 0 | 5.69 / 4.44 | 6.41 | 7.831 | 0 | 5.19 | 6.077 | 0 | 283619856 | 656087568 | 993.8 | 943.9 | 6.2 |

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 15.976 | 18.999 | 4 | 0 | 15.639 | 18.537 | 3 | 20.3 |
| 128 MiB fixed | 1 | schedstat | 11.998 | 14.999 | 0 | 0 | 11.505 | 15.338 | 0 | 20.4 |
| 512 MiB fixed | 1 | schedstat | 13.851 | 17.001 | 1 | 0 | 13.896 | 16.959 | 1 | 15.9 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.033 | 7.999 | 0 | 0 | 6.265 | 11.311 | 0 | 14.5 |

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
