# Parity matrix

Ranked by dependency. Each row names the source it comes from and its status.

- built: a gate under scripts/ checks it, and npm test runs that gate.
- partial: some of the row is built and checked, and the rest is open.
- open: not started.
- decision: out of scope for a host-agnostic physics and netcode package, pending an owner decision.

Sources are spoint at d5e3860 (INVENTORY.md and FAMILIES.md from the spoint agent), savi's documented featureset, and the spawn learning feed (75 engine, netcode and physics learnings; 31 process learnings). Items reported by a peer and not reproduced here are marked peer-reported.

## Ranked rows

1. Spawn feed, resolve, head, ledger keys and CDN names. Source: spawn feed, savi spawn-engine docs. Spoint path: none (spawn-only). Status: partial. Witness: scripts/check-spawn.mjs. Open: resolve result types other than found, manifest frames after the sheet, the name encoder, and the ledger bucket derivation.
2. Input, snapshot, state, delta and ack codecs. Source: spoint section 5 (wire layout differs; no compatibility claimed). Status: built. Witness: check-protocol, check-snapshots.
3. Authority, prediction, reconciliation and input buffer. Source: spoint client prediction (no witness in spoint). Status: built. Witness: check-netcode.
4. Message ids and reliability classes. Spoint gap GAP-MSG-DELTA_UPDATE: declared, never sent or handled. Source: spoint MessageTypes.js, 105 ids and 12 unreliable. Status: built. Witness: scripts/check-messages.mjs against scripts/fixtures/spoint-messages.json, generated from spoint at d5e3860. Several ids are declared but unused in spoint, such as DELTA_UPDATE. They are kept so the id space matches.
5. Physics kernel: integration, ground, boxes, pair search and contact response. Source: spoint physics (Jolt) and spawn learnings 1 to 2 and 10. Status: built. Witness: check-kernel, check-world.
6. Physics kernel: sleeping islands, CCD, persistent contacts and warm start. Source: spawn learnings 11 to 15. Status: open.
7. Joints, springs, axis locks and friction and restitution combine modes. Source: spawn learnings 17 to 20. Spoint paths: src/physics/jointMap.js, src/physics/constraintLimits.js, src/physics/joltLimits.js. Status: open.
8. Character controller, slope limit 0.785 rad, wall planes and steps. Source: spoint CharacterManager, characterStep. Status: open. No witness in spoint.
9. Queries: raycast, overlap, filters and pending geometry. Source: spawn learnings 21 to 22. Spoint path: src/physics/World.js. Status: open.
10. Vehicles. Source: spoint VehiclePhysics and FlightModel, spawn learning 28 to 29. Status: open. No witness in spoint.
11. Lag compensation with a rewind ring, a 1000 ms window and a rate limit. Source: spoint LagCompensator. Status: open. spoint's ring overflows silently at a 5000 ms window (peer-reported, verified by run in spoint's gap survey).
12. Rollback loop with maxRollbackTicks 12 and window 32. Source: spoint RollbackGameLoop. Status: open. Note that spoint's stall rule uses the minimum remote, not the newest.
13. Lockstep loop with input delay 3, checksum every 30 ticks and stall 600. Source: spoint LockstepGameLoop. Status: open.
14. Desync detection, consensus voting and peer ejection. Source: spoint DesyncDetector, ConsensusVoter, CheatEjection. Status: open.
15. Interest management: relevance radius 200 m and cell lookup. Source: spoint TickHandlerAOI, spawn learnings 57 to 58. Status: open.
16. Bandwidth budget and priority: 900 bytes per tick, decay 0.02, 64 entities. Source: spoint TickHandlerAOI. Status: open.
17. Snapshot LOD: full detail for 30 players, 5 Hz beyond 120 m. Source: spoint SnapshotEncoder. Status: open.
18. Replication scope and audience. Source: spawn learnings 30 to 37. Spoint path: src/sdk/TickHandlerAOI.js. Status: open.
19. Server authority per tick, catch-up limits and starvation holds. Source: spoint processPlayerMovement. Status: open.
20. Anticheat: input rate limit (capacity 120, refill 90 per second), envelope clamp, shot outlier flags. Source: spoint InputGuard, OutlierDetector. Status: open.
21. Replay record and playback. Source: spoint ReplayRecorder, ReplayPlayer. Status: open.
22. Sessions: reconnect, migrate and session TTL of 30 s. Source: spoint src/sdk/ServerHandlers.js, src/connection/SessionStore.js. Status: open. Residual from the PRD: WADLER-relocation-probegroundy-m2-s1 in src/sdk/Relocation.js.
23. Heightfield terrain: baked data, fail-loud on stale code, CPU fallback. Source: spoint TerrainPhysics, data/heightfield.json and tps-game.hf (two codeVersions, one stale). Status: open.
24. Terrain marks, paint and sculpt. Source: spoint TerrainMarks, paintStore. Status: open.
25. Caves, erosion, structures and spline carve. Source: spoint src/terrain/CaveSDF.js, src/terrain/TerrainErosion.js, src/terrain/StructureStamp.js, src/terrain/SplineCarve.js. Status: open. No witness in spoint.
26. Fire kernel (integer-only, hashed seeds) and fire wire. Source: spoint src/shared/fire/fireKernel.js. Status: in progress. No witness in spoint (GAP-fire-kernel-witness), so jayzee needs its own.
27. Pathfinding with a budget of 20000 and partial results. Source: spawn learning 23, spoint pathfinding. Status: open.
28. Spatial index with cells of 32 m. Source: spoint Octree. Status: open. No witness in spoint.
29. Stage loading and shapes. Source: spoint Stage, StageLoader. Status: open. No witness in spoint.
30. Clusters and sharding. Source: spoint clusterConfig and ClusterHandoff, spawn learning 48 and 49. Status: open. Refusal codes listed in spoint inventory section 5.
31. Chart re-anchor and cube-sphere. Source: spoint chartAnchor and CubeSphereCells. Status: open. Cube-sphere is not exercised by any shipped world in spoint.
32. Apps runtime and hook order: onSpawn, onInput, update, lateUpdate. Source: spawn learnings 69 to 74; spoint src/apps/AppRuntime.js, src/apps/AppContext.js. Status: open. Spoint gap GAP-trimesh-failure-propagation (AppRuntime.js lines around 436 to 444) is spoint-owned.
33. Scripting limits: op caps, a 32 MiB memory cap and a 5 s kill. Source: spawn learnings 8 to 9. Spoint path: none found (spawn-only). Status: open.
34. World persistence and state restore. Source: spoint WorldPersistence. Status: partial. exportState and importState are built. The fingerprint and version checks are open.
35. Tick governor and shed fraction. Source: spawn learnings 2 to 3; spoint src/netcode/TickSystem.js. Status: open.
36. Telemetry: tick budget windows and bandwidth horizons. Source: spawn learnings 46 and 65 to 66; spoint src/sdk/Metrics.js. Status: open.
37. Sandbox: fail-closed evaluator. Source: spoint SESCompartmentEvaluator. Status: decision. Whether the package embeds a sandbox is for the owner.
38. Transports: WebSocket, WebTransport, WebRTC and worker. Source: spoint src/transport and client/BrowserServer.js. Status: decision. Adapters belong outside the core package.
39. Client rendering, shadows, post-fx and grass. Source: spoint client/core. Status: decision. Out of scope for a physics and netcode package.
40. Editor, hot reload and HUD panels. Source: spoint client/editor, src/debug, HMR runtime. Status: decision.
41. Savi's 93 documented endpoints (39 published, 21 per-game, 30 manual-only, 3 disabled). Source: savi ENDPOINTS.md (savi-only; spoint path: none). Status: decision. jayzee serves no HTTP. Savi documents them. The spawn feed and resolve parts are in row 1.

## Additional families from the d5e3860 inventory

Orchestrate's read-only inventory of spoint at d5e3860: 2233 commits, 2293 tracked files, 103 PRD rows (fixed 34, refuted 28, retired 26, open 15), 142 files in work/rows, 76 tracked verdict paths, and 20 doc pages. All 57 paths I checked from that list exist in the d5e3860 tree, by a shell existence loop. A control path that does not exist was reported missing, so the loop does detect absence. I checked a subset of the inventory's paths, not all of them. Statuses below are open unless marked otherwise. Overlaps point to the earlier row.

42. Binary snapshot format: 29-byte entity records, 22-byte player records, smallest-three quaternion (src/netcode/SnapshotBinFormat.js, SnapshotEncoder.js, SnapshotPacker.js, NetworkState.js). Open. Overlaps row 17.
43. Replay file .spointreplay, magic v2 (src/netcode/ReplayFile.js). Open. Overlaps row 21.
44. Lag compensation, hitscan and the rewind spatial index (src/netcode/LagCompensator.js, Hitscan.js, RewindSpatialIndex.js). Open. Overlaps row 11.
45. Anticheat and lockstep helpers: CheatEjection, DesyncDetector, ConsensusVoter, EventLog, InputGuard, OutlierDetector, LockstepChecksum (src/netcode/). Open. Overlaps rows 13, 14 and 20.
46. Protocol: InputCodec and ComponentSchema (src/protocol/). Open. Overlaps row 4 for the id table.
47. Transports: WebTransport and QUIC datagrams, Wireweave and WebRTC, worker postMessage, NetworkSimTransport (src/transport/). Open, authorized by orchestrate after row 26.
48. Client loops: PredictionEngine, ReconciliationEngine, SnapshotProcessor, SnapshotTimeline, PredictionChart, ClockSync, ChartEpochSync, ReconnectManager, TransportMigrationTrigger (src/client/). Open. Overlaps row 3 for the algorithm.
49. Sharding: Cluster*, Region*, ClusterHandoff, ShardingRefusal (src/sharding/). Open. Overlaps row 30.
50. Server SDK surfaces: ServerAPI, AgentAuthoringAPI, StaticHandler, DevHmr, RoomOrchestratorHttp, RoomDirectory, RoomPick, RoomRouting, RoomHealth, NostrAuthServer, cronSchedule, llmJobs, UploadHandler, MinimapBake, WorldPersistence (src/sdk/). Open.
51. Physics extras: Jolt wrapper, CharacterManager, ShapeBuilder, StaticTileIndex, FlightModel, VehiclePhysics, Draco and Meshopt decoders. Spoint paths: src/physics/StaticTileIndex.js, src/physics/DormantStatics.js, src/physics/GLBLoader.js, src/physics/DracoDecompressor.js, src/physics/MeshoptDecompressor.js, src/physics/jointMap.js, src/physics/pivotTransform.js, src/physics/surfaceVelocity.js. Open. Overlaps rows 8, 10 and 22.
52. Terrain, 21 or more files, including PlanetFrame, ChartReanchor*, CaveSDF, CavePatches, CaveMeshes, GrassPlacementLod, BiomeOverride and ClimateCache (src/terrain/). Open. Overlaps rows 23 to 25 and 31. PlanetFrame.js installGroundSource (line 348) is the spoint-owned CHARTEST-est-s1-3 gap.
53. Behaviours: buffs, fire, fluid, softbody, FSM, ragdoll activation, water level, terrain paint (src/behaviours/). Open. Fire is row 26.
54. Shipped content: 29 built-in placed-app directories (src/stdlib-apps/), 12 world definitions excluding index.js (apps/world/), and 16 GLB maps (apps/maps/). Open. Counts measured at d5e3860 by spoint-88 and by a directory listing here. Earlier counts from the inventory are superseded. Spoint gap GAP-port-3002-shared: tps-game.js, tutorial.js and tutorial-rpg.js all declare port 3002 (spoint-owned).
55. Packages: mapspinner, streaming-gltf (EP_progressive_lod schemas), ecs, and spoint-core, a Rust crate. Open. The Rust crate is a different language, so it needs a decision on whether jayzee ports it.
56. Game systems: AbilityTree, QuestSystem, ProgressionSystem, StatsSystem and EventChainManager (src/game/). Open.
57. Animation (src/animation/). Open.
58. Pathfinding: NavmeshQuery, ChartNavmeshQuery, RecastIntegration (src/pathfinding/). Open. Overlaps row 27.
59. Client rendering and tools: client/editor, client/hud, client/xr and client/core, including WebGPU and WebGL postFX and the shadow and quality governors. Open, authorized by orchestrate after row 26. Rendering is at most a headless node-checkable subset.
60. Deployment and tooling: edge/cf-do (Cloudflare Durable Object), src-tauri, bin/ (create-app, room-orchestrator-boot, room-worker-boot, and marketplace-registry, which spoint-88 found unreferenced), and about 200 scripts witnesses. Tooling gate: scripts/check.mjs and the package.json gate scripts (spoint-owned). Gap GAP-bundle-freshness: the package.json scripts check:bundle-freshness and check:bundle-freshness:require-bundle call scripts/bundle-freshness-witness.mjs, which does not exist. Owner decision on the fix. Open.
61. Open items from spoint's savi-spawn feature-gap report, which lists 47 checked and 13 unchecked. The 13 unchecked items are: terrain mark vocabulary and world-def wiring; named terrain field paint with PLAYER and CREATOR layers; decoration item layers and graphics-tier reach; rigged-model ragdoll activation; vibe pattern core and transport; PostFX look DSL and render-graph operators; private preview room and separate publish; browser readiness, fault and chat contract; declarative world tree and state scopes; shared spec parse boundary for all ctx.define* factories; surface of the tick drop counter; SES availability preflight with distinct reason codes; and a fail-loud asset loading gate for model errors. The 47 checked items are spoint's own claims, and I have not verified them.


## Split: spoint's missing witnesses versus jayzee's missing features

- spoint-owned, not built in jayzee: package.json scripts check:bundle-freshness and check:bundle-freshness:require-bundle call scripts/bundle-freshness-witness.mjs, which does not exist. spoint is read-only for jayzee, so the fix belongs to the spoint owner.
- jayzee feature, not started: bundle freshness as a feature is not part of the spoint physics or netcode surface. It stays out of scope until the owner decides it belongs in this package.
- spoint-owned, no witness: fire kernel and behaviour (src/shared/fire, src/behaviours/fire*.js). jayzee will write its own witness for the fire kernel in row 26.
- spoint-owned, behaviour gap: src/apps/AppRuntime.js (around lines 436 to 444) logs a trimesh build failure, sets the collider to null and carries on. It does not propagate ColliderBuildError, which spoint's AGENTS.md requires. Any collider build in jayzee must propagate such failures, not drop them.
- spoint-owned, behaviour gap: port 3002 is declared by apps/world/tps-game.js, tutorial.js and tutorial-rpg.js, so the three collide if run together.
- spoint-owned, PRD gap, confirmed: CHARTEST-est-s1-3 in src/terrain/PlanetFrame.js, installGroundSource. A placement-only install through a prototype-linked frame (Object.create(base)) changes the shared base frame's groundSource and groundSources. There is no own-property guard. The node witness is /tmp/spoint-parity/witness-chartest-3.mjs, and it prints GAP-CONFIRMED.
- spoint-owned, PRD residual: WADLER-relocation-probegroundy-m2-s1 in src/sdk/Relocation.js. probeGroundY discards the reason. spoint-88's classes: 1 REAL, 11 STALE, 2 DOC-ONLY, 1 UNVERIFIED, 0 HELD across the 15 open PRD rows. The matrix is at /tmp/spoint-parity/prd-matrix.json, witnessed by build-prd-matrix.mjs.

## Open source questions

Each answer comes from spoint-88's check of spoint at d5e3860. Each stays OPEN in jayzee until a source documents the rule.

- Name encoder for ledger names (row 1): spoint has no encodeName or nameEncoder in src, scripts or client. OPEN. jayzee implements decoding only.
- Ledger bucket rule for world.assets/<xx>/ (row 1): spoint has no ledger-bucket concept. The nearest code is token buckets (src/netcode/InputGuard.js, isInputRateLimited and clearInputBucket). The rewind bucket in spoint's DESIGN.md (capacity 10, refill 20 per second) has no located code. UNVERIFIED. jayzee checks the shape only.
- Resolve result types (row 1): found and not_found are parsed. spawn reports not_found from a live request, and the body is in resolve-not-found.json. redirect and gone are in the openapi description, but no body has been captured. OPEN. jayzee throws on those two. This comes from spawn's report, not from a probe file in this repo.
- Manifest frames after the sheet (row 1): not documented in spawn's saved files or in spoint. OPEN. jayzee does not parse frames after the sheet.
- Name encoder (row 1): spawn confirms no encoder is documented or implemented. OPEN. Decode only.
- Ledger bucket (row 1): spawn tested 74 saved (bucket, sha) pairs against seven candidate rules and none matched. Treat it as undetermined. jayzee accepts any two hex characters. The token-bucket concept is verified by spoint code: src/netcode/LagCompensator.js has capacity 10 and refill 20 per second, and src/netcode/InputGuard.js refills at 90 per second. The ledger concept itself has no spoint documentation, so the ledger reading stays UNVERIFIED.
- /cdn/ GLB family (row 1): 2416 verified GLB refs across 399 worlds is a LOWER BOUND for the /cdn/value.<sha256>.glb family only. It is not the complete GLB universe. The spawnfile-keyed family is scanned separately. "All GLBs are served only from play.spawn.co/cdn/" is INFERRED. spawnfile.io model bytes are UNCONFIRMED until HEAD proof exists.
- spawnfile-keyed ledger family (row 1): world.assets/<xx>/https~3a~2f~2fspawnfile.io~2f... exists, per savi's FAULTS.md F3, which elides the path with "...". The full key is not in any witness. OPEN. jayzee has no fixture for it and encodes no path for it until savi sends the complete key.

## Conflicts to resolve in the sources

- savi ENDPOINTS.md lists GET /api/games/{appId} as a per-game route. savi FAULTS F1 says it returns game:null for every id. Resolve in savi.
- The savi type count is 305 in some docs and 308 in another. Resolve in savi.
- The spawn learnings marked OPEN disagree with each other. Reconcile with spawn before implementing them: 39, 54, 71, 73, 68, 29, 20, and process items 24, 25 and 27.
- spoint's two heightfield bakes have different codeVersions. One is stale.
- spoint's Wave C docs name files that do not exist. Owner decision: build them or correct the docs.
