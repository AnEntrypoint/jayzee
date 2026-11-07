# Parity matrix

Ranked by dependency. Each row names the source it comes from and its status.

- built: a gate under scripts/ checks it, and npm test runs that gate.
- partial: some of the row is built and checked, and the rest is open.
- open: not started.
- decision: out of scope for a host-agnostic physics and netcode package, pending an owner decision.

Sources are spoint at d5e3860 (INVENTORY.md and FAMILIES.md from the spoint agent), savi's documented featureset, and the spawn learning feed (75 engine, netcode and physics learnings; 31 process learnings). Items reported by a peer and not reproduced here are marked peer-reported.

## Ranked rows

1. Spawn feed, resolve, head, ledger keys and CDN names. Source: spawn feed, savi spawn-engine docs. Status: partial. Witness: scripts/check-spawn.mjs. Open: resolve result types other than found, manifest frames after the sheet, the name encoder, and the ledger bucket derivation.
2. Input, snapshot, state, delta and ack codecs. Source: spoint section 5 (wire layout differs; no compatibility claimed). Status: built. Witness: check-protocol, check-snapshots.
3. Authority, prediction, reconciliation and input buffer. Source: spoint client prediction (no witness in spoint). Status: built. Witness: check-netcode.
4. Message ids and reliability classes. Source: spoint MessageTypes.js, 105 ids and 12 unreliable. Status: built. Witness: scripts/check-messages.mjs against scripts/fixtures/spoint-messages.json, generated from spoint at d5e3860. Several ids are declared but unused in spoint, such as DELTA_UPDATE. They are kept so the id space matches.
5. Physics kernel: integration, ground, boxes, pair search and contact response. Source: spoint physics (Jolt) and spawn learnings 1 to 2 and 10. Status: built. Witness: check-kernel, check-world.
6. Physics kernel: sleeping islands, CCD, persistent contacts and warm start. Source: spawn learnings 11 to 15. Status: open.
7. Joints, springs, axis locks and friction and restitution combine modes. Source: spawn learnings 17 to 20. Status: open.
8. Character controller, slope limit 0.785 rad, wall planes and steps. Source: spoint CharacterManager, characterStep. Status: open. No witness in spoint.
9. Queries: raycast, overlap, filters and pending geometry. Source: spawn learnings 21 to 22. Status: open.
10. Vehicles. Source: spoint VehiclePhysics and FlightModel, spawn learning 28 to 29. Status: open. No witness in spoint.
11. Lag compensation with a rewind ring, a 1000 ms window and a rate limit. Source: spoint LagCompensator. Status: open. spoint's ring overflows silently at a 5000 ms window (peer-reported, verified by run in spoint's gap survey).
12. Rollback loop with maxRollbackTicks 12 and window 32. Source: spoint RollbackGameLoop. Status: open. Note that spoint's stall rule uses the minimum remote, not the newest.
13. Lockstep loop with input delay 3, checksum every 30 ticks and stall 600. Source: spoint LockstepGameLoop. Status: open.
14. Desync detection, consensus voting and peer ejection. Source: spoint DesyncDetector, ConsensusVoter, CheatEjection. Status: open.
15. Interest management: relevance radius 200 m and cell lookup. Source: spoint TickHandlerAOI, spawn learnings 57 to 58. Status: open.
16. Bandwidth budget and priority: 900 bytes per tick, decay 0.02, 64 entities. Source: spoint TickHandlerAOI. Status: open.
17. Snapshot LOD: full detail for 30 players, 5 Hz beyond 120 m. Source: spoint SnapshotEncoder. Status: open.
18. Replication scope and audience. Source: spawn learnings 30 to 37. Status: open.
19. Server authority per tick, catch-up limits and starvation holds. Source: spoint processPlayerMovement. Status: open.
20. Anticheat: input rate limit (capacity 120, refill 90 per second), envelope clamp, shot outlier flags. Source: spoint InputGuard, OutlierDetector. Status: open.
21. Replay record and playback. Source: spoint ReplayRecorder, ReplayPlayer. Status: open.
22. Sessions: reconnect, migrate and session TTL of 30 s. Source: spoint ServerHandlers, SessionStore. Status: open.
23. Heightfield terrain: baked data, fail-loud on stale code, CPU fallback. Source: spoint TerrainPhysics, data/heightfield.json and tps-game.hf (two codeVersions, one stale). Status: open.
24. Terrain marks, paint and sculpt. Source: spoint TerrainMarks, paintStore. Status: open.
25. Caves, erosion, structures and spline carve. Source: spoint terrain modules. Status: open. No witness in spoint.
26. Fire kernel (integer-only, hashed seeds) and fire wire. Source: spoint src/shared/fire. Status: open. No witness in spoint, so jayzee needs its own.
27. Pathfinding with a budget of 20000 and partial results. Source: spawn learning 23, spoint pathfinding. Status: open.
28. Spatial index with cells of 32 m. Source: spoint Octree. Status: open. No witness in spoint.
29. Stage loading and shapes. Source: spoint Stage, StageLoader. Status: open. No witness in spoint.
30. Clusters and sharding. Source: spoint clusterConfig and ClusterHandoff, spawn learning 48 and 49. Status: open. Refusal codes listed in spoint inventory section 5.
31. Chart re-anchor and cube-sphere. Source: spoint chartAnchor and CubeSphereCells. Status: open. Cube-sphere is not exercised by any shipped world in spoint.
32. Apps runtime and hook order: onSpawn, onInput, update, lateUpdate. Source: spawn learnings 69 to 74. Status: open.
33. Scripting limits: op caps, a 32 MiB memory cap and a 5 s kill. Source: spawn learning 8 to 9. Status: open.
34. World persistence and state restore. Source: spoint WorldPersistence. Status: partial. exportState and importState are built. The fingerprint and version checks are open.
35. Tick governor and shed fraction. Source: spawn learnings 2 to 3. Status: open.
36. Telemetry: tick budget windows and bandwidth horizons. Source: spawn learnings 46 and 65 to 66. Status: open.
37. Sandbox: fail-closed evaluator. Source: spoint SESCompartmentEvaluator. Status: decision. Whether the package embeds a sandbox is for the owner.
38. Transports: WebSocket, WebTransport, WebRTC and worker. Source: spoint src/transport and client/BrowserServer.js. Status: decision. Adapters belong outside the core package.
39. Client rendering, shadows, post-fx and grass. Source: spoint client/core. Status: decision. Out of scope for a physics and netcode package.
40. Editor, hot reload and HUD panels. Source: spoint client/editor, src/debug, HMR runtime. Status: decision.
41. Savi's 93 documented endpoints (39 published, 21 per-game, 30 manual-only, 3 disabled). Source: savi ENDPOINTS.md. Status: decision. jayzee serves no HTTP. Savi documents them. The spawn feed and resolve parts are in row 1.

## Split: spoint's missing witnesses versus jayzee's missing features

- spoint-owned, not built in jayzee: package.json scripts check:bundle-freshness and check:bundle-freshness:require-bundle call scripts/bundle-freshness-witness.mjs, which does not exist. spoint is read-only for jayzee, so the fix belongs to the spoint owner.
- jayzee feature, not started: bundle freshness as a feature is not part of the spoint physics or netcode surface. It stays out of scope until the owner decides it belongs in this package.
- spoint-owned, no witness: fire kernel and behaviour (src/shared/fire, src/behaviours/fire*.js). jayzee will write its own witness for the fire kernel in row 26.

## Conflicts to resolve in the sources

- savi ENDPOINTS.md lists GET /api/games/{appId} as a per-game route. savi FAULTS F1 says it returns game:null for every id. Resolve in savi.
- The savi type count is 305 in some docs and 308 in another. Resolve in savi.
- The spawn learnings marked OPEN disagree with each other. Reconcile with spawn before implementing them: 39, 54, 71, 73, 68, 29, 20, and process items 24, 25 and 27.
- spoint's two heightfield bakes have different codeVersions. One is stale.
- spoint's Wave C docs name files that do not exist. Owner decision: build them or correct the docs.
