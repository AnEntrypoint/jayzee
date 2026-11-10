import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'
import { solverIterationsFor } from '../src/engine/solverIterations.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glue = pathToFileURL(join(root, 'engine/out/engine-core-128mib.mjs')).href

const PLAYERS = 64
const BODIES = 256
const FRAMES = 240
const TICKS_PER_FRAME = 2
const WALK_STEP_M = 40
const HEADER_BYTES = 40
const TICK_OFFSET = 24
const ROW_BYTES = 28
const ABSOLUTE_TOLERANCE_M = 0.01
const SPACING_M = 2.5
const SETTLE_TICKS = 30

const module = await loadEngineModule(glue, resolvePlan({ players: PLAYERS, budgetBytes: 128 * 1024 * 1024 }))
const configured = module._engine_world_configure(BODIES, 60, 0, 0, 0.5, 0, solverIterationsFor(PLAYERS))
assert.equal(configured, 0, 'engine_world_configure')
for (let i = 0; i < BODIES; i++) {
  const handle = module._engine_spawn((i % 16) * SPACING_M, Math.floor(i / 16) * SPACING_M, 0, 0, 0, 0)
  assert.ok(handle >= 0, 'spawn ' + i)
}
const poseBytes = module._engine_pose_bytes()
const buffer = module._engine_pose_reserve()

const decode = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const origin = [view.getFloat64(0, true), view.getFloat64(8, true), view.getFloat64(16, true)]
  const bodies = view.getUint32(32, true)
  const rows = []
  for (let i = 0; i < bodies; i++) {
    const at = HEADER_BYTES + i * ROW_BYTES
    rows.push([view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)])
  }
  return { origin, bodies, rows }
}

const absolute = (frame) => frame.rows.map((row) => [row[0] + frame.origin[0], row[1] + frame.origin[1], row[2] + frame.origin[2]])

const firstBreak = (decoded) => {
  for (let k = 1; k < decoded.length; k++) {
    const before = absolute(decoded[k - 1])
    const after = absolute(decoded[k])
    for (let i = 0; i < BODIES; i++) {
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(after[i][axis] - before[i][axis]) > ABSOLUTE_TOLERANCE_M) return { frame: k, body: i, axis }
      }
    }
  }
  return null
}

const frames = []
for (let t = 0; t < SETTLE_TICKS; t++) module._engine_tick(1)
for (let f = 0; f < FRAMES; f++) {
  assert.equal(module._engine_follow(f * WALK_STEP_M, 0, 0), 0, 'engine_follow at frame ' + f)
  for (let t = 0; t < TICKS_PER_FRAME; t++) module._engine_tick(1)
  const written = module._engine_pose_export(buffer, poseBytes)
  assert.equal(written, poseBytes, 'pose export at frame ' + f)
  frames.push(module.HEAPU8.slice(buffer, buffer + poseBytes))
}
const decoded = frames.map(decode)

gate('the pose buffer is the header plus one 28-byte row per body, allocated once', () => {
  assert.equal(poseBytes, HEADER_BYTES + decoded[0].bodies * ROW_BYTES)
  assert.equal(module._engine_pose_reserve(), buffer)
})

gate('the origin walk crosses rebases, and the origin in the buffer changes with them', () => {
  const origins = new Set(decoded.map((d) => d.origin.join(',')))
  assert.ok(origins.size >= 5, 'expected at least 5 distinct origins, saw ' + origins.size)
})

gate('the buffer carries every body row and the same tick order as the world', () => {
  for (const d of decoded) assert.equal(d.bodies, decoded[0].bodies)
  assert.ok(decoded[0].bodies >= BODIES, 'the static pool holds every spawned body')
  const ticks = frames.map((bytes) => Number(new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(TICK_OFFSET, true)))
  for (let k = 1; k < ticks.length; k++) assert.equal(ticks[k], ticks[k - 1] + TICKS_PER_FRAME)
})

gate('absolute body positions stay continuous across every rebase in the same frame', () => {
  assert.equal(firstBreak(decoded), null)
})

gate('negative control: an origin that lags its rows by 1 m breaks continuity', () => {
  const tampered = decoded.map((d) => ({ origin: [...d.origin], bodies: d.bodies, rows: d.rows }))
  const lagged = tampered.findIndex((d, k) => k > 0 && d.origin[0] !== tampered[k - 1].origin[0])
  assert.ok(lagged > 0, 'no rebase frame to tamper with')
  tampered[lagged].origin[0] += 1
  assert.notEqual(firstBreak(tampered), null)
})

gate('the renderer read path replays every recorded frame exactly, newest first', () => {
  for (let k = FRAMES - 1; k >= 0; k--) {
    module.HEAPU8.set(frames[k], buffer)
    assert.equal(module._engine_pose_import(buffer, poseBytes), 0, 'import at frame ' + k)
    assert.equal(module._engine_pose_export(buffer, poseBytes), poseBytes)
    const replayed = module.HEAPU8.slice(buffer, buffer + poseBytes)
    for (let b = 0; b < poseBytes; b++) {
      if (b >= TICK_OFFSET && b < TICK_OFFSET + 8) continue
      assert.equal(replayed[b], frames[k][b], 'frame ' + k + ' byte ' + b)
    }
  }
})

gate('a truncated or mis-sized buffer is refused with a nonzero status', () => {
  assert.notEqual(module._engine_pose_import(buffer, poseBytes - 1), 0)
  assert.notEqual(module._engine_pose_import(buffer, 10), 0)
})

finish()
