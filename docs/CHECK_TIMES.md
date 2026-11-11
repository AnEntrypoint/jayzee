# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 152.1 s across 305 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:scenario-marble-bowl` | 13744 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:gc-witness` | 11376 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:engine-state-hash-1024` | 10533 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:scenario-determinism` | 8550 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:engine-job-wait` | 6954 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:elevation-ab` | 5761 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:app-watch` | 4559 |  | Waits on real file-watch events. |
| `check:pose-allocations` | 4444 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:height-cpu` | 3731 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:sphere-population` | 3706 |  | Places the full sphere population and checks every member. |
| `check:alloc-audit` | 3547 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:engine-release` | 3516 |  | Loads seven threaded 512 MiB instances in turn and waits for the collector after each. |
| `check:heightmap-cli` | 3346 |  | Runs the heightmap CLI once per fixture case. |
| `check:vegetation-allocations` | 3219 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:engine-tiers` | 2788 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:scenario-lockstep-rts` | 2546 | yes | Six peers per tier on four tiers. |
| `check:scenario-deathrun` | 2514 | yes | Six runs per tier on four tiers. |
| `check:scenario-boss-fight` | 2452 | yes | Six runs per tier on four tiers. |
| `check:scenario-combat-bots` | 2296 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:thread-sampler` | 2049 | yes | Samples real threads over a timed window. |
| `check:engine-threads` | 1982 | yes |  |
| `check:scenario-allocations` | 1955 | yes |  |
| `check:vegetation-generate-cost` | 1950 |  |  |
| `check:mapspinner-atmosphere` | 1948 |  |  |
| `check:snapshots` | 1709 |  |  |
| `check:planet-witness-scene` | 1491 |  |  |
| `check:scenario-character-terrain` | 1443 | yes |  |
| `check:scenario-projectile-volley` | 1136 | yes |  |
| `check:planet-scene-counts` | 1084 |  |  |
| `check:scenario-planet-landing` | 1050 | yes |  |
| `check:scenario-settle` | 1032 | yes |  |
| `check:gc-reuse-rows` | 1009 |  |  |
| `check:engine-raycast` | 962 |  |  |
| `check:types` | 914 |  |  |
| `check:engine-seal` | 892 |  |  |
| `check:scenario-character` | 879 | yes |  |
| `check:engine-shapecast` | 845 |  |  |
| `check:wireweave-relay` | 761 |  |  |
| `check:netcode` | 693 |  |  |
| `check:engine-host-witness` | 692 |  |  |
| `check:create-app` | 659 |  |  |
| `check:upload-writes` | 641 |  |  |
| `check:crowd-dot-buffer` | 633 |  |  |
| `check:upload-handler` | 623 |  |  |
| `check:pose-replay` | 527 |  |  |
| `check:terrain-agreement` | 505 |  |  |
| `build:kernel` | 502 |  |  |
| `check:transport` | 492 |  |  |
| `check:engine-pools` | 467 |  |  |
| `check:planet-witness` | 458 |  |  |
| `check:engine-awake-budget` | 414 |  |  |
| `check:socket-server` | 406 |  |  |
| `check:engine-warm` | 371 |  |  |
| `check:stall-attribution` | 346 |  |  |
| `check:collision-placement-options` | 277 |  |  |
| `check:sharding` | 274 |  |  |
| `check:engine-world` | 270 |  |  |
| `check:kernel` | 262 |  |  |
| `check:physics-pure` | 262 |  |  |
| `check:world` | 256 |  |  |
| `check:engine-vegetation` | 243 |  |  |
| `check:project-naming` | 233 |  |  |
| `check:ccd` | 229 |  |  |
| `check:engine-materials` | 222 |  |  |
| `check:world-config` | 216 |  |  |
| `check:world-query` | 213 |  |  |
| `check:packages` | 205 |  |  |
| `check:physics-integration-vehicles` | 196 |  |  |
| `check:collision-mirror` | 189 |  |  |
| `check:vehicles-spoint` | 185 |  |  |
| `check:collision-tile-streamer` | 182 |  |  |
| `check:dormant-spoint` | 180 |  |  |
| `check:sdk-surfaces` | 176 |  |  |
| `check:raycast-spoint` | 173 |  |  |
| `check:webgpu-profile` | 170 |  |  |
| `check:vehicle-remove-spoint` | 167 |  |  |
| `check:overlap-spoint` | 166 |  |  |
| `check:collision-host` | 165 |  |  |
| `check:vehicle-refusal-spoint` | 163 |  |  |
| `check:dormant-budget-spoint` | 160 |  |  |
| `check:site-world` | 157 |  |  |
| `check:player-vat-spoint` | 157 |  |  |
| `check:engine-planet` | 154 |  |  |
| `check:player-lod-renderer` | 152 |  |  |
| `check:player-lod-renderer-webgpu` | 152 |  |  |
| `check:engine-budget-floor` | 152 |  |  |
| `check:chart-state-live` | 146 |  |  |
| `check:engine-bridge` | 146 |  |  |
| `check:rebase-session` | 142 |  |  |
| `check:fire` | 141 |  |  |
| `check:bloom-spoint` | 141 |  |  |
| `check:cluster-lod-spoint` | 140 |  |  |
| `check:recast-bake-spoint` | 140 |  |  |
| `check:player-dot-material-spoint` | 138 |  |  |
| `check:engine-sleep` | 135 |  |  |
| `check:player-dot-shader-spoint` | 132 |  |  |
| `check:terrain-static` | 129 |  |  |
| `check:camera-relative` | 125 |  |  |
| `check:scene-setup-spoint` | 124 |  |  |
| `check:streaming-gltf-mesh` | 123 |  |  |
| `check:decode-path` | 121 |  |  |
| `check:streamer-p99` | 120 |  |  |
| `check:engine-leak` | 114 |  |  |
| `check:fire-modules` | 109 |  |  |
| `check:vegetation-leaf-patches` | 107 |  |  |
| `check:upstream-builtin-nav` | 104 |  |  |
| `check:lockstep` | 103 |  |  |
| `check:sample-order` | 98 |  |  |
| `check:vat-spoint` | 97 |  |  |
| `check:follow-misuse` | 97 |  |  |
| `check:engine-codecs` | 97 |  |  |
| `check:engine-core` | 95 |  |  |
| `check:engine-interest` | 95 |  |  |
| `check:terrain-pure` | 93 |  |  |
| `check:script-limits` | 88 |  |  |
| `check:socket-upgrade` | 87 |  |  |
| `check:fsr1-spoint` | 86 |  |  |
| `check:spline-erosion-witness` | 84 |  |  |
| `check:sessions` | 84 |  |  |
| `check:ssr-spoint` | 84 |  |  |
| `check:chart-anchor` | 83 |  |  |
| `check:timed-result` | 83 |  |  |
| `check:ci-engine-glue` | 83 |  |  |
| `check:bin-snapshot` | 82 |  |  |
| `check:tick-governor` | 77 | yes |  |
| `check:glue-tier` | 77 |  |  |
| `check:procgen` | 76 |  |  |
| `check:import-scene` | 75 |  |  |
| `check:client-resource-pools` | 74 |  |  |
| `check:replay-file` | 73 |  |  |
| `check:client-pure` | 73 |  |  |
| `check:spoint-core-rust` | 70 |  |  |
| `check:replay-player` | 69 |  |  |
| `check:collider-streamer` | 67 |  |  |
| `check:behaviours` | 64 |  |  |
| `check:upstream-skill-registry` | 64 |  |  |
| `check:snapshot-lod` | 63 |  |  |
| `check:player-collisions` | 63 |  |  |
| `check:wireweave-frame-spoint` | 62 |  |  |
| `check:vegetation-stream` | 62 |  |  |
| `check:lag-compensation` | 61 |  |  |
| `check:lod-tiers` | 61 |  |  |
| `check:protocol-codecs` | 60 |  |  |
| `check:rollback` | 60 |  |  |
| `check:cluster-handoff` | 60 |  |  |
| `check:client-message-handler` | 60 |  |  |
| `check:behaviour-health-destructible` | 59 |  |  |
| `check:spawn` | 58 |  |  |
| `check:tick-authority` | 58 |  |  |
| `check:streaming-gltf-queues` | 58 |  |  |
| `check:reduced-pose` | 58 |  |  |
| `check:msgpack-packer` | 58 |  |  |
| `check:engine-render` | 58 |  |  |
| `check:hot-reload-spoint` | 57 |  |  |
| `check:protocol` | 56 |  |  |
| `check:msgpackr-compat` | 56 |  |  |
| `check:chart-migrators` | 56 |  |  |
| `check:replay-dialect` | 56 |  |  |
| `check:snapshot-packer` | 56 |  |  |
| `check:engine-artifacts` | 56 |  |  |
| `check:game-systems` | 55 |  |  |
| `check:animation-control` | 55 |  |  |
| `check:upstream-skill-bodies` | 55 |  |  |
| `check:sdk-misc` | 55 |  |  |
| `check:netcode-small` | 55 |  |  |
| `check:negative-zero` | 55 |  |  |
| `check:aoi` | 54 |  |  |
| `check:event-log` | 54 |  |  |
| `check:chart-reanchor` | 54 |  |  |
| `check:shared-pure` | 54 |  |  |
| `check:player-lod-plan` | 54 |  |  |
| `check:hygiene` | 54 |  |  |
| `check:controlled-run` | 54 |  |  |
| `check:frame-stall-cause` | 54 |  |  |
| `check:octree` | 53 |  |  |
| `check:prediction-engine` | 53 |  |  |
| `check:entity-host` | 53 |  |  |
| `check:paint-store` | 52 |  |  |
| `check:behaviours-a` | 52 |  |  |
| `check:upload-route` | 52 |  |  |
| `check:kaggle-regress` | 52 |  |  |
| `check:pathfinding` | 51 |  |  |
| `check:snapshot-processor` | 51 |  |  |
| `check:behaviours-c` | 51 |  |  |
| `check:mat4-spoint` | 51 |  |  |
| `check:feature-gap` | 50 |  |  |
| `check:bundle-freshness-jayzee` | 50 |  |  |
| `check:upstream-door-routes` | 50 |  |  |
| `check:upstream-builtin-bodies` | 50 |  |  |
| `check:sdk-editor` | 50 |  |  |
| `check:client-pure-rows` | 50 |  |  |
| `check:game-systems-spoint` | 50 |  |  |
| `check:anticheat-spoint` | 49 |  |  |
| `check:render` | 49 |  |  |
| `check:stage` | 49 |  |  |
| `check:frequency-runs` | 49 |  |  |
| `check:chart-transfer` | 48 |  |  |
| `check:upstream-builtin-noise` | 48 |  |  |
| `check:client-tier-split` | 48 |  |  |
| `check:client-loops` | 47 |  |  |
| `check:world-persistence` | 47 |  |  |
| `check:telemetry` | 47 |  |  |
| `check:apps-a` | 47 |  |  |
| `check:apps-b` | 47 |  |  |
| `check:client-machines` | 47 |  |  |
| `check:app-loader` | 47 |  |  |
| `check:paired-report` | 47 |  |  |
| `check:physics-extras` | 46 |  |  |
| `check:row16-client-decoder` | 46 |  |  |
| `check:upstream-builtin-physics` | 46 |  |  |
| `check:behaviours-b` | 46 |  |  |
| `check:chart-state-server` | 46 |  |  |
| `check:sandbox` | 45 |  |  |
| `check:upstream-tome-bodies` | 45 |  |  |
| `check:consensus` | 44 |  |  |
| `check:clusters` | 44 |  |  |
| `check:network-state` | 44 |  |  |
| `check:editor-serialize` | 43 |  |  |
| `check:physics-integration` | 43 |  |  |
| `check:navmesh-query-spoint` | 43 |  |  |
| `check:material-tier-swap-spoint` | 43 |  |  |
| `check:stall-off-cpu` | 43 |  |  |
| `check:rollback-bridge` | 42 |  |  |
| `check:upstream-builtin-easing` | 42 |  |  |
| `check:app-behaviours` | 42 |  |  |
| `check:cluster-slice` | 42 |  |  |
| `check:sampler-gap-attribution` | 42 |  |  |
| `check:site` | 41 |  |  |
| `check:upstream-builtin-room-routing` | 41 |  |  |
| `check:spawn-named-errors` | 40 |  |  |
| `check:animation` | 40 |  |  |
| `check:upstream-tome-lookup` | 40 |  |  |
| `check:upstream-reference` | 40 |  |  |
| `check:hook-order` | 40 |  |  |
| `check:upstream-builtin-lighting` | 40 |  |  |
| `check:upstream-builtin-spline` | 40 |  |  |
| `check:app-runtime-state` | 40 |  |  |
| `check:crowd-dot-cells-spoint` | 40 |  |  |
| `check:client-pure-spoint` | 40 |  |  |
| `check:spawn-captured-names` | 40 |  |  |
| `check:pool-params-spoint` | 40 |  |  |
| `check:stall-probe` | 40 |  |  |
| `check:minidump` | 40 |  |  |
| `check:relative-residuals` | 40 |  |  |
| `check:rollback-peer` | 39 |  |  |
| `check:upstream-builtins` | 39 |  |  |
| `check:upstream-builtin-three` | 39 |  |  |
| `check:upstream-builtin-voxels` | 39 |  |  |
| `check:player-id` | 39 |  |  |
| `check:camera-rig` | 39 |  |  |
| `check:blend-tree-spoint` | 39 |  |  |
| `check:engine-visibility` | 39 |  |  |
| `check:tick-order` | 38 |  |  |
| `check:relocation-solve` | 38 |  |  |
| `check:upstream-door-dispatch` | 38 |  |  |
| `check:upstream-builtin-env` | 38 |  |  |
| `check:upstream-builtin-path` | 38 |  |  |
| `check:vec3-read` | 38 |  |  |
| `check:spawn-captured-bodies` | 38 |  |  |
| `check:asset-pipeline` | 38 |  |  |
| `check:collider-layers` | 38 |  |  |
| `check:messages` | 37 |  |  |
| `check:hot-reload` | 37 |  |  |
| `check:anticheat` | 37 |  |  |
| `check:tick-scheduler` | 37 |  |  |
| `check:upstream-builtin-vec3` | 37 |  |  |
| `check:upstream-builtin-ballistics` | 37 |  |  |
| `check:upstream-builtin-water` | 37 |  |  |
| `check:chromium-launcher` | 37 |  |  |
| `check:collision-placement` | 37 |  |  |
| `check:upstream-endpoints` | 36 |  |  |
| `check:transport-framing` | 36 |  |  |
| `check:content` | 36 |  |  |
| `check:flight-model` | 36 |  |  |
| `check:upstream-skills` | 36 |  |  |
| `check:upstream-builtin-math` | 36 |  |  |
| `check:upstream-builtin-tween` | 36 |  |  |
| `check:component-pool` | 36 |  |  |
| `check:world-resolver` | 36 |  |  |
| `check:render-1024-visible` | 36 |  |  |
| `check:tail-report` | 36 |  |  |
| `check:upstream-doors` | 35 |  |  |
| `check:upstream-tome` | 35 |  |  |
| `check:heightfield-physics` | 35 |  |  |
| `check:named-asset-redirect` | 35 |  |  |
| `check:reexpress-records` | 35 |  |  |
| `check:browser-heap` | 35 |  |  |
| `check:engine-isolation` | 35 |  |  |
| `check:character-step` | 34 |  |  |
| `check:constraint-limits` | 34 |  |  |
| `check:upstream-builtin-tsl` | 34 |  |  |
| `check:world-def-clusters` | 34 |  |  |
| `check:cube-sphere-cell-key-spoint` | 34 |  |  |
| `check:postfx-shaders-spoint` | 34 |  |  |
| `check:planet-gap-class` | 34 |  |  |
| `check:upstream-builtin-fx` | 33 |  |  |
| `check:upstream-builtin-terrain` | 33 |  |  |
| `check:upstream-builtin-vibe` | 33 |  |  |
| `check:engine-solver-tier` | 33 |  |  |
| `check:movement` | 32 |  |  |
| `check:worker-bridge` | 32 |  |  |
| `check:worker-dispatch` | 32 |  |  |
| `check:upstream-builtin-postfx` | 32 |  |  |
| `check:jolt-limits` | 31 |  |  |
| `check:vehicle-tuning` | 31 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 20. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T16:26:16.997Z. Queue wait 7 s from the push to the first line of the script. Run time 201.3 s for 42 of 42 planned runs.
- engine-core-1024mib-threads.mjs, warmed: 12288 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4, 6); in the steady window alone 12288 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, warmed: 12288 bodies hold the budget at p99 with zero ticks over budget (workers 1, 2, 3, 4, 6); in the steady window alone 12288 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 12288 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 12288 bodies hold it (workers 1, 2, 3, 4, 6).
- cap20480 build of engine-core-1024mib-threads-simd.mjs, warmed: 20480 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4); in the steady window alone 20480 bodies hold it (workers 3, 4, 6).
- cap20480 build of engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 20480 bodies hold it (workers 4).
- Refused by the arena plan: 8 workers (workers-do-not-fit).
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads, warmed | 12288 | 1 | 4 |  | 0.082 | 15.43 | 17.401 | 1 | 8.11 / 8.64 | 16.16 | 17.401 | 1 | 0.076 | 0.209 | 0 | 111963808 | 507775504 | 1453.5 | 949.1 | 5.7 |
| 1024mib-threads, warmed | 12288 | 2 | 4 |  | 0.101 | 13.896 | 17.149 | 1 | 5.84 / 7.39 | 14.863 | 17.149 | 1 | 0.083 | 0.383 | 0 | 111963808 | 507841040 | 1239.5 | 843.6 | 4.3 |
| 1024mib-threads, warmed | 12288 | 3 | 4 |  | 0.081 | 7.829 | 9.273 | 0 | 6.19 / 5.81 | 8.915 | 9.273 | 0 | 0.076 | 0.211 | 0 | 111963808 | 507906576 | 1265.9 | 864.8 | 3.9 |
| 1024mib-threads, warmed | 12288 | 4 | 4 |  | 0.077 | 7.462 | 9.106 | 0 | 5.08 / 4.64 | 8.975 | 9.106 | 0 | 0.076 | 0.106 | 0 | 111963808 | 507972112 | 1279.2 | 835.2 | 3.7 |
| 1024mib-threads, warmed | 12288 | 6 | 4 |  | 0.078 | 8.174 | 9.8 | 0 | 9.31 / 9.22 | 8.254 | 9.8 | 0 | 0.076 | 0.123 | 0 | 111963808 | 508103184 | 1240.9 | 878.3 | 3.8 |
| 1024mib-threads-simd, warmed | 12288 | 1 | 4 |  | 0.08 | 11.606 | 13.177 | 0 | 7.34 / 8.63 | 12.474 | 13.177 | 0 | 0.076 | 0.128 | 0 | 111963808 | 507775504 | 1148.8 | 979.4 | 4.5 |
| 1024mib-threads-simd, warmed | 12288 | 2 | 4 |  | 0.08 | 6.971 | 9.154 | 0 | 4.92 / 4.83 | 7.594 | 9.154 | 0 | 0.076 | 0.169 | 0 | 111963808 | 507841040 | 1252.6 | 832.7 | 3.7 |
| 1024mib-threads-simd, warmed | 12288 | 3 | 4 |  | 0.078 | 6.682 | 7.697 | 0 | 4.8 / 4.36 | 7.326 | 7.697 | 0 | 0.076 | 0.115 | 0 | 111963808 | 507906576 | 1150.6 | 807.1 | 3.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.082 | 6.613 | 8.599 | 0 | 4.88 / 4.67 | 7.931 | 8.599 | 0 | 0.076 | 0.237 | 0 | 111963808 | 507972112 | 1157.5 | 822.8 | 3.4 |
| 1024mib-threads-simd, warmed | 12288 | 6 | 4 |  | 0.077 | 6.424 | 8.275 | 0 | 6.06 / 6.51 | 6.728 | 8.275 | 0 | 0.076 | 0.14 | 0 | 111963808 | 508103184 | 1193.9 | 837.2 | 3.5 |
| 1024mib-threads, cold | 12288 | 1 | 4 |  | 0.077 | 14.906 | 22.551 | 3 | 22.55 / 11.55 | 16.273 | 19.17 | 2 | 0.076 | 0.154 | 0 | 111963808 | 507775504 |  | 815.8 | 3.7 |
| 1024mib-threads, cold | 12288 | 2 | 4 |  | 0.077 | 12.565 | 28.782 | 6 | 28.78 / 17.32 | 20.05 | 25.262 | 4 | 0.076 | 0.111 | 0 | 111963808 | 507841040 |  | 875.1 | 3 |
| 1024mib-threads, cold | 12288 | 3 | 4 |  | 0.079 | 9.021 | 24.905 | 2 | 24.9 / 9.02 | 11.722 | 17.196 | 1 | 0.076 | 0.229 | 0 | 111963808 | 507906576 |  | 927.8 | 2.8 |
| 1024mib-threads, cold | 12288 | 4 | 4 |  | 0.078 | 8.952 | 22.738 | 1 | 22.74 / 11.46 | 11.209 | 14.048 | 0 | 0.075 | 0.119 | 0 | 111963808 | 507972112 |  | 832.3 | 2.5 |
| 1024mib-threads, cold | 12288 | 6 | 4 |  | 0.08 | 9.16 | 33.873 | 1 | 33.87 / 12.31 | 11.207 | 14.678 | 0 | 0.075 | 0.151 | 0 | 111963808 | 508103184 |  | 827 | 2.7 |
| 1024mib-threads-simd, cold | 12288 | 1 | 4 |  | 0.077 | 12.716 | 24.164 | 1 | 24.16 / 11.27 | 13.95 | 15.289 | 0 | 0.076 | 0.119 | 0 | 111963808 | 507775504 |  | 907.2 | 3.4 |
| 1024mib-threads-simd, cold | 12288 | 2 | 4 |  | 0.078 | 8.668 | 22.972 | 1 | 22.97 / 11.88 | 9.101 | 15.709 | 0 | 0.076 | 0.156 | 0 | 111963808 | 507841040 |  | 830.3 | 2.5 |
| 1024mib-threads-simd, cold | 12288 | 3 | 4 |  | 0.077 | 7.692 | 24.846 | 1 | 24.85 / 10.41 | 9.472 | 14.063 | 0 | 0.076 | 0.133 | 0 | 111963808 | 507906576 |  | 897.9 | 2.4 |
| 1024mib-threads-simd, cold | 12288 | 4 | 4 |  | 0.078 | 7.923 | 23 | 2 | 23 / 12.55 | 10.2 | 18.343 | 1 | 0.076 | 0.135 | 0 | 111963808 | 507972112 |  | 849.5 | 2.3 |
| 1024mib-threads-simd, cold | 12288 | 6 | 4 |  | 0.085 | 7.963 | 34.136 | 2 | 34.14 / 10.63 | 10.606 | 20.494 | 1 | 0.077 | 0.253 | 0 | 111963808 | 508103184 |  | 859 | 2.4 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 3 | 4 |  | 0.149 | 7.671 | 8.275 | 0 | 5.22 / 5.69 | 8.025 | 8.275 | 0 | 0.132 | 2.722 | 0 | 145855280 | 550234640 | 1191.3 | 897 | 4.2 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 4 | 4 |  | 0.141 | 6.193 | 7.562 | 0 | 5.13 / 5.87 | 6.439 | 7.562 | 0 | 0.128 | 2.19 | 0 | 145855280 | 550300176 | 1239.6 | 919.1 | 3.9 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 6 | 4 |  | 0.146 | 7.957 | 9.289 | 0 | 6.19 / 6.6 | 8.618 | 9.289 | 0 | 0.13 | 2.939 | 0 | 145855280 | 550431248 | 1210.9 | 839.9 | 4.1 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 3 | 4 |  | 0.17 | 9.416 | 12.068 | 0 | 5.27 / 4.7 | 11.231 | 12.068 | 0 | 0.139 | 7.571 | 0 | 148034352 | 550234640 | 1150.3 | 824 | 4.7 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 4 | 4 |  | 0.179 | 7.36 | 9.703 | 0 | 4.75 / 4.34 | 7.146 | 7.68 | 0 | 0.142 | 7.572 | 0 | 148034352 | 550300176 | 1187.6 | 843 | 4.4 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 6 | 4 |  | 0.187 | 12.478 | 18.717 | 1 | 7.7 / 6.25 | 15.669 | 18.717 | 1 | 0.142 | 6.009 | 0 | 148034352 | 550431248 | 1182.8 | 829.1 | 4.6 |
| cap20480 1024mib-threads-simd, cold | 16384 | 4 | 4 |  | 0.141 | 7.933 | 25.079 | 1 | 25.08 / 12.55 | 9.575 | 12.874 | 0 | 0.128 | 2.3 | 0 | 145855280 | 550300176 |  | 833.2 | 2.7 |
| cap20480 1024mib-threads-simd, cold | 20480 | 4 | 4 |  | 0.164 | 7.02 | 26.985 | 1 | 26.98 / 9.4 | 9.151 | 11.658 | 0 | 0.139 | 5.055 | 0 | 148034352 | 550300176 |  | 832.3 | 3.1 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.08 | 9.603 | 15.528 | 0 | 4.63 / 3.96 | 12.559 | 15.528 | 0 | 0.076 | 0.138 | 0 | 111963808 | 507972112 | 1154.8 | 935.6 | 3.6 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 | warm run 1024x150 | 0.079 | 6.193 | 7.713 | 0 | 5.71 / 5.83 | 7.26 | 7.713 | 0 | 0.076 | 0.211 | 0 | 111963808 | 507972112 | 1008.1 | 815.3 | 3.3 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 | warm run 512x90 | 0.078 | 6.22 | 6.842 | 0 | 4.25 / 4.42 | 6.499 | 6.842 | 0 | 0.076 | 0.16 | 0 | 111963808 | 507972112 | 1003.6 | 945.5 | 3.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.08 | 8.401 | 11.286 | 0 | 4.46 / 4.48 | 9.726 | 11.286 | 0 | 0.076 | 0.116 | 0 | 111963808 | 507972112 | 1171.2 | 824.5 | 3.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 | warm run 1024x150 | 0.078 | 6.349 | 8.313 | 0 | 4.05 / 5.22 | 7.649 | 8.313 | 0 | 0.075 | 0.153 | 0 | 111963808 | 507972112 | 991.2 | 954.5 | 3.3 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 | warm run 512x90 | 0.081 | 5.538 | 6.533 | 0 | 5.09 / 4.67 | 6.082 | 6.533 | 0 | 0.076 | 0.244 | 0 | 111963808 | 507972112 | 940.2 | 824.8 | 3.1 |

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 11.899 | 13.352 | 0 | 0 | 12.378 | 14.414 | 0 | 21 |
| 128 MiB fixed | 1 | schedstat | 11.73 | 13.03 | 0 | 0 | 11.57 | 13.327 | 0 | 20.6 |
| 512 MiB fixed | 1 | schedstat | 9.962 | 12.558 | 0 | 0 | 10.146 | 12.989 | 0 | 16.7 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 9.245 | 10.274 | 0 | 0 | 10 | 12.733 | 0 | 15.3 |

## Physics claim per Kaggle machine class

Written by `node scripts/kaggle/claims.mjs` from the result files of `heclgang/jayzee-physics-goalpost` named below. A row holds when every repeat has zero ticks over 16.7 ms and a p99 at or under it, warmed, 900 ticks, the whole worker tick timed. The unbudgeted reference is the build before the awake budget, with every body awake from tick 0. The class is vendor, family, model and stepping from /proc/cpuinfo.

### AuthenticAMD-23-49-0 (AMD EPYC 7B12)

- Kernel versions: 15. 2 cores, 4 threads, 2249.998 MHz, L2 1 MiB (2 instances), L3 16 MiB (1 instance), avx512 no, cgroup cpu.max 400000 100000.
- Calibration: single thread 502.1 ms, memory chase 167.9 ms, four lanes at once cost 1.017 times one lane.

| bodies | build | workers | repeats | median p99 ms | worst p99 ms | worst max ms | ticks over budget per repeat | repeats with none over | peak awake | last awake tick | holds in every repeat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 12288 | candidate, awake budget 6144 | 4 | 3 | 11.537 | 11.974 | 14.039 | 0, 0, 0 | 3 of 3 | 6144 | 209 | yes |
| 12288 | candidate, awake budget 8192 | 4 | 3 | 15.333 | 16.289 | 23.242 | 0, 1, 7 | 1 of 3 | 8192 | 192 | no |
| 12288 | candidate, awake budget 8192, sleep 0.25 | 4 | 3 | 14.22 | 15.045 | 18.581 | 1, 1, 0 | 1 of 3 | 8192 | 133 | no |
| 12288 | candidate, every body awake | 4 | 3 | 19.658 | 19.874 | 21.563 | 33, 39, 36 | 0 of 3 | 12288 | 144 | no |
| 12288 | candidate, every body awake, asleep 1 | 4 | 3 | 0.118 | 0.123 | 1.013 | 0, 0, 0 | 3 of 3 | 0 | -1 | yes |
| 12288 | candidate, every body awake, sleep 0.15 | 4 | 3 | 16.381 | 16.53 | 18.779 | 5, 6, 6 | 0 of 3 | 12288 | 76 | no |
| 12288 | candidate, every body awake, sleep 0.25 | 4 | 3 | 17.187 | 17.783 | 23.259 | 16, 14, 12 | 0 of 3 | 12288 | 106 | no |
| 12288 | unbudgeted reference | 4 | 3 | 19.896 | 19.913 | 22.248 | 38, 37, 38 | 0 of 3 | 0 | 0 | no |
| 16384 | candidate, awake budget 6144 | 4 | 3 | 11.967 | 12.177 | 13.287 | 0, 0, 0 | 3 of 3 | 6144 | 254 | yes |
| 16384 | candidate, awake budget 8192 | 4 | 3 | 15.356 | 17.613 | 24.513 | 13, 3, 1 | 0 of 3 | 8192 | 200 | no |
| 16384 | candidate, awake budget 8192, sleep 0.25 | 4 | 3 | 15.186 | 15.299 | 21.723 | 1, 4, 0 | 1 of 3 | 8192 | 144 | no |
| 16384 | candidate, every body awake | 4 | 3 | 25.99 | 27.475 | 31.536 | 78, 79, 82 | 0 of 3 | 16384 | 145 | no |
| 16384 | candidate, every body awake, asleep 1 | 4 | 3 | 0.13 | 0.176 | 1.722 | 0, 0, 0 | 3 of 3 | 0 | -1 | yes |
| 16384 | candidate, every body awake, sleep 0.15 | 4 | 3 | 20.876 | 21.103 | 23.648 | 53, 55, 57 | 0 of 3 | 16384 | 76 | no |
| 16384 | candidate, every body awake, sleep 0.25 | 4 | 3 | 21.582 | 22.583 | 24.047 | 60, 60, 62 | 0 of 3 | 16384 | 83 | no |
| 16384 | unbudgeted reference | 4 | 3 | 25.472 | 25.622 | 27.637 | 79, 79, 79 | 0 of 3 | 0 | 0 | no |

### GenuineIntel-6-79-0 (Intel(R) Xeon(R) CPU @ 2.20GHz)

- Kernel versions: 16, 17, 18, 19. 2 cores, 4 threads, 2199.998 MHz, L2 512 KiB (2 instances), L3 55 MiB (1 instance), avx512 no, cgroup cpu.max 400000 100000.
- Calibration: single thread 575.4 ms, memory chase 190.2 ms, four lanes at once cost 1.034 times one lane.

| bodies | build | workers | repeats | median p99 ms | worst p99 ms | worst max ms | ticks over budget per repeat | repeats with none over | peak awake | last awake tick | holds in every repeat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 12288 | candidate, awake budget 4096 | 4 | 9 | 5.842 | 7.321 | 10.455 | 0, 0, 0, 0, 0, 0, 0, 0, 0 | 9 of 9 | 4096 | 262 | yes |
| 12288 | candidate, awake budget 5120 | 4 | 9 | 7.107 | 10.478 | 14.525 | 0, 0, 0, 0, 0, 0, 0, 0, 0 | 9 of 9 | 5120 | 226 | yes |
| 12288 | candidate, awake budget 6144 | 4 | 12 | 8.972 | 13.848 | 21.507 | 0, 1, 2, 0, 0, 0, 1, 0, 0, 3, 0, 0 | 8 of 12 | 6144 | 209 | no |
| 12288 | candidate, every body awake | 1 | 4 | 33.639 | 37.215 | 40.872 | 83, 80, 79, 79 | 0 of 4 | 12288 | 144 | no |
| 12288 | candidate, every body awake | 2 | 4 | 20.492 | 26.212 | 32.239 | 72, 39, 34, 19 | 0 of 4 | 12288 | 144 | no |
| 12288 | candidate, every body awake | 4 | 4 | 15.376 | 17.775 | 22.115 | 16, 0, 0, 1 | 2 of 4 | 12288 | 144 | no |
| 12288 | unbudgeted reference | 4 | 12 | 15.851 | 20.664 | 25.818 | 20, 7, 32, 7, 6, 1, 1, 2, 0, 6, 0, 0 | 3 of 12 | 0 | 0 | no |
| 16384 | candidate, awake budget 4096 | 4 | 9 | 7.137 | 8.769 | 41.945 | 1, 0, 0, 0, 0, 0, 0, 0, 0 | 8 of 9 | 4096 | 350 | no |
| 16384 | candidate, awake budget 5120 | 4 | 9 | 7.121 | 11.098 | 19.815 | 0, 0, 0, 1, 0, 0, 0, 0, 0 | 8 of 9 | 5120 | 293 | no |
| 16384 | candidate, awake budget 6144 | 4 | 12 | 9.035 | 16.377 | 19.58 | 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0 | 11 of 12 | 6144 | 254 | no |
| 16384 | candidate, every body awake | 4 | 4 | 20.913 | 29.94 | 36.75 | 84, 51, 42, 28 | 0 of 4 | 16384 | 145 | no |
| 16384 | unbudgeted reference | 4 | 12 | 21.062 | 28.272 | 39.299 | 75, 73, 85, 60, 41, 37, 46, 62, 50, 28, 19, 29 | 0 of 12 | 0 | 0 | no |
| 20480 | candidate, awake budget 4096 | 4 | 6 | 6.827 | 9.461 | 12.779 | 0, 0, 0, 0, 0, 0 | 6 of 6 | 4096 | 413 | yes |
| 20480 | candidate, awake budget 6144 | 4 | 6 | 14.093 | 22.749 | 35.276 | 6, 0, 25, 0, 0, 0 | 4 of 6 | 6144 | 296 | no |
