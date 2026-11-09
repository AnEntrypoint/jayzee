# Wait sites in the physics and readback phases

Scope: the two frame phases the page reports as `physics` and `readback` (`scripts/browser/engine-render-browser.js` takes them from the engine's phase timers, `engine/src/phase_timer.h`). They are the two scopes in `World::step` (`engine/src/world.cpp:423-438`): the physics scope around `runtime_->physics.Update`, and the readback scope around the `sync` loop. The read is of the working tree at this commit.

The engine build is single-threaded. `ENGINE_THREADS` is not defined in `engine/CMakeLists.txt`, `engine/build.sh` or `engine/src`, so `World::Runtime` takes `JPH::JobSystemSingleThreaded` (`engine/src/world.cpp:122-125`).

## Sites

| phase | call | file and line | kind of wait | result |
|---|---|---|---|---|
| physics | `runtime_->physics.Update(dt, 1, &temp, &jobs)` | `engine/src/world.cpp:429` | Jolt job barrier | none. `JobSystemSingleThreaded::QueueJob` runs each job inline (`Jolt/Core/JobSystemSingleThreaded.cpp`, the `Execute` call at line 41 of the pinned 1.1.0 source), and `WaitForJobs` is an empty function (line 60). |
| physics | body locks taken by the solver and the broadphase | inside `Update` | `SharedMutex` read and write locks (`Jolt/Core/Mutex.h:165`) | none. One thread takes every lock, so each acquire is uncontended. |
| physics | radial gravity step listener | `engine/src/world.cpp:99` calls `applyRadialGravity` (`world.cpp:403-423`) | body lock per call to `IsActive`, `GetCenterOfMassPosition`, `AddLinearVelocity`, `GetLinearVelocity`, `TryGetBody` | none. The lock is uncontended. The listener runs inside `Update`, so its time is part of the physics phase. |
| readback | `sync(slot)` for each alive slot | `engine/src/world.cpp:431-437`, body at `world.cpp:474-496` | `BodyLockRead` in `BodyInterface::GetPosition` (`Jolt/Physics/Body/BodyInterface.cpp:479-485`), `GetLinearVelocity` (`:611-617`) and `GetRotation` | none. Each lock is uncontended, and the phase writes host arrays `positions_`, `velocities_` and `transforms_`. |
| readback | GPU readback fence | none | none | The readback phase makes no GPU call and waits on no fence. GPU work is in the `upload`, `acquire` and `submit` phases (`engine/src/render/render_webgpu.cpp:450`, `:484`, `:517`), which this record does not cover. |

No site in these two phases blocks on another thread, a fence or a barrier. The physics and readback phases contain no wait call that the engine makes.

## Measured durations

Page rows of `build/diag/paired-E/r1-G1.page.json` and `r2-G1.page.json`, in milliseconds. Medians over the frames stated.

| group | frames | physics median | readback median |
|---|---|---|---|
| no body awake (active 0) | 470 per run | 1.4 | 2.8 |
| all 10240 bodies awake | 62 per run | 36.4 (r1) and 36.1 (r2) | 2.1 (r1) and 2.0 (r2) |
| blocked stalls, median over all of them | 68 (r1) and 119 (r2) | 4.1 (r1) and 11.8 (r2) | 4.0 (r1) and 2.7 (r2) |

## Reason

Inherent or defect: neither. No wait site exists in these phases, so there is no wait to remove and no code defect in the waits. The blocked stall time inside these phases is wall time of the renderer's main thread that no call the engine makes explains. The new G1 runs with a sampler that keeps up are recorded in `docs/stall-causes/blocked-stall-cause.md`. Phase coverage there shows every blocked stall sits inside the physics and readback phases. In r2 most blocked stalls are shorter than two 10 ms CPU jiffies, so the counter cannot separate CPU from waiting for them. In r1 about 44% of the longer blocked stalls were off the CPU with no cgroup pressure. The per-thread scheduler stats of round 3 split that time into 42% runnable and waiting for a CPU, and 3% sleeping. The wait is the scheduler's run queue under the G1 burn, which no engine or page call makes, and it cannot be removed without changing the burn. The record is in the round 3 section of `blocked-stall-cause.md`.

If the job system were threaded (`ENGINE_THREADS`), Jolt's barrier would become a real wait on the main thread. That is the recorded `ENGINE_THREADS` item, not a site in this build.
