import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { MIRROR_CFG, FLOOR_TILES, runMirrorScenario } from './lib/collisionMirrorScenario.mjs'
import { createCollisionMirror } from '../src/client/CollisionMirror.js'
import { MessageHandler } from '../src/client/MessageHandler.js'
import { MSG } from '../src/protocol/messages.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/collision-mirror.json', import.meta.url), 'utf8'))

const mirror = createCollisionMirror()
const got = await runMirrorScenario(mirror)
mirror.dispose()

const floorless = createCollisionMirror()
await floorless.configure(MIRROR_CFG)
const unfloored = { position: [4, 2, 4], velocity: [0, 0, 0], onGround: false }
for (let frame = 0; frame < 25; frame++) {
  if (floorless.covers(unfloored.position)) floorless.step(unfloored, null, 1 / 60, MIRROR_CFG.gravity[1], unfloored.onGround)
  else floorless.noteUncovered()
}
const floorlessUncovered = floorless.getStats().uncoveredSteps
floorless.dispose()

const taller = createCollisionMirror()
await taller.configure({ ...MIRROR_CFG, radius: 0.6 })
for (const msg of FLOOR_TILES) taller.onTile(msg)
const tallState = { position: [4, 2, 4], velocity: [0, 0, 0], onGround: false }
for (let frame = 0; frame < 120; frame++) {
  if (taller.covers(tallState.position)) taller.step(tallState, null, 1 / 60, MIRROR_CFG.gravity[1], tallState.onGround)
}
taller.dispose()

const handler = new MessageHandler({ now: () => 0, renderNow: () => 0, createCollisionMirror: () => createCollisionMirror() })
handler.handleMessage(MSG.COLLISION_CONFIG, { ...MIRROR_CFG })
const defaultMirror = handler.getCollisionMirror()
for (let i = 0; i < 500 && !defaultMirror?.ready; i++) await new Promise((resolve) => setTimeout(resolve, 5))
for (const msg of FLOOR_TILES) defaultMirror.onTile(msg)
const handlerCovers = defaultMirror.covers([4, 2, 4])
defaultMirror.dispose()

gate('the fixture was recorded from the same config and tiles this gate runs', () => {
  assert.deepEqual(fixture.cfg, MIRROR_CFG)
  assert.equal(fixture.records.length, got.length)
})

gate('the jayzee mirror reproduces every spoint record frame by frame over the walk, jump, crouch and re-anchor', () => {
  assert.equal(JSON.stringify(got), JSON.stringify(fixture.records))
})

gate('the character lands on the floor at the capsule height and stands on it, as spoint recorded', () => {
  const landed = got[30]
  assert.equal(landed.onGround, true)
  assert.ok(Math.abs(landed.groundY - (MIRROR_CFG.halfHeight + MIRROR_CFG.radius)) < 1e-6, 'groundY ' + landed.groundY)
  assert.ok(Math.abs(landed.position[1] - (MIRROR_CFG.halfHeight + MIRROR_CFG.radius)) < 1e-6, 'y ' + landed.position[1])
})

gate('the re-anchor moves the floor with the character, so the shifted position is still covered', () => {
  assert.equal(got[90].covers, true)
  assert.equal(got[109].onGround, true)
})

gate('a position off every tile is not covered and the probe records it', () => {
  assert.deepEqual(got[got.length - 1], { outside: true, covers: false })
})

gate('negative control: without a covering tile the mirror never steps and counts each uncovered step', () => {
  assert.equal(floorlessUncovered, 25)
  assert.deepEqual(unfloored.position, [4, 2, 4])
})

gate('negative control: a taller capsule lands higher, so the recorded height is the capsule, not a constant', () => {
  assert.notEqual(tallState.position[1], MIRROR_CFG.halfHeight + MIRROR_CFG.radius)
  assert.equal(tallState.position[1], MIRROR_CFG.halfHeight + 0.6)
})

gate('the default factory through MessageHandler configures a mirror that covers the floor', () => {
  assert.equal(handlerCovers, true)
})

finish()
