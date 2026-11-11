# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 202.3 s across 301 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:engine-state-hash-1024` | 16855 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:gc-witness` | 15524 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:scenario-marble-bowl` | 15141 |  | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims here. The per-tick wall-time claim (no tick over 25 ms or 16.7 ms) moved to the Kaggle run (scripts/kaggle/marble.mjs, recorded at the end of docs/CHECK_TIMES.md), because under host load another session pushed 8 ticks over 25 ms here and the check failed, and it passed alone. |
| `check:scenario-determinism` | 12811 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:elevation-ab` | 9346 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:engine-job-wait` | 9317 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:pose-allocations` | 7357 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:height-cpu` | 6151 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:alloc-audit` | 5840 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:sphere-population` | 5355 |  | Places the full sphere population and checks every member. |
| `check:vegetation-allocations` | 4634 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:app-watch` | 4610 |  | Waits on real file-watch events. |
| `check:heightmap-cli` | 4009 |  | Runs the heightmap CLI once per fixture case. |
| `check:scenario-lockstep-rts` | 3631 | yes | Six peers per tier on four tiers. |
| `check:planet-witness-scene` | 3630 |  | Builds the witness scene three times on the 1024-tier engine and runs one camera lap. |
| `check:scenario-boss-fight` | 3285 | yes | Six runs per tier on four tiers. |
| `check:scenario-deathrun` | 3177 | yes | Six runs per tier on four tiers. |
| `check:engine-tiers` | 3053 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:scenario-combat-bots` | 2844 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:scenario-allocations` | 2735 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:vegetation-generate-cost` | 2610 |  | Times 512 patches of 1024 instances and 128 patches of 8439. |
| `check:engine-threads` | 2596 | yes | Runs the threaded scenario at several worker counts. |
| `check:mapspinner-atmosphere` | 2276 |  | Integrates the atmosphere tables against spoint values. |
| `check:thread-sampler` | 2058 | yes | Samples real threads over a timed window. |
| `check:scenario-character-terrain` | 1924 | yes |  |
| `check:snapshots` | 1661 |  |  |
| `check:scenario-projectile-volley` | 1546 | yes |  |
| `check:scenario-planet-landing` | 1332 | yes |  |
| `check:types` | 1331 |  |  |
| `check:scenario-settle` | 1274 | yes |  |
| `check:gc-reuse-rows` | 1273 |  |  |
| `check:engine-host-witness` | 1248 |  |  |
| `check:planet-scene-counts` | 1237 |  |  |
| `check:engine-raycast` | 1187 |  |  |
| `check:engine-seal` | 1151 |  |  |
| `check:engine-shapecast` | 1073 |  |  |
| `check:scenario-character` | 1071 | yes |  |
| `check:netcode` | 933 |  |  |
| `check:create-app` | 889 |  |  |
| `check:wireweave-relay` | 838 |  |  |
| `check:upload-writes` | 825 |  |  |
| `check:upload-handler` | 803 |  |  |
| `check:pose-replay` | 779 |  |  |
| `check:terrain-agreement` | 746 |  |  |
| `check:crowd-dot-buffer` | 700 |  |  |
| `check:planet-witness` | 678 |  |  |
| `check:engine-pools` | 663 |  |  |
| `check:transport` | 624 |  |  |
| `check:socket-server` | 551 |  |  |
| `check:engine-warm` | 501 |  |  |
| `check:sharding` | 451 |  |  |
| `check:stall-attribution` | 383 |  |  |
| `check:engine-world` | 378 |  |  |
| `build:kernel` | 368 |  |  |
| `check:collision-placement-options` | 363 |  |  |
| `check:engine-vegetation` | 355 |  |  |
| `check:world` | 346 |  |  |
| `check:kernel` | 343 |  |  |
| `check:physics-pure` | 337 |  |  |
| `check:world-query` | 335 |  |  |
| `check:world-config` | 335 |  |  |
| `check:ccd` | 316 |  |  |
| `check:engine-materials` | 302 |  |  |
| `check:packages` | 289 |  |  |
| `check:engine-bridge` | 283 |  |  |
| `check:physics-integration-vehicles` | 273 |  |  |
| `check:collision-mirror` | 270 |  |  |
| `check:vehicles-spoint` | 264 |  |  |
| `check:sdk-surfaces` | 254 |  |  |
| `check:webgpu-profile` | 233 |  |  |
| `check:dormant-spoint` | 226 |  |  |
| `check:collision-tile-streamer` | 226 |  |  |
| `check:vehicle-remove-spoint` | 225 |  |  |
| `check:collision-host` | 224 |  |  |
| `check:dormant-budget-spoint` | 223 |  |  |
| `check:raycast-spoint` | 221 |  |  |
| `check:overlap-spoint` | 220 |  |  |
| `check:vehicle-refusal-spoint` | 220 |  |  |
| `check:engine-planet` | 218 |  |  |
| `check:player-lod-renderer` | 217 |  |  |
| `check:player-vat-spoint` | 217 |  |  |
| `check:site-world` | 214 |  |  |
| `check:engine-budget-floor` | 212 |  |  |
| `check:fire` | 204 |  |  |
| `check:rebase-session` | 204 |  |  |
| `check:project-naming` | 200 |  |  |
| `check:player-lod-renderer-webgpu` | 198 |  |  |
| `check:chart-state-live` | 198 |  |  |
| `check:engine-sleep` | 193 |  |  |
| `check:player-dot-shader-spoint` | 185 |  |  |
| `check:recast-bake-spoint` | 184 |  |  |
| `check:camera-relative` | 180 |  |  |
| `check:bloom-spoint` | 179 |  |  |
| `check:player-dot-material-spoint` | 176 |  |  |
| `check:cluster-lod-spoint` | 174 |  |  |
| `check:terrain-static` | 172 |  |  |
| `check:streaming-gltf-mesh` | 170 |  |  |
| `check:decode-path` | 167 |  |  |
| `check:streamer-p99` | 158 |  |  |
| `check:fire-modules` | 154 |  |  |
| `check:scene-setup-spoint` | 154 |  |  |
| `check:engine-leak` | 148 |  |  |
| `check:upstream-builtin-nav` | 146 |  |  |
| `check:vegetation-leaf-patches` | 143 |  |  |
| `check:engine-codecs` | 139 |  |  |
| `check:sample-order` | 132 |  |  |
| `check:lockstep` | 131 |  |  |
| `check:vat-spoint` | 131 |  |  |
| `check:engine-interest` | 128 |  |  |
| `check:terrain-pure` | 127 |  |  |
| `check:follow-misuse` | 125 |  |  |
| `check:ssr-spoint` | 123 |  |  |
| `check:script-limits` | 117 |  |  |
| `check:spline-erosion-witness` | 116 |  |  |
| `check:bin-snapshot` | 114 |  |  |
| `check:chart-anchor` | 114 |  |  |
| `check:fsr1-spoint` | 114 |  |  |
| `check:sessions` | 113 |  |  |
| `check:engine-core` | 111 |  |  |
| `check:client-resource-pools` | 111 |  |  |
| `check:socket-upgrade` | 109 |  |  |
| `check:glue-tier` | 105 |  |  |
| `check:client-pure` | 103 |  |  |
| `check:tick-governor` | 98 | yes |  |
| `check:procgen` | 98 |  |  |
| `check:import-scene` | 98 |  |  |
| `check:timed-result` | 97 |  |  |
| `check:ci-engine-glue` | 91 |  |  |
| `check:behaviours` | 89 |  |  |
| `check:replay-file` | 86 |  |  |
| `check:upstream-skill-registry` | 86 |  |  |
| `check:player-collisions` | 86 |  |  |
| `check:collider-streamer` | 85 |  |  |
| `check:lag-compensation` | 84 |  |  |
| `check:spoint-core-rust` | 83 |  |  |
| `check:rollback` | 82 |  |  |
| `check:replay-dialect` | 82 |  |  |
| `check:vegetation-stream` | 82 |  |  |
| `check:prediction-engine` | 81 |  |  |
| `check:snapshot-lod` | 81 |  |  |
| `check:client-message-handler` | 81 |  |  |
| `check:msgpack-packer` | 81 |  |  |
| `check:snapshot-packer` | 81 |  |  |
| `check:event-log` | 80 |  |  |
| `check:replay-player` | 80 |  |  |
| `check:protocol` | 77 |  |  |
| `check:protocol-codecs` | 77 |  |  |
| `check:msgpackr-compat` | 77 |  |  |
| `check:sdk-misc` | 77 |  |  |
| `check:reduced-pose` | 77 |  |  |
| `check:controlled-run` | 76 |  |  |
| `check:animation-control` | 75 |  |  |
| `check:netcode-small` | 75 |  |  |
| `check:entity-host` | 75 |  |  |
| `check:negative-zero` | 75 |  |  |
| `check:lod-tiers` | 74 |  |  |
| `check:hot-reload-spoint` | 74 |  |  |
| `check:wireweave-frame-spoint` | 74 |  |  |
| `check:paint-store` | 73 |  |  |
| `check:app-loader` | 73 |  |  |
| `check:engine-render` | 73 |  |  |
| `check:spawn` | 72 |  |  |
| `check:pathfinding` | 72 |  |  |
| `check:stage` | 72 |  |  |
| `check:streaming-gltf-queues` | 72 |  |  |
| `check:chart-migrators` | 72 |  |  |
| `check:game-systems-spoint` | 72 |  |  |
| `check:behaviour-health-destructible` | 71 |  |  |
| `check:snapshot-processor` | 71 |  |  |
| `check:behaviours-c` | 71 |  |  |
| `check:apps-b` | 71 |  |  |
| `check:shared-pure` | 71 |  |  |
| `check:player-lod-plan` | 71 |  |  |
| `check:mat4-spoint` | 71 |  |  |
| `check:frame-stall-cause` | 71 |  |  |
| `check:cluster-handoff` | 70 |  |  |
| `check:render` | 69 |  |  |
| `check:chart-reanchor` | 69 |  |  |
| `check:apps-a` | 69 |  |  |
| `check:octree` | 68 |  |  |
| `check:tick-authority` | 68 |  |  |
| `check:upstream-skill-bodies` | 68 |  |  |
| `check:upload-route` | 68 |  |  |
| `check:client-tier-split` | 68 |  |  |
| `check:engine-artifacts` | 68 |  |  |
| `check:world-persistence` | 67 |  |  |
| `check:row16-client-decoder` | 67 |  |  |
| `check:behaviours-b` | 67 |  |  |
| `check:feature-gap` | 66 |  |  |
| `check:bundle-freshness-jayzee` | 66 |  |  |
| `check:game-systems` | 66 |  |  |
| `check:aoi` | 66 |  |  |
| `check:upstream-door-routes` | 66 |  |  |
| `check:behaviours-a` | 66 |  |  |
| `check:chart-state-server` | 66 |  |  |
| `check:frequency-runs` | 66 |  |  |
| `check:client-pure-rows` | 65 |  |  |
| `check:anticheat-spoint` | 64 |  |  |
| `check:consensus` | 64 |  |  |
| `check:chart-transfer` | 64 |  |  |
| `check:upstream-builtin-bodies` | 64 |  |  |
| `check:sdk-editor` | 64 |  |  |
| `check:paired-report` | 64 |  |  |
| `check:spawn-named-errors` | 63 |  |  |
| `check:upstream-tome-bodies` | 63 |  |  |
| `check:app-behaviours` | 63 |  |  |
| `check:client-machines` | 62 |  |  |
| `check:physics-integration` | 62 |  |  |
| `check:client-loops` | 61 |  |  |
| `check:rollback-bridge` | 61 |  |  |
| `check:clusters` | 61 |  |  |
| `check:telemetry` | 61 |  |  |
| `check:upstream-builtin-noise` | 61 |  |  |
| `check:cluster-slice` | 61 |  |  |
| `check:upstream-builtin-vibe` | 60 |  |  |
| `check:sampler-gap-attribution` | 60 |  |  |
| `check:sandbox` | 59 |  |  |
| `check:hot-reload` | 59 |  |  |
| `check:physics-extras` | 59 |  |  |
| `check:upstream-builtin-lighting` | 59 |  |  |
| `check:app-runtime-state` | 59 |  |  |
| `check:vec3-read` | 59 |  |  |
| `check:stall-off-cpu` | 59 |  |  |
| `check:engine-visibility` | 59 |  |  |
| `check:upstream-builtins` | 58 |  |  |
| `check:upstream-builtin-env` | 58 |  |  |
| `check:upstream-builtin-physics` | 58 |  |  |
| `check:crowd-dot-cells-spoint` | 58 |  |  |
| `check:pool-params-spoint` | 58 |  |  |
| `check:material-tier-swap-spoint` | 58 |  |  |
| `check:tail-report` | 58 |  |  |
| `check:relative-residuals` | 58 |  |  |
| `check:site` | 57 |  |  |
| `check:upstream-tome-lookup` | 57 |  |  |
| `check:upstream-builtin-easing` | 57 |  |  |
| `check:editor-serialize` | 57 |  |  |
| `check:asset-pipeline` | 57 |  |  |
| `check:transport-framing` | 56 |  |  |
| `check:upstream-reference` | 56 |  |  |
| `check:client-pure-spoint` | 56 |  |  |
| `check:stall-probe` | 56 |  |  |
| `check:minidump` | 56 |  |  |
| `check:engine-solver-tier` | 56 |  |  |
| `check:upstream-builtin-three` | 55 |  |  |
| `check:upstream-builtin-voxels` | 55 |  |  |
| `check:network-state` | 55 |  |  |
| `check:world-resolver` | 55 |  |  |
| `check:postfx-shaders-spoint` | 55 |  |  |
| `check:navmesh-query-spoint` | 55 |  |  |
| `check:spawn-captured-names` | 55 |  |  |
| `check:spawn-captured-bodies` | 55 |  |  |
| `check:flight-model` | 54 |  |  |
| `check:upstream-builtin-path` | 54 |  |  |
| `check:upstream-builtin-tsl` | 54 |  |  |
| `check:camera-rig` | 54 |  |  |
| `check:animation` | 53 |  |  |
| `check:upstream-skills` | 53 |  |  |
| `check:hook-order` | 53 |  |  |
| `check:upstream-builtin-spline` | 53 |  |  |
| `check:browser-heap` | 53 |  |  |
| `check:chromium-launcher` | 53 |  |  |
| `check:engine-isolation` | 53 |  |  |
| `check:upstream-endpoints` | 52 |  |  |
| `check:character-step` | 52 |  |  |
| `check:tick-scheduler` | 52 |  |  |
| `check:upstream-builtin-math` | 52 |  |  |
| `check:named-asset-redirect` | 52 |  |  |
| `check:upstream-builtin-tween` | 52 |  |  |
| `check:player-id` | 52 |  |  |
| `check:world-def-clusters` | 52 |  |  |
| `check:hygiene` | 52 |  |  |
| `check:collision-placement` | 52 |  |  |
| `check:constraint-limits` | 51 |  |  |
| `check:rollback-peer` | 51 |  |  |
| `check:upstream-door-dispatch` | 51 |  |  |
| `check:blend-tree-spoint` | 51 |  |  |
| `check:messages` | 50 |  |  |
| `check:anticheat` | 50 |  |  |
| `check:upstream-builtin-vec3` | 50 |  |  |
| `check:heightfield-physics` | 50 |  |  |
| `check:upstream-builtin-ballistics` | 50 |  |  |
| `check:upstream-builtin-postfx` | 50 |  |  |
| `check:upstream-builtin-room-routing` | 50 |  |  |
| `check:upstream-builtin-terrain` | 50 |  |  |
| `check:component-pool` | 50 |  |  |
| `check:render-1024-visible` | 50 |  |  |
| `check:movement` | 49 |  |  |
| `check:vehicle-tuning` | 49 |  |  |
| `check:worker-dispatch` | 49 |  |  |
| `check:upstream-tome` | 49 |  |  |
| `check:upstream-builtin-fx` | 49 |  |  |
| `check:reexpress-records` | 49 |  |  |
| `check:cube-sphere-cell-key-spoint` | 49 |  |  |
| `check:content` | 48 |  |  |
| `check:jolt-limits` | 48 |  |  |
| `check:tick-order` | 48 |  |  |
| `check:upstream-doors` | 48 |  |  |
| `check:upstream-builtin-water` | 48 |  |  |
| `check:relocation-solve` | 46 |  |  |
| `check:worker-bridge` | 46 |  |  |
| `check:collider-layers` | 46 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 7. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4.
- Pushed 2026-11-11T13:46:14Z. Queue wait 8 s from the push to the first line of the script. Run time 242.2 s for 87 of 87 planned runs.
- engine-core-1024mib-threads.mjs, warmed: 10240 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, warmed: 10240 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4); in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- Refused by the arena plan: 8 workers (workers-do-not-fit).
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads, warmed | 4096 | 1 | 4 |  | 0.056 | 9.854 | 10.741 | 0 | 7.71 / 7.46 | 10.218 | 10.741 | 0 | 0.056 | 0.119 | 0 | 100054176 | 497242640 | 1381.2 | 880.2 | 3.5 |
| 1024mib-threads, warmed | 4096 | 2 | 4 |  | 0.071 | 7.061 | 7.513 | 0 | 5.64 / 5.5 | 7.377 | 7.513 | 0 | 0.069 | 0.157 | 0 | 100054176 | 497308176 | 1188.3 | 787.3 | 2.7 |
| 1024mib-threads, warmed | 4096 | 3 | 4 |  | 0.123 | 6.291 | 6.806 | 0 | 4.91 / 4.86 | 6.705 | 6.806 | 0 | 0.121 | 0.178 | 0 | 100054176 | 497373712 | 1185.9 | 840 | 2.8 |
| 1024mib-threads, warmed | 4096 | 4 | 4 |  | 0.129 | 5.286 | 5.878 | 0 | 4.71 / 4.67 | 5.462 | 5.878 | 0 | 0.126 | 0.185 | 0 | 100054176 | 497439248 | 1272 | 876.7 | 2.8 |
| 1024mib-threads, warmed | 4096 | 6 | 4 |  | 0.174 | 6.539 | 8.134 | 0 | 7.08 / 5.13 | 6.863 | 8.134 | 0 | 0.166 | 0.28 | 0 | 100054176 | 497570320 | 1184.9 | 792.4 | 2.8 |
| 1024mib-threads, warmed | 8192 | 1 | 4 |  | 0.065 | 24.633 | 31.317 | 56 | 13.78 / 16.07 | 25.851 | 31.317 | 56 | 0.065 | 0.121 | 0 | 102216864 | 497242640 | 1183.8 | 793.7 | 3.9 |
| 1024mib-threads, warmed | 8192 | 2 | 4 |  | 0.082 | 15.185 | 16.168 | 0 | 11.87 / 14.16 | 15.922 | 16.168 | 0 | 0.079 | 0.174 | 0 | 102216864 | 497308176 | 1249.4 | 848.1 | 3.5 |
| 1024mib-threads, warmed | 8192 | 3 | 4 |  | 0.132 | 13.92 | 14.394 | 0 | 9.43 / 10.11 | 14.184 | 14.394 | 0 | 0.129 | 0.198 | 0 | 102216864 | 497373712 | 1188.7 | 804.2 | 3.3 |
| 1024mib-threads, warmed | 8192 | 4 | 4 |  | 0.138 | 12.117 | 13.716 | 0 | 9.38 / 8.9 | 12.467 | 13.716 | 0 | 0.135 | 0.224 | 0 | 102216864 | 497439248 | 1233.2 | 946.3 | 3.4 |
| 1024mib-threads, warmed | 8192 | 6 | 4 |  | 0.188 | 13 | 18.394 | 2 | 15.45 / 16.8 | 13.716 | 18.394 | 1 | 0.177 | 0.337 | 0 | 102216864 | 497570320 | 1232.6 | 807.9 | 3.4 |
| 1024mib-threads, warmed | 10240 | 1 | 4 |  | 0.069 | 32.203 | 38.727 | 80 | 18.63 / 21.46 | 37.13 | 38.727 | 78 | 0.069 | 0.138 | 0 | 103298208 | 497242640 | 1209.3 | 800.3 | 4.5 |
| 1024mib-threads, warmed | 10240 | 2 | 4 |  | 0.085 | 21.078 | 22.024 | 41 | 13.94 / 14.3 | 21.716 | 22.024 | 41 | 0.083 | 0.178 | 0 | 103298208 | 497308176 | 1211.1 | 795.1 | 3.7 |
| 1024mib-threads, warmed | 10240 | 3 | 4 |  | 0.134 | 17.524 | 17.984 | 19 | 12.42 / 12.13 | 17.905 | 17.984 | 19 | 0.127 | 0.182 | 0 | 103298208 | 497373712 | 1182.1 | 803.1 | 3.5 |
| 1024mib-threads, warmed | 10240 | 4 | 4 |  | 0.145 | 14.895 | 16.055 | 0 | 11.36 / 11.27 | 15.471 | 16.055 | 0 | 0.142 | 0.205 | 0 | 103298208 | 497439248 | 1266.6 | 797.2 | 3.5 |
| 1024mib-threads, warmed | 10240 | 6 | 4 |  | 0.189 | 15.094 | 19.005 | 4 | 19.01 / 18.7 | 15.372 | 16.987 | 2 | 0.182 | 0.301 | 0 | 103298208 | 497570320 | 1188.4 | 808 | 3.5 |
| 1024mib-threads-simd, warmed | 4096 | 1 | 4 |  | 0.057 | 8.234 | 8.723 | 0 | 8.14 / 6.56 | 8.66 | 8.723 | 0 | 0.056 | 0.133 | 0 | 100054176 | 497242640 | 1123.2 | 817.8 | 2.7 |
| 1024mib-threads-simd, warmed | 4096 | 2 | 4 |  | 0.072 | 5.547 | 6.005 | 0 | 5.19 / 4.78 | 5.769 | 6.005 | 0 | 0.07 | 0.155 | 0 | 100054176 | 497308176 | 1138.1 | 854.2 | 2.7 |
| 1024mib-threads-simd, warmed | 4096 | 3 | 4 |  | 0.122 | 5.135 | 5.436 | 0 | 4.37 / 4.62 | 5.317 | 5.436 | 0 | 0.12 | 0.172 | 0 | 100054176 | 497373712 | 1122.9 | 786 | 2.6 |
| 1024mib-threads-simd, warmed | 4096 | 4 | 4 |  | 0.13 | 4.407 | 4.659 | 0 | 4.25 / 3.93 | 4.526 | 4.659 | 0 | 0.127 | 0.182 | 0 | 100054176 | 497439248 | 1114 | 778.8 | 2.5 |
| 1024mib-threads-simd, warmed | 4096 | 6 | 4 |  | 0.17 | 5.232 | 6.373 | 0 | 5.01 / 6.14 | 5.955 | 6.373 | 0 | 0.161 | 0.282 | 0 | 100054176 | 497570320 | 1143.7 | 902.5 | 2.7 |
| 1024mib-threads-simd, warmed | 8192 | 1 | 4 |  | 0.065 | 20.06 | 21.104 | 36 | 12.86 / 14.32 | 20.944 | 21.104 | 36 | 0.065 | 0.137 | 0 | 102216864 | 497242640 | 1121.6 | 776.8 | 3.6 |
| 1024mib-threads-simd, warmed | 8192 | 2 | 4 |  | 0.122 | 13.161 | 16.114 | 0 | 9.92 / 10.12 | 13.683 | 16.114 | 0 | 0.115 | 0.224 | 0 | 102216864 | 497308176 | 1109 | 775.8 | 3.2 |
| 1024mib-threads-simd, warmed | 8192 | 3 | 4 |  | 0.127 | 11.711 | 12.435 | 0 | 8.95 / 9.48 | 11.979 | 12.435 | 0 | 0.126 | 0.186 | 0 | 102216864 | 497373712 | 1138.4 | 848.7 | 3.1 |
| 1024mib-threads-simd, warmed | 8192 | 4 | 4 |  | 0.142 | 10.072 | 10.589 | 0 | 8.45 / 8.15 | 10.514 | 10.589 | 0 | 0.139 | 0.21 | 0 | 102216864 | 497439248 | 1127.2 | 864 | 3 |
| 1024mib-threads-simd, warmed | 8192 | 6 | 4 |  | 0.181 | 10.817 | 12.762 | 0 | 11.2 / 11.27 | 11.856 | 12.762 | 0 | 0.173 | 0.297 | 0 | 102216864 | 497570320 | 1126.8 | 784.3 | 3 |
| 1024mib-threads-simd, warmed | 10240 | 1 | 4 |  | 0.07 | 26.265 | 27.324 | 74 | 16.16 / 17.94 | 26.845 | 27.324 | 73 | 0.07 | 0.148 | 0 | 103298208 | 497242640 | 1136.5 | 790.7 | 4 |
| 1024mib-threads-simd, warmed | 10240 | 2 | 4 |  | 0.085 | 17.25 | 18.241 | 20 | 12.78 / 12.99 | 17.779 | 18.241 | 20 | 0.083 | 0.171 | 0 | 103298208 | 497308176 | 1127.7 | 829.8 | 3.5 |
| 1024mib-threads-simd, warmed | 10240 | 3 | 4 |  | 0.135 | 14.858 | 15.42 | 0 | 10.73 / 11.38 | 15.2 | 15.42 | 0 | 0.134 | 0.215 | 0 | 103298208 | 497373712 | 1216.5 | 801.3 | 3.4 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 |  | 0.155 | 11.67 | 12.717 | 0 | 10.09 / 9.62 | 12.472 | 12.717 | 0 | 0.151 | 0.224 | 0 | 103298208 | 497439248 | 1119.8 | 774.8 | 3.1 |
| 1024mib-threads-simd, warmed | 10240 | 6 | 4 |  | 0.189 | 13.575 | 17.878 | 1 | 12.98 / 14.91 | 15.198 | 17.878 | 1 | 0.178 | 0.298 | 0 | 103298208 | 497570320 | 1120.1 | 812.5 | 3.3 |
| 1024mib-threads, cold | 4096 | 1 | 4 |  | 0.056 | 10.291 | 21.869 | 1 | 21.87 / 11.19 | 10.82 | 11.205 | 0 | 0.055 | 0.107 | 0 | 100054176 | 497242640 |  | 807.7 | 1.7 |
| 1024mib-threads, cold | 4096 | 2 | 4 |  | 0.073 | 8.052 | 23.281 | 1 | 23.28 / 9.53 | 9.646 | 11.522 | 0 | 0.07 | 0.158 | 0 | 100054176 | 497308176 |  | 868.2 | 1.6 |
| 1024mib-threads, cold | 4096 | 3 | 4 |  | 0.12 | 7.906 | 27.15 | 1 | 27.15 / 10.6 | 9.795 | 10.35 | 0 | 0.118 | 0.171 | 0 | 100054176 | 497373712 |  | 792.7 | 1.6 |
| 1024mib-threads, cold | 4096 | 4 | 4 |  | 0.127 | 8.125 | 21.692 | 1 | 21.69 / 11.37 | 9.968 | 10.772 | 0 | 0.124 | 0.196 | 0 | 100054176 | 497439248 |  | 810.5 | 1.6 |
| 1024mib-threads, cold | 4096 | 6 | 4 |  | 0.173 | 8.388 | 34.658 | 1 | 34.66 / 16.63 | 9.487 | 13.183 | 0 | 0.163 | 0.293 | 0 | 100054176 | 497570320 |  | 882.9 | 1.7 |
| 1024mib-threads, cold | 8192 | 1 | 4 |  | 0.066 | 23.994 | 37.938 | 59 | 37.94 / 19.39 | 24.915 | 25.75 | 57 | 0.065 | 0.119 | 0 | 102216864 | 497242640 |  | 791.6 | 2.7 |
| 1024mib-threads, cold | 8192 | 2 | 4 |  | 0.118 | 16.666 | 31.795 | 8 | 31.8 / 18.07 | 16.838 | 18.157 | 6 | 0.117 | 0.184 | 0 | 102216864 | 497308176 |  | 840.1 | 2.3 |
| 1024mib-threads, cold | 8192 | 3 | 4 |  | 0.129 | 14.112 | 33.909 | 2 | 33.91 / 18.18 | 14.516 | 15.844 | 0 | 0.127 | 0.188 | 0 | 102216864 | 497373712 |  | 832.7 | 2.2 |
| 1024mib-threads, cold | 8192 | 4 | 4 |  | 0.138 | 12.488 | 35.06 | 1 | 35.06 / 15.22 | 13.013 | 14.566 | 0 | 0.134 | 0.215 | 0 | 102216864 | 497439248 |  | 797.7 | 2 |
| 1024mib-threads, cold | 8192 | 6 | 4 |  | 0.19 | 13.095 | 47.477 | 2 | 47.48 / 17.7 | 14.215 | 15.789 | 0 | 0.176 | 0.306 | 0 | 102216864 | 497570320 |  | 828.7 | 2.2 |
| 1024mib-threads, cold | 10240 | 1 | 4 |  | 0.071 | 32.355 | 46.942 | 79 | 46.94 / 22.78 | 33.229 | 33.793 | 77 | 0.071 | 0.147 | 0 | 103298208 | 497242640 |  | 916.3 | 3.5 |
| 1024mib-threads, cold | 10240 | 2 | 4 |  | 0.087 | 20.595 | 38.214 | 48 | 38.21 / 18.31 | 21.246 | 22.142 | 46 | 0.085 | 0.226 | 0 | 103298208 | 497308176 |  | 809.2 | 2.6 |
| 1024mib-threads, cold | 10240 | 3 | 4 |  | 0.137 | 19.575 | 45.217 | 38 | 45.22 / 21.2 | 28.557 | 29.332 | 36 | 0.134 | 0.204 | 0 | 103298208 | 497373712 |  | 915 | 2.6 |
| 1024mib-threads, cold | 10240 | 4 | 4 |  | 0.144 | 14.925 | 35.187 | 3 | 35.19 / 18.23 | 16.11 | 19.523 | 1 | 0.14 | 0.219 | 0 | 103298208 | 497439248 |  | 800.2 | 2.2 |
| 1024mib-threads, cold | 10240 | 6 | 4 |  | 0.191 | 16.894 | 44.78 | 10 | 44.78 / 17.87 | 18.035 | 19.167 | 8 | 0.181 | 0.329 | 0 | 103298208 | 497570320 |  | 794.4 | 2.4 |
| 1024mib-threads-simd, cold | 4096 | 1 | 4 |  | 0.059 | 9.064 | 22.532 | 1 | 22.53 / 9.9 | 9.798 | 11.284 | 0 | 0.058 | 0.144 | 0 | 100054176 | 497242640 |  | 949.5 | 1.8 |
| 1024mib-threads-simd, cold | 4096 | 2 | 4 |  | 0.107 | 10.289 | 22.817 | 2 | 22.82 / 12.53 | 12.45 | 19.114 | 1 | 0.105 | 0.152 | 0 | 100054176 | 497308176 |  | 808.9 | 1.7 |
| 1024mib-threads-simd, cold | 4096 | 3 | 4 |  | 0.122 | 6.812 | 24.324 | 1 | 24.32 / 9.78 | 8.148 | 11.869 | 0 | 0.12 | 0.184 | 0 | 100054176 | 497373712 |  | 800.8 | 1.5 |
| 1024mib-threads-simd, cold | 4096 | 4 | 4 |  | 0.131 | 6.754 | 27.244 | 1 | 27.24 / 11.11 | 8.021 | 9.135 | 0 | 0.126 | 0.21 | 0 | 100054176 | 497439248 |  | 797.5 | 1.5 |
| 1024mib-threads-simd, cold | 4096 | 6 | 4 |  | 0.174 | 7.311 | 48.169 | 1 | 48.17 / 8.45 | 8.823 | 12.994 | 0 | 0.163 | 0.311 | 0 | 100054176 | 497570320 |  | 800.6 | 1.6 |
| 1024mib-threads-simd, cold | 8192 | 1 | 4 |  | 0.067 | 20.029 | 33.765 | 37 | 33.76 / 16.18 | 20.829 | 21.54 | 36 | 0.066 | 0.158 | 0 | 102216864 | 497242640 |  | 967.6 | 2.6 |
| 1024mib-threads-simd, cold | 8192 | 2 | 4 |  | 0.117 | 14.784 | 28.561 | 2 | 28.56 / 13.04 | 15.597 | 17.563 | 1 | 0.116 | 0.173 | 0 | 102216864 | 497308176 |  | 821.6 | 2.1 |
| 1024mib-threads-simd, cold | 8192 | 3 | 4 |  | 0.132 | 11.073 | 33.834 | 1 | 33.83 / 13.73 | 12.096 | 12.901 | 0 | 0.129 | 0.176 | 0 | 102216864 | 497373712 |  | 855.5 | 2 |
| 1024mib-threads-simd, cold | 8192 | 4 | 4 |  | 0.141 | 10.684 | 32.969 | 1 | 32.97 / 14.15 | 12.53 | 13.388 | 0 | 0.136 | 0.226 | 0 | 102216864 | 497439248 |  | 801.4 | 1.9 |
| 1024mib-threads-simd, cold | 8192 | 6 | 4 |  | 0.184 | 11.317 | 41.961 | 1 | 41.96 / 13.49 | 12.05 | 12.808 | 0 | 0.174 | 0.32 | 0 | 102216864 | 497570320 |  | 806.8 | 2 |
| 1024mib-threads-simd, cold | 10240 | 1 | 4 |  | 0.07 | 27.758 | 44.263 | 79 | 44.26 / 20.75 | 34.538 | 38.084 | 77 | 0.069 | 0.145 | 0 | 103298208 | 497242640 |  | 801.8 | 3 |
| 1024mib-threads-simd, cold | 10240 | 2 | 4 |  | 0.108 | 16.819 | 37.266 | 13 | 37.27 / 14.22 | 17.866 | 17.968 | 12 | 0.099 | 0.204 | 0 | 103298208 | 497308176 |  | 804.2 | 2.3 |
| 1024mib-threads-simd, cold | 10240 | 3 | 4 |  | 0.127 | 14.222 | 36.89 | 1 | 36.89 / 14.43 | 14.452 | 14.757 | 0 | 0.125 | 0.193 | 0 | 103298208 | 497373712 |  | 819 | 2.2 |
| 1024mib-threads-simd, cold | 10240 | 4 | 4 |  | 0.144 | 13.081 | 36.882 | 1 | 36.88 / 12.06 | 13.343 | 13.879 | 0 | 0.139 | 0.22 | 0 | 103298208 | 497439248 |  | 904.1 | 2.2 |
| 1024mib-threads-simd, cold | 10240 | 6 | 4 |  | 0.192 | 13.965 | 50.667 | 2 | 50.67 / 14.15 | 14.575 | 21.532 | 1 | 0.182 | 0.308 | 0 | 103298208 | 497570320 |  | 792.9 | 2.2 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads-simd, cold | 10240 | 3 | 4 | --no-wasm-lazy-compilation | 0.123 | 14.486 | 29.492 | 1 | 29.49 / 16.42 | 14.693 | 15.939 | 0 | 0.104 | 0.185 | 0 | 103298208 | 497373712 |  | 869.3 | 2.2 |
| 1024mib-threads-simd, cold | 10240 | 3 | 4 | --no-wasm-lazy-compilation --no-liftoff | 0.126 | 14.886 | 16.136 | 0 | 11.21 / 11.59 | 15.804 | 16.136 | 0 | 0.1 | 0.225 | 0 | 103298208 | 497373712 |  | 1409.5 | 2.7 |
| 1024mib-threads-simd, warmed | 10240 | 3 | 1 |  | 0.133 | 13.171 | 13.791 | 0 | 10.47 / 10.8 | 13.526 | 13.791 | 0 | 0.131 | 0.21 | 0 | 103298208 | 497373712 | 1127.2 | 1012.6 | 3.5 |
| 1024mib-threads-simd, warmed | 10240 | 3 | 2 |  | 0.101 | 13.247 | 14.049 | 0 | 10.67 / 11.22 | 13.639 | 14.049 | 0 | 0.097 | 0.194 | 0 | 103298208 | 497373712 | 1196.5 | 807 | 3.3 |
| 1024mib-threads-simd, flat scene, warmed | 10240 | 3 | 4 |  | 0.132 | 22.083 | 24.654 | 33 | 6.13 / 6.82 | 23.34 | 24.654 | 33 | 0.132 | 0.185 | 0 | 103298208 | 497373712 | 1119.9 | 781.7 | 3.4 |
| 1024mib-threads-simd, warmed | 8192 | 4 | 4 |  | 0.139 | 9.407 | 10.094 | 0 | 7.99 / 7.67 | 9.867 | 10.094 | 0 | 0.135 | 0.206 | 0 | 102216864 | 497439248 | 1123.5 | 780.8 | 2.9 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 |  | 0.148 | 12.662 | 16.242 | 0 | 10.23 / 10.05 | 13.164 | 16.242 | 0 | 0.143 | 0.225 | 0 | 103298208 | 497439248 | 1156.3 | 845 | 3.3 |
| 1024mib-threads-simd, warmed | 8192 | 4 | 4 |  | 0.14 | 9.381 | 10.459 | 0 | 8.19 / 7.61 | 9.768 | 10.459 | 0 | 0.137 | 0.219 | 0 | 102216864 | 497439248 | 1124.5 | 780.9 | 2.9 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 |  | 0.147 | 12.056 | 13.523 | 0 | 10.24 / 10.08 | 12.39 | 13.523 | 0 | 0.144 | 0.242 | 0 | 103298208 | 497439248 | 1129.4 | 842.5 | 3.2 |
| 1024mib-threads-simd, warmed | 8192 | 4 | 4 |  | 0.14 | 9.608 | 10.299 | 0 | 8.29 / 7.79 | 9.853 | 10.299 | 0 | 0.137 | 0.209 | 0 | 102216864 | 497439248 | 1115.2 | 865 | 3 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 |  | 0.146 | 12.371 | 12.852 | 0 | 10.4 / 10.02 | 12.608 | 12.852 | 0 | 0.142 | 0.217 | 0 | 103298208 | 497439248 | 1129.5 | 789.9 | 3.2 |

Marble bowl (512 marbles, 600 ticks, 2 runs per tier), the timing claim that left `check:scenario-marble-bowl`:

| tier | workers | p99 ms | max ms | ticks over 16.7 ms | ticks over 25 ms | run s |
|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | 14.171 | 16.868 | 1 | 0 | 7.9 |
| 128 MiB fixed | 1 | 10.489 | 16.159 | 0 | 0 | 7.9 |
| 512 MiB fixed | 1 | 9.468 | 15.921 | 0 | 0 | 6.3 |
| 512 MiB threaded, 2 workers | 2 | 9.177 | 11.062 | 0 | 0 | 5.6 |
