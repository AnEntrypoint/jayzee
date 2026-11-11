# Check times

Written by `npm test -- --write-times` from `build/checks/timings.json`, the last wall time of each check on this host. A check over 2 s carries its reason from `scripts/test-slow-reasons.json`.

Sum of the checks: 229.3 s across 302 entries. The checks run four at a time, so the wall time of a full run is lower; the runner prints it.

| check | wall ms | serial | reason when over 2 s |
|---|---|---|---|
| `check:gc-witness` | 21158 |  | 20000 measured ticks and 20000 control ticks under a GC observer. The count is the claim, so the ticks stay. |
| `check:scenario-marble-bowl` | 18180 | yes | 512 marbles for 600 ticks, twice, on four tiers. Containment, settling and bit-for-bit agreement are the claims, with a bound of 25 ms of main-thread CPU time per tick on the single-threaded tiers. The 16.7 ms budget and the threaded tier are judged in the Kaggle regression run (scripts/kaggle/marble.mjs): wall time failed here under host load, and on a threaded tier the main thread spins while starved workers catch up, so its CPU time rose to 29.5 ms in a loaded full run. |
| `check:engine-state-hash-1024` | 17155 | yes | Five isolated 1024-tier runs of 120 ticks (fixed, and 2, 4, 7, 8 workers). They now run at the same time; before, they ran one after another and the 4-worker run was done twice (29 s). |
| `check:pose-allocations` | 14716 |  | 2000 warm-up frames of the 1024-player threaded tick on the planet-surface scene, the spawn the render witness uses, at about 4 ms a frame. On the flat scene the bodies fall off the ground box under planet gravity and never sleep, so each frame costs about 20 ms and the same warm-up takes 88 s. With 300 or 700 warm-up frames the sampler still sees one-off function-level allocations (10128 B and 1224 B) from V8 tier-up, so the warm-up cannot be shortened without a false failure. Counted frames are sampled per allocation. |
| `check:elevation-ab` | 14343 |  | Runs spoint A/B elevation script at the fixture N and compares its output line for line. |
| `check:scenario-determinism` | 10923 | yes | 64 child runs: eight scenarios on the fixed build and the threaded build at 2 and 4 workers, for two build pairs. |
| `check:height-cpu` | 9810 |  | Evaluates every spoint height fixture sample to 1e-12. |
| `check:engine-job-wait` | 8884 | yes | Five runs of 300 ticks of 1200 bodies in 100 piles: fixed, and 2 and 4 workers twice each. |
| `check:sphere-population` | 6984 |  | Places the full sphere population and checks every member. |
| `check:alloc-audit` | 6103 |  | Sixteen rows of 50,000 calls each under a 1 MiB semi-space. |
| `check:app-watch` | 4638 |  | Waits on real file-watch events. |
| `check:heightmap-cli` | 4398 |  | Runs the heightmap CLI once per fixture case. |
| `check:vegetation-allocations` | 4078 | yes | 6000 warm-up frames before the sampled window; at 2000 the compile of the gate function landed inside the window. |
| `check:engine-tiers` | 3705 |  | The settle row spawns 10240 bodies at the scene spacing (1.2 m, above the 1.0 m diameter) and steps 360 ticks, so the counted window covers the fall and the sleep. At 0.6 m spacing the bodies overlapped and the same row took 62 s, and that overlap case is no longer covered by this gate. |
| `check:scenario-deathrun` | 3356 | yes | Six runs per tier on four tiers. |
| `check:planet-witness-scene` | 3101 |  | Builds the witness scene three times on the 1024-tier engine and runs one camera lap. |
| `check:scenario-lockstep-rts` | 3083 | yes | Six peers per tier on four tiers. |
| `check:scenario-combat-bots` | 3065 | yes | Two runs on four tiers, with the duel and its wall and ridge controls. |
| `check:project-naming` | 2999 |  | NO REASON RECORDED |
| `check:scenario-boss-fight` | 2927 | yes | Six runs per tier on four tiers. |
| `check:mapspinner-atmosphere` | 2604 |  | Integrates the atmosphere tables against spoint values. |
| `check:scenario-allocations` | 2559 | yes | 30000 warm-up ticks per loop, one loop per process. |
| `check:vegetation-generate-cost` | 2469 |  | Times 512 patches of 1024 instances and 128 patches of 8439. |
| `check:engine-threads` | 2459 | yes | Runs the threaded scenario at several worker counts. |
| `check:thread-sampler` | 2086 | yes | Samples real threads over a timed window. |
| `check:snapshots` | 2044 |  | Encodes and decodes the delta history at full depth. |
| `check:types` | 1883 |  |  |
| `check:scenario-character-terrain` | 1749 | yes |  |
| `check:gc-reuse-rows` | 1600 |  |  |
| `check:scenario-projectile-volley` | 1533 | yes |  |
| `build:kernel` | 1340 |  |  |
| `check:scenario-planet-landing` | 1318 | yes |  |
| `check:scenario-settle` | 1295 | yes |  |
| `check:engine-shapecast` | 1254 |  |  |
| `check:planet-scene-counts` | 1196 |  |  |
| `check:engine-raycast` | 1126 |  |  |
| `check:engine-seal` | 1095 |  |  |
| `check:scenario-character` | 1007 | yes |  |
| `check:create-app` | 990 |  |  |
| `check:wireweave-relay` | 989 |  |  |
| `check:engine-host-witness` | 896 |  |  |
| `check:upload-writes` | 863 |  |  |
| `check:netcode` | 838 |  |  |
| `check:crowd-dot-buffer` | 768 |  |  |
| `check:transport` | 757 |  |  |
| `check:planet-witness` | 715 |  |  |
| `check:upload-handler` | 695 |  |  |
| `check:pose-replay` | 669 |  |  |
| `check:terrain-agreement` | 668 |  |  |
| `check:engine-pools` | 611 |  |  |
| `check:socket-server` | 571 |  |  |
| `check:engine-warm` | 454 |  |  |
| `check:stall-attribution` | 368 |  |  |
| `check:collision-placement-options` | 353 |  |  |
| `check:physics-integration-vehicles` | 338 |  |  |
| `check:sharding` | 326 |  |  |
| `check:physics-pure` | 325 |  |  |
| `check:fire` | 310 |  |  |
| `check:packages` | 308 |  |  |
| `check:engine-world` | 304 |  |  |
| `check:world-query` | 300 |  |  |
| `check:engine-vegetation` | 295 |  |  |
| `check:ccd` | 290 |  |  |
| `check:world` | 277 |  |  |
| `check:engine-materials` | 276 |  |  |
| `check:kernel` | 273 |  |  |
| `check:collision-mirror` | 270 |  |  |
| `check:site-world` | 265 |  |  |
| `check:world-config` | 258 |  |  |
| `check:collision-tile-streamer` | 250 |  |  |
| `check:vehicle-refusal-spoint` | 238 |  |  |
| `check:sdk-surfaces` | 237 |  |  |
| `check:vehicles-spoint` | 232 |  |  |
| `check:webgpu-profile` | 220 |  |  |
| `check:dormant-spoint` | 214 |  |  |
| `check:overlap-spoint` | 211 |  |  |
| `check:chart-state-live` | 211 |  |  |
| `check:engine-budget-floor` | 210 |  |  |
| `check:dormant-budget-spoint` | 206 |  |  |
| `check:engine-planet` | 204 |  |  |
| `check:engine-bridge` | 200 |  |  |
| `check:player-vat-spoint` | 191 |  |  |
| `check:rebase-session` | 190 |  |  |
| `check:engine-sleep` | 190 |  |  |
| `check:upstream-builtin-nav` | 186 |  |  |
| `check:player-lod-renderer` | 185 |  |  |
| `check:collision-host` | 184 |  |  |
| `check:vehicle-remove-spoint` | 184 |  |  |
| `check:raycast-spoint` | 183 |  |  |
| `check:player-dot-material-spoint` | 183 |  |  |
| `check:streaming-gltf-mesh` | 181 |  |  |
| `check:player-dot-shader-spoint` | 177 |  |  |
| `check:player-lod-renderer-webgpu` | 175 |  |  |
| `check:recast-bake-spoint` | 175 |  |  |
| `check:terrain-static` | 173 |  |  |
| `check:decode-path` | 173 |  |  |
| `check:streamer-p99` | 157 |  |  |
| `check:scene-setup-spoint` | 153 |  |  |
| `check:bloom-spoint` | 153 |  |  |
| `check:cluster-lod-spoint` | 148 |  |  |
| `check:camera-relative` | 145 |  |  |
| `check:vegetation-leaf-patches` | 145 |  |  |
| `check:lockstep` | 138 |  |  |
| `check:engine-codecs` | 137 |  |  |
| `check:engine-leak` | 137 |  |  |
| `check:follow-misuse` | 135 |  |  |
| `check:ssr-spoint` | 128 |  |  |
| `check:fire-modules` | 122 |  |  |
| `check:script-limits` | 122 |  |  |
| `check:bin-snapshot` | 119 |  |  |
| `check:sample-order` | 119 |  |  |
| `check:sessions` | 118 |  |  |
| `check:terrain-pure` | 116 |  |  |
| `check:vat-spoint` | 115 |  |  |
| `check:engine-core` | 115 |  |  |
| `check:engine-interest` | 115 |  |  |
| `check:spline-erosion-witness` | 112 |  |  |
| `check:client-resource-pools` | 111 |  |  |
| `check:chart-anchor` | 109 |  |  |
| `check:socket-upgrade` | 108 |  |  |
| `check:client-pure` | 107 |  |  |
| `check:glue-tier` | 107 |  |  |
| `check:fsr1-spoint` | 106 |  |  |
| `check:procgen` | 102 |  |  |
| `check:ci-engine-glue` | 99 |  |  |
| `check:timed-result` | 95 |  |  |
| `check:tick-governor` | 94 | yes |  |
| `check:import-scene` | 94 |  |  |
| `check:spoint-core-rust` | 93 |  |  |
| `check:collider-streamer` | 91 |  |  |
| `check:behaviours` | 88 |  |  |
| `check:upstream-skill-registry` | 84 |  |  |
| `check:lag-compensation` | 83 |  |  |
| `check:lod-tiers` | 83 |  |  |
| `check:vegetation-stream` | 83 |  |  |
| `check:replay-file` | 82 |  |  |
| `check:client-message-handler` | 82 |  |  |
| `check:replay-dialect` | 82 |  |  |
| `check:sdk-misc` | 81 |  |  |
| `check:player-collisions` | 81 |  |  |
| `check:replay-player` | 80 |  |  |
| `check:snapshot-lod` | 78 |  |  |
| `check:hygiene` | 78 |  |  |
| `check:snapshot-packer` | 77 |  |  |
| `check:animation-control` | 76 |  |  |
| `check:msgpack-packer` | 76 |  |  |
| `check:rollback` | 75 |  |  |
| `check:protocol-codecs` | 74 |  |  |
| `check:upstream-skill-bodies` | 74 |  |  |
| `check:shared-pure` | 73 |  |  |
| `check:netcode-small` | 73 |  |  |
| `check:controlled-run` | 73 |  |  |
| `check:msgpackr-compat` | 72 |  |  |
| `check:streaming-gltf-queues` | 72 |  |  |
| `check:prediction-engine` | 72 |  |  |
| `check:player-lod-plan` | 72 |  |  |
| `check:engine-render` | 72 |  |  |
| `check:protocol` | 71 |  |  |
| `check:event-log` | 71 |  |  |
| `check:cluster-handoff` | 71 |  |  |
| `check:spawn` | 70 |  |  |
| `check:behaviours-c` | 70 |  |  |
| `check:frame-stall-cause` | 70 |  |  |
| `check:octree` | 69 |  |  |
| `check:behaviour-health-destructible` | 69 |  |  |
| `check:reduced-pose` | 69 |  |  |
| `check:negative-zero` | 69 |  |  |
| `check:pathfinding` | 68 |  |  |
| `check:client-pure-rows` | 68 |  |  |
| `check:upload-route` | 68 |  |  |
| `check:wireweave-frame-spoint` | 68 |  |  |
| `check:app-loader` | 67 |  |  |
| `check:game-systems` | 66 |  |  |
| `check:tick-authority` | 66 |  |  |
| `check:chart-migrators` | 66 |  |  |
| `check:entity-host` | 66 |  |  |
| `check:paint-store` | 65 |  |  |
| `check:chart-reanchor` | 65 |  |  |
| `check:telemetry` | 65 |  |  |
| `check:hot-reload-spoint` | 65 |  |  |
| `check:mat4-spoint` | 65 |  |  |
| `check:aoi` | 63 |  |  |
| `check:world-persistence` | 63 |  |  |
| `check:physics-integration` | 63 |  |  |
| `check:snapshot-processor` | 62 |  |  |
| `check:behaviours-a` | 62 |  |  |
| `check:engine-artifacts` | 62 |  |  |
| `check:apps-b` | 61 |  |  |
| `check:sdk-editor` | 60 |  |  |
| `check:chart-state-server` | 60 |  |  |
| `check:game-systems-spoint` | 60 |  |  |
| `check:upstream-builtin-bodies` | 59 |  |  |
| `check:upstream-builtin-three` | 59 |  |  |
| `check:apps-a` | 59 |  |  |
| `check:app-behaviours` | 59 |  |  |
| `check:upstream-door-routes` | 58 |  |  |
| `check:rollback-bridge` | 57 |  |  |
| `check:chart-transfer` | 57 |  |  |
| `check:upstream-builtin-lighting` | 57 |  |  |
| `check:upstream-builtin-water` | 57 |  |  |
| `check:client-machines` | 57 |  |  |
| `check:client-tier-split` | 57 |  |  |
| `check:paired-report` | 57 |  |  |
| `check:sampler-gap-attribution` | 57 |  |  |
| `check:sandbox` | 56 |  |  |
| `check:feature-gap` | 56 |  |  |
| `check:upstream-door-dispatch` | 56 |  |  |
| `check:upstream-builtin-noise` | 56 |  |  |
| `check:blend-tree-spoint` | 56 |  |  |
| `check:material-tier-swap-spoint` | 56 |  |  |
| `check:frequency-runs` | 56 |  |  |
| `check:bundle-freshness-jayzee` | 55 |  |  |
| `check:physics-extras` | 55 |  |  |
| `check:stage` | 55 |  |  |
| `check:upstream-tome-bodies` | 55 |  |  |
| `check:upstream-tome-lookup` | 55 |  |  |
| `check:editor-serialize` | 55 |  |  |
| `check:app-runtime-state` | 55 |  |  |
| `check:cluster-slice` | 55 |  |  |
| `check:stall-off-cpu` | 55 |  |  |
| `check:kaggle-regress` | 55 |  |  |
| `check:site` | 54 |  |  |
| `check:spawn-named-errors` | 54 |  |  |
| `check:render` | 54 |  |  |
| `check:client-loops` | 54 |  |  |
| `check:upstream-builtin-physics` | 54 |  |  |
| `check:client-pure-spoint` | 54 |  |  |
| `check:pool-params-spoint` | 54 |  |  |
| `check:anticheat-spoint` | 53 |  |  |
| `check:row16-client-decoder` | 53 |  |  |
| `check:upstream-builtin-easing` | 53 |  |  |
| `check:upstream-builtin-tween` | 53 |  |  |
| `check:behaviours-b` | 53 |  |  |
| `check:network-state` | 53 |  |  |
| `check:asset-pipeline` | 53 |  |  |
| `check:upstream-endpoints` | 52 |  |  |
| `check:clusters` | 52 |  |  |
| `check:upstream-builtin-env` | 52 |  |  |
| `check:upstream-builtin-path` | 52 |  |  |
| `check:crowd-dot-cells-spoint` | 52 |  |  |
| `check:engine-visibility` | 52 |  |  |
| `check:transport-framing` | 51 |  |  |
| `check:upstream-builtin-math` | 51 |  |  |
| `check:upstream-builtin-spline` | 51 |  |  |
| `check:player-id` | 51 |  |  |
| `check:navmesh-query-spoint` | 51 |  |  |
| `check:collider-layers` | 51 |  |  |
| `check:relative-residuals` | 51 |  |  |
| `check:consensus` | 50 |  |  |
| `check:worker-bridge` | 50 |  |  |
| `check:heightfield-physics` | 50 |  |  |
| `check:upstream-builtin-ballistics` | 50 |  |  |
| `check:upstream-builtin-fx` | 50 |  |  |
| `check:vec3-read` | 50 |  |  |
| `check:world-resolver` | 50 |  |  |
| `check:stall-probe` | 50 |  |  |
| `check:tail-report` | 50 |  |  |
| `check:messages` | 49 |  |  |
| `check:animation` | 49 |  |  |
| `check:constraint-limits` | 49 |  |  |
| `check:tick-order` | 49 |  |  |
| `check:tick-scheduler` | 49 |  |  |
| `check:upstream-skills` | 49 |  |  |
| `check:camera-rig` | 49 |  |  |
| `check:spawn-captured-names` | 49 |  |  |
| `check:engine-solver-tier` | 49 |  |  |
| `check:collision-placement` | 49 |  |  |
| `check:engine-isolation` | 49 |  |  |
| `check:hot-reload` | 48 |  |  |
| `check:content` | 48 |  |  |
| `check:movement` | 48 |  |  |
| `check:rollback-peer` | 48 |  |  |
| `check:worker-dispatch` | 48 |  |  |
| `check:upstream-builtins` | 48 |  |  |
| `check:upstream-builtin-postfx` | 48 |  |  |
| `check:upstream-builtin-tsl` | 48 |  |  |
| `check:upstream-builtin-voxels` | 48 |  |  |
| `check:component-pool` | 48 |  |  |
| `check:cube-sphere-cell-key-spoint` | 48 |  |  |
| `check:minidump` | 48 |  |  |
| `check:flight-model` | 47 |  |  |
| `check:upstream-builtin-vec3` | 47 |  |  |
| `check:upstream-reference` | 47 |  |  |
| `check:upstream-builtin-terrain` | 47 |  |  |
| `check:postfx-shaders-spoint` | 47 |  |  |
| `check:spawn-captured-bodies` | 47 |  |  |
| `check:browser-heap` | 47 |  |  |
| `check:anticheat` | 46 |  |  |
| `check:character-step` | 46 |  |  |
| `check:vehicle-tuning` | 46 |  |  |
| `check:upstream-tome` | 46 |  |  |
| `check:upstream-builtin-room-routing` | 46 |  |  |
| `check:reexpress-records` | 46 |  |  |
| `check:render-1024-visible` | 46 |  |  |
| `check:relocation-solve` | 45 |  |  |
| `check:upstream-doors` | 45 |  |  |
| `check:hook-order` | 45 |  |  |
| `check:named-asset-redirect` | 45 |  |  |
| `check:world-def-clusters` | 45 |  |  |
| `check:chromium-launcher` | 45 |  |  |
| `check:jolt-limits` | 44 |  |  |
| `check:upstream-builtin-vibe` | 44 |  |  |

## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 11. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4.
- Pushed 2026-11-11T14:45:27Z. Queue wait 3 s from the push to the first line of the script. Run time 190.5 s for 46 of 46 planned runs.
- engine-core-1024mib-threads.mjs, warmed: 10240 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4); in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, warmed: 10240 bodies hold the budget at p99 with zero ticks over budget (workers 2, 3, 4, 6); in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 10240 bodies hold it (workers 1, 2, 3, 4, 6).
- cap20480 build of engine-core-1024mib-threads-simd.mjs, warmed: 12288 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4, 6); in the steady window alone 20480 bodies hold it (workers 3, 4, 6).
- cap20480 build of engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 20480 bodies hold it (workers 4).
- Refused by the arena plan: 8 workers (workers-do-not-fit).
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads, warmed | 10240 | 1 | 4 |  | 0.063 | 23.257 | 25.142 | 54 | 15.56 / 18.6 | 24.991 | 25.142 | 53 | 0.063 | 0.095 | 0 | 103298208 | 497242640 | 1356 | 891.8 | 4.4 |
| 1024mib-threads, warmed | 10240 | 2 | 4 |  | 0.064 | 15.412 | 16.726 | 1 | 12.56 / 12.94 | 16.128 | 16.726 | 1 | 0.062 | 0.144 | 0 | 103298208 | 497308176 | 1232.5 | 842.3 | 3.5 |
| 1024mib-threads, warmed | 10240 | 3 | 4 |  | 0.064 | 14.147 | 14.616 | 0 | 11.56 / 11.71 | 14.525 | 14.616 | 0 | 0.064 | 0.094 | 0 | 103298208 | 497373712 | 1441.5 | 893.9 | 3.7 |
| 1024mib-threads, warmed | 10240 | 4 | 4 |  | 0.064 | 12.056 | 13.008 | 0 | 10.54 / 10.14 | 12.516 | 13.008 | 0 | 0.064 | 0.092 | 0 | 103298208 | 497439248 | 1207.9 | 839.1 | 3.3 |
| 1024mib-threads, warmed | 10240 | 6 | 4 |  | 0.062 | 13.305 | 16.935 | 1 | 14.75 / 15.64 | 13.683 | 16.935 | 1 | 0.061 | 0.093 | 0 | 103298208 | 497570320 | 1218.5 | 853.6 | 3.4 |
| 1024mib-threads-simd, warmed | 10240 | 1 | 4 |  | 0.063 | 18.514 | 20.257 | 27 | 13.26 / 15.62 | 18.987 | 20.257 | 27 | 0.063 | 0.114 | 0 | 103298208 | 497242640 | 1183.9 | 884.5 | 3.7 |
| 1024mib-threads-simd, warmed | 10240 | 2 | 4 |  | 0.063 | 12.261 | 13.105 | 0 | 11.35 / 10.81 | 12.726 | 13.105 | 0 | 0.063 | 0.095 | 0 | 103298208 | 497308176 | 1184.5 | 887.1 | 3.3 |
| 1024mib-threads-simd, warmed | 10240 | 3 | 4 |  | 0.064 | 10.784 | 11.864 | 0 | 9.72 / 9.82 | 11.594 | 11.864 | 0 | 0.063 | 0.099 | 0 | 103298208 | 497373712 | 1165.4 | 880.7 | 3.2 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 |  | 0.063 | 9.648 | 11.281 | 0 | 8.89 / 8.59 | 10.013 | 11.281 | 0 | 0.063 | 0.106 | 0 | 103298208 | 497439248 | 1157.3 | 880.3 | 3.1 |
| 1024mib-threads-simd, warmed | 10240 | 6 | 4 |  | 0.064 | 10.318 | 13.236 | 0 | 13.24 / 13.16 | 10.854 | 12.679 | 0 | 0.062 | 0.094 | 0 | 103298208 | 497570320 | 1164.6 | 883.9 | 3.2 |
| 1024mib-threads, cold | 10240 | 1 | 4 |  | 0.061 | 24.502 | 55.838 | 72 | 38.77 / 19.8 | 24.987 | 55.838 | 70 | 0.061 | 0.131 | 0 | 103298208 | 497242640 |  | 836.8 | 2.9 |
| 1024mib-threads, cold | 10240 | 2 | 4 |  | 0.065 | 16.303 | 34.232 | 5 | 34.23 / 17.53 | 16.778 | 17.999 | 3 | 0.063 | 0.147 | 0 | 103298208 | 497308176 |  | 835.8 | 2.3 |
| 1024mib-threads, cold | 10240 | 3 | 4 |  | 0.064 | 14.759 | 38.009 | 3 | 38.01 / 17.24 | 15.885 | 20.719 | 1 | 0.062 | 0.135 | 0 | 103298208 | 497373712 |  | 852.8 | 2.2 |
| 1024mib-threads, cold | 10240 | 4 | 4 |  | 0.065 | 14.787 | 38.055 | 3 | 38.05 / 14.74 | 16.418 | 32.16 | 2 | 0.062 | 0.116 | 0 | 103298208 | 497439248 |  | 825.5 | 2.2 |
| 1024mib-threads, cold | 10240 | 6 | 4 |  | 0.064 | 14.419 | 50.803 | 5 | 50.8 / 21.04 | 17.142 | 19.485 | 3 | 0.064 | 0.102 | 0 | 103298208 | 497570320 |  | 881.8 | 2.3 |
| 1024mib-threads-simd, cold | 10240 | 1 | 4 |  | 0.063 | 18.313 | 38.175 | 33 | 38.17 / 17.35 | 18.604 | 20.677 | 31 | 0.063 | 0.138 | 0 | 103298208 | 497242640 |  | 845 | 2.5 |
| 1024mib-threads-simd, cold | 10240 | 2 | 4 |  | 0.064 | 13.423 | 35.327 | 1 | 35.33 / 12.77 | 13.855 | 14.929 | 0 | 0.062 | 0.111 | 0 | 103298208 | 497308176 |  | 841 | 2.1 |
| 1024mib-threads-simd, cold | 10240 | 3 | 4 |  | 0.083 | 12.157 | 33.599 | 1 | 33.6 / 13.03 | 13.353 | 16.671 | 0 | 0.072 | 0.174 | 0 | 103298208 | 497373712 |  | 838.8 | 2 |
| 1024mib-threads-simd, cold | 10240 | 4 | 4 |  | 0.065 | 11.061 | 36.958 | 1 | 36.96 / 12.84 | 13.729 | 14.929 | 0 | 0.064 | 0.149 | 0 | 103298208 | 497439248 |  | 935.5 | 2 |
| 1024mib-threads-simd, cold | 10240 | 6 | 4 |  | 0.064 | 12.053 | 48.242 | 1 | 48.24 / 12.6 | 13.435 | 14.563 | 0 | 0.063 | 0.115 | 0 | 103298208 | 497570320 |  | 862.6 | 2 |
| cap20480 1024mib-threads-simd, warmed | 12288 | 3 | 4 |  | 0.122 | 13.001 | 13.771 | 0 | 11.91 / 12.13 | 13.279 | 13.771 | 0 | 0.121 | 0.174 | 0 | 143627040 | 550234640 | 1168.1 | 875.8 | 3.4 |
| cap20480 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.12 | 11.415 | 12.054 | 0 | 10.98 / 10.48 | 11.683 | 12.054 | 0 | 0.12 | 0.159 | 0 | 143627040 | 550300176 | 1152.5 | 897.5 | 3.3 |
| cap20480 1024mib-threads-simd, warmed | 12288 | 6 | 4 |  | 0.121 | 12.38 | 15.132 | 0 | 13.94 / 15.13 | 12.776 | 13.25 | 0 | 0.12 | 0.215 | 0 | 143627040 | 550431248 | 1179.9 | 873.4 | 3.4 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 3 | 4 |  | 0.13 | 17.834 | 19.075 | 16 | 15.75 / 15.49 | 18.308 | 19.075 | 16 | 0.128 | 0.162 | 0 | 145855280 | 550234640 | 1148.3 | 829.5 | 3.6 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 4 | 4 |  | 0.134 | 15.14 | 17.263 | 3 | 13.03 / 14.04 | 16.8 | 17.263 | 3 | 0.13 | 0.233 | 0 | 145855280 | 550300176 | 1187 | 923.8 | 3.6 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 6 | 4 |  | 0.131 | 15.469 | 17.329 | 3 | 17 / 14.94 | 16.351 | 17.329 | 2 | 0.129 | 0.2 | 0 | 145855280 | 550431248 | 1160.5 | 856.2 | 3.6 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 3 | 4 |  | 0.161 | 23.113 | 24.97 | 71 | 19.54 / 19.03 | 24.264 | 24.97 | 69 | 0.158 | 0.312 | 0 | 148034352 | 550234640 | 1150.3 | 825.1 | 4.1 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 4 | 4 |  | 0.142 | 19.999 | 22.762 | 40 | 17.05 / 17.15 | 20.783 | 22.762 | 38 | 0.14 | 0.187 | 0 | 148034352 | 550300176 | 1155.6 | 872.8 | 3.9 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 6 | 4 |  | 0.144 | 20.302 | 21.483 | 55 | 16.89 / 17.66 | 21.08 | 21.483 | 53 | 0.14 | 0.276 | 0 | 148034352 | 550431248 | 1218.3 | 844 | 4 |
| cap20480 1024mib-threads-simd, cold | 12288 | 4 | 4 |  | 0.19 | 12.698 | 39.807 | 4 | 39.81 / 12.7 | 20.123 | 36.283 | 3 | 0.189 | 0.295 | 0 | 143627040 | 550300176 |  | 840.5 | 2.2 |
| cap20480 1024mib-threads-simd, cold | 16384 | 4 | 4 |  | 0.132 | 16.108 | 45.327 | 4 | 45.33 / 14.96 | 17.389 | 31.253 | 3 | 0.131 | 0.211 | 0 | 145855280 | 550300176 |  | 830.2 | 2.4 |
| cap20480 1024mib-threads-simd, cold | 20480 | 4 | 4 |  | 0.14 | 20.874 | 49.395 | 57 | 49.4 / 19.36 | 22.237 | 23.784 | 55 | 0.137 | 0.2 | 0 | 148034352 | 550300176 |  | 845.3 | 2.7 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 |  | 0.062 | 9.358 | 10.069 | 0 | 8.92 / 8.53 | 9.579 | 10.069 | 0 | 0.061 | 0.088 | 0 | 103298208 | 497439248 | 1131.9 | 941.7 | 3.1 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 | warm run 1024x150 | 0.064 | 9.691 | 10.275 | 0 | 9.7 / 9.4 | 10.188 | 10.275 | 0 | 0.064 | 0.139 | 0 | 103298208 | 497439248 | 1017.1 | 866.6 | 2.9 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 | warm run 512x90 | 0.064 | 10.168 | 12.235 | 0 | 8.69 / 11.96 | 11.015 | 12.235 | 0 | 0.064 | 0.117 | 0 | 103298208 | 497439248 | 960.7 | 812.1 | 2.8 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 |  | 0.064 | 9.469 | 10.283 | 0 | 8.64 / 8.6 | 9.862 | 10.283 | 0 | 0.064 | 0.091 | 0 | 103298208 | 497439248 | 1157.2 | 828.1 | 3 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 | warm run 1024x150 | 0.107 | 9.685 | 12.684 | 0 | 9.25 / 9.99 | 10.214 | 12.684 | 0 | 0.074 | 0.169 | 0 | 103298208 | 497439248 | 1024.1 | 846.5 | 3 |
| 1024mib-threads-simd, warmed | 10240 | 4 | 4 | warm run 512x90 | 0.064 | 9.764 | 11.941 | 0 | 8.65 / 11.94 | 10.467 | 11.693 | 0 | 0.064 | 0.133 | 0 | 103298208 | 497439248 | 987.7 | 879.9 | 2.9 |

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 11.019 | 16.031 | 0 | 0 | 11.491 | 15.897 | 0 | 18.9 |
| 128 MiB fixed | 1 | schedstat | 11.016 | 12.943 | 0 | 0 | 10.76 | 12.552 | 0 | 19.1 |
| 512 MiB fixed | 1 | schedstat | 9 | 10.005 | 0 | 0 | 8.82 | 10.588 | 0 | 15.4 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.017 | 7.018 | 0 | 0 | 6.288 | 7.312 | 0 | 13.8 |
