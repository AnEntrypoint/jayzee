import { finish, gate } from './lib/gate.mjs'
import { createChartReanchorService } from '../src/chart-pure/chartReanchorService.js'
import { createTerrainReanchor } from '../src/terrain-pure/chartReanchorTerrain.js'
import { createFieldLattice } from '../src/terrain-pure/fieldLattice.js'
import { createHeightFieldPhysics, createHeightFieldStreamer } from '../src/terrain-pure/heightFieldStreamer.js'
import { createPlanetFrame } from '../src/terrain-pure/planetFrame.js'
import { createGroundCharacterWorld } from '../src/tick-host/groundCharacterWorld.js'

const fail = (what) => { throw new Error(what) }
const expect = (actual, expected, what) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) fail(`${what}: expected ${e} got ${a}`)
}

const RADIUS = 20000
const SPEED = 24
const DT = 0.5
const GRAVITY = 9.81
const STICK_SPEED = 6
const CHARACTER = { radius: 0.4, halfHeight: 0.5 }
const FOOT = CHARACTER.radius + CHARACTER.halfHeight
const TARGET = [0, 1, 0]
const STEPS = 2400

const sampler = {
  radius: RADIUS,
  hashVersion: 1,
  heightAt: (d) => 30 * Math.sin(7 * d[0] + 1) * Math.cos(5 * d[1]) + 15 * Math.sin(11 * d[2] + 2 * d[0]),
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const worldOf = (frame, p) => {
  const lift = RADIUS + frame.anchorHeight + p[1]
  return [0, 1, 2].map((i) => frame.up[i] * lift + frame.east[i] * p[0] + frame.north[i] * p[2])
}

const buildWorld = ({ migrateBodies = true } = {}) => {
  const frame = createPlanetFrame({ sampler, anchorDir: [1, 0, 0], offsetY: 0 })
  const streamer = createHeightFieldStreamer({ frame, fieldCount: 1, nodes: 65, spacing: 2, defer: () => Promise.resolve() })
  const physics = createHeightFieldPhysics(streamer)
  const bodies = createGroundCharacterWorld({ heightAt: (x, z) => streamer.surfaceY(x, z) })
  const start = [0, frame.groundHeightLocal(0, 0) + FOOT, 0]
  const id = bodies.addPlayerCharacter(CHARACTER.radius, CHARACTER.halfHeight, start, 80)
  const position = [0, 0, 0], velocity = [0, 0, 0]
  const service = createChartReanchorService({
    frame, radius: RADIUS,
    playerDirs: () => { bodies.readCharacterPosition(id, position); return [frame.localToDir(position[0], position[2], position[1])] },
  })
  let clock = 0
  const terrain = createTerrainReanchor({
    frame, sampler, offsetY: 0, reliefScale: undefined, physics, heightStreamer: streamer, colliderStreamers: [],
    getPlayers: () => { bodies.readCharacterPosition(id, position); return [[position[0], position[2]]] }, blockers: [], now: () => clock++, createFieldLattice,
  })
  service.addTerrainMigrator(terrain)
  const record = { worldJump: 0, speedChange: 0, reanchors: 0 }
  service.onReanchor((event) => {
    bodies.readCharacterPosition(id, position)
    bodies.readCharacterVelocity(id, velocity)
    const before = worldOf({ up: event.from.up, east: event.from.east, north: event.from.north, anchorHeight: event.from.anchorHeight }, position)
    const speedBefore = Math.hypot(velocity[0], velocity[1], velocity[2])
    if (migrateBodies) {
      const grounded = bodies.getCharacterGroundState(id)
      bodies.setCharacterPosition(id, event.transfer.point([position[0], position[1], position[2]]))
      bodies.setCharacterVelocity(id, event.transfer.vec([velocity[0], velocity[1], velocity[2]]))
      if (grounded) bodies.updateCharacter(id, 0)
    }
    bodies.readCharacterPosition(id, position)
    bodies.readCharacterVelocity(id, velocity)
    const after = worldOf(frame, position)
    record.worldJump = Math.max(record.worldJump, Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]))
    record.speedChange = Math.max(record.speedChange, Math.abs(Math.hypot(velocity[0], velocity[1], velocity[2]) - speedBefore))
    record.reanchors++
  })
  return { frame, streamer, physics, bodies, id, service, record }
}

const run = async (world, steps, onStep = () => {}) => {
  const { frame, streamer, physics, bodies, id, service } = world
  const position = [0, 0, 0], velocity = [0, 0, 0]
  const tally = { grounded: 0, airborne: 0, worstFloorGap: 0, rays: 0, rayHits: 0, worstRayGap: 0, upRayHits: 0, shortRayHits: 0, lostGround: 0, startAngle: 0, endAngle: 0 }
  for (let step = 1; step <= steps; step++) {
    bodies.readCharacterPosition(id, position)
    streamer.update([[position[0], position[2]]])
    for (let attempt = 0; attempt < 6; attempt++) {
      const refusalsBefore = service.refusalCount
      const event = service.step()
      if (event) { bodies.readCharacterPosition(id, position); streamer.update([[position[0], position[2]]]); break }
      if (service.refusalCount === refusalsBefore) break
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    }
    bodies.readCharacterPosition(id, position)
    bodies.readCharacterVelocity(id, velocity)
    const here = frame.localToDir(position[0], position[2], position[1])
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(here, TARGET))))
    if (step === 1) tally.startAngle = angle
    tally.endAngle = angle
    const toward = [TARGET[0] - here[0] * dot(here, TARGET), TARGET[1] - here[1] * dot(here, TARGET), TARGET[2] - here[2] * dot(here, TARGET)]
    const tx = dot(toward, frame.east), tz = dot(toward, frame.north)
    const tangent = Math.hypot(tx, tz) || 1
    const grounded = bodies.getCharacterGroundState(id)
    const vy = grounded ? -STICK_SPEED : velocity[1] - GRAVITY * DT
    bodies.setCharacterVelocity(id, [tx / tangent * SPEED, vy, tz / tangent * SPEED])
    bodies.updateCharacter(id, DT)
    bodies.step()
    bodies.readCharacterPosition(id, position)
    const ground = frame.groundHeightLocal(position[0], position[2])
    const surface = streamer.surfaceY(position[0], position[2])
    if (surface === null) tally.lostGround++
    if (bodies.getCharacterGroundState(id)) {
      tally.grounded++
      tally.worstFloorGap = Math.max(tally.worstFloorGap, Math.abs(position[1] - FOOT - ground))
    } else tally.airborne++
    if (step % 20 === 0 && surface !== null) {
      const eye = [position[0], position[1] + 1.2, position[2]]
      const aim = [tx / tangent, -0.35, tz / tangent]
      const hit = physics.raycast(eye, aim, 40)
      tally.rays++
      if (hit.hit) {
        tally.rayHits++
        tally.worstRayGap = Math.max(tally.worstRayGap, Math.abs(hit.position[1] - frame.groundHeightLocal(hit.position[0], hit.position[2])))
        const along = Math.hypot(hit.position[0] - eye[0], hit.position[1] - eye[1], hit.position[2] - eye[2])
        tally.worstRayGap = Math.max(tally.worstRayGap, Math.abs(along - hit.distance))
      }
      if (physics.raycast(eye, [tx / tangent, 0.6, tz / tangent], 40).hit) tally.upRayHits++
      if (physics.raycast(eye, aim, 0.5).hit) tally.shortRayHits++
    }
    onStep(step)
  }
  return tally
}

const main = (async () => {
  const world = buildWorld()
  const tally = await run(world, STEPS)
  return { world, tally }
})()

gate('a body driven by its own velocity over the streamed collision surface crosses more than 20 chart re-anchors and covers a quarter of the planet', async () => {
  const { world, tally } = await main
  if (!(world.record.reanchors > 20)) fail(`${world.record.reanchors} re-anchors`)
  if (!(tally.startAngle > 1.5 && tally.endAngle < 0.2)) fail(`the body went from ${tally.startAngle} rad to ${tally.endAngle} rad off the target`)
  expect(tally.lostGround, 0, 'steps with no collision surface under the body')
})

gate('the body stays grounded on the solved terrain: grounded on at least 98 steps in 100, and its feet within 5 cm of the ground whenever grounded', async () => {
  const { tally } = await main
  if (!(tally.grounded / (tally.grounded + tally.airborne) >= 0.98)) fail(`grounded ${tally.grounded}, airborne ${tally.airborne}`)
  if (!(tally.worstFloorGap < 0.05)) fail(`feet were ${tally.worstFloorGap} m from the ground`)
})

gate('each re-anchor re-expresses the body: its planet-centred position moves less than a millimetre and its speed is kept to a micrometre a second', async () => {
  const { world } = await main
  if (!(world.record.worldJump < 1e-3)) fail(`the body jumped ${world.record.worldJump} m`)
  if (!(world.record.speedChange < 1e-6)) fail(`the speed changed by ${world.record.speedChange} m/s`)
})

gate('slanted rays from the body eye hit the streamed surface within 2 cm of the solved ground, an upward ray misses and a ray shorter than the eye height misses', async () => {
  const { tally, world } = await main
  if (!(tally.rays >= 100)) fail(`${tally.rays} rays cast`)
  expect(tally.rayHits, tally.rays, 'slanted rays that hit')
  if (!(tally.worstRayGap < 0.02)) fail(`a ray hit ${tally.worstRayGap} m from the ground`)
  expect([tally.upRayHits, tally.shortRayHits], [0, 0], 'upward and short rays that hit')
  if (!(world.physics.stats.marchedRays >= 300 && world.physics.stats.downRays > 0)) fail(`marched ${world.physics.stats.marchedRays}, straight down ${world.physics.stats.downRays}`)
})

gate('the ray normal faces up the slope and the ray refuses a zero direction, a zero reach and a non-finite origin', async () => {
  const { world } = await main
  const position = world.bodies.getCharacterPosition(world.id)
  world.streamer.update([[position[0], position[2]]])
  const hit = world.physics.raycast([position[0], position[1] + 5, position[2]], [0.3, -1, 0.1], 30)
  if (!hit.hit) fail('the probe ray missed')
  const n = hit.normal
  const h = (x, z) => world.frame.groundHeightLocal(x, z)
  const slopeX = (h(hit.position[0] + 0.25, hit.position[2]) - h(hit.position[0] - 0.25, hit.position[2])) / 0.5
  const slopeZ = (h(hit.position[0], hit.position[2] + 0.25) - h(hit.position[0], hit.position[2] - 0.25)) / 0.5
  const length = Math.hypot(slopeX, 1, slopeZ)
  const want = [-slopeX / length, 1 / length, -slopeZ / length]
  if (!(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-9 && Math.hypot(n[0] - want[0], n[1] - want[1], n[2] - want[2]) < 0.02)) fail(`normal ${n} against ${want}`)
  for (const [call, fragment] of [
    [() => world.physics.raycast([0, 0, 0], [0, 0, 0], 5), 'zero direction'],
    [() => world.physics.raycast([0, 0, 0], [1, -1, 0], 0), 'reach above zero'],
    [() => world.physics.raycast([NaN, 0, 0], [1, -1, 0], 5), 'three finite numbers'],
  ]) {
    let message = null
    try { call() } catch (error) { message = error.message }
    if (message === null || !message.includes(fragment)) fail(`expected a refusal naming "${fragment}", got ${message}`)
  }
})

gate('negative control: a body that is not re-expressed at a re-anchor jumps by more than a hundred metres in planet-centred space', async () => {
  const world = buildWorld({ migrateBodies: false })
  let stopAt = -1
  await run(world, 400, (step) => { if (stopAt === -1 && world.record.reanchors > 0) stopAt = step })
  if (!(world.record.reanchors > 0)) fail('the control walk did not re-anchor')
  if (!(world.record.worldJump > 100)) fail(`the unmigrated body moved only ${world.record.worldJump} m`)
})

finish()
