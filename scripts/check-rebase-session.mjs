import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { PLANET_RADIUS_M } from '../src/engine/sphere.js'
import { RENDER_COLLISION_RANGE_M, RENDER_COLLISION_TOLERANCE_M } from '../src/engine/cameraRelative.js'
import { PHYSICS_REBASE_M, bodyAbsolute, bodyRelative, rebaseBodyByShift, rebaseDue, rebaseShift } from '../src/engine/physicsOrigin.js'

const R = PLANET_RADIUS_M
const START = Object.freeze([0, R, 0])
const BODIES = Object.freeze([
  [0.3, R + 2.3, 0.1],
  [700.7, R + 1.1, -300.3],
  [-950.2, R + 0.7, 410.9],
  [12.5, R + 40.25, -3.75],
])
const OPEN_CEILING_M = 0.02
const STEP_M = 50.37
const TURN_EVERY = 40

const lcg = (seedIn) => {
  let seed = seedIn
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const walkOutAndBack = (steps, seed) => function* walk() {
  const random = lcg(seed)
  const eye = [...START]
  const out = []
  let heading = random() * 2 * Math.PI
  for (let s = 0; s < steps; s++) {
    if (s % TURN_EVERY === 0) heading += (random() - 0.5) * 1.5
    eye[0] += Math.cos(heading) * STEP_M
    eye[2] += Math.sin(heading) * STEP_M
    eye[1] = R + 30 * Math.sin(s / 50)
    out.push([...eye])
    yield eye
  }
  for (let s = out.length - 1; s >= 0; s--) yield out[s]
  yield START
}

const wander = (hops, radiusM, seed) => function* hop() {
  const random = lcg(seed)
  for (let s = 0; s < hops; s++) {
    const a = random() * 2 * Math.PI
    const r = radiusM * Math.sqrt(random())
    yield [r * Math.cos(a), R + 20 * random(), r * Math.sin(a)]
  }
  yield START
}

const shuttle = (trips) => function* trip() {
  for (let s = 0; s < trips; s++) yield [s % 2 === 0 ? 1100.37 : 0, R, s % 4 < 2 ? 0 : 20.5]
  yield START
}

const floatShiftMirror = () => {
  const origin = [0, 0, 0]
  const shift = [0, 0, 0]
  const relatives = []
  let rebases = 0
  const follow = (point) => {
    if (!rebaseDue(origin, point, PHYSICS_REBASE_M)) return
    rebaseShift(origin, point, shift)
    for (const rel of relatives) rebaseBodyByShift(rel, shift, rel)
    origin[0] = point[0]
    origin[1] = point[1]
    origin[2] = point[2]
    rebases += 1
  }
  return {
    follow,
    spawn(point) {
      follow(point)
      relatives.push(bodyRelative(point, origin, [0, 0, 0]))
    },
    position: (i, out) => bodyAbsolute(relatives[i], origin, out),
    rebases: () => rebases,
  }
}

const anchoredMirror = () => {
  const origin = [0, 0, 0]
  const anchors = []
  const rel = [0, 0, 0]
  return {
    follow(point) {
      if (!rebaseDue(origin, point, PHYSICS_REBASE_M)) return
      origin[0] = point[0]
      origin[1] = point[1]
      origin[2] = point[2]
    },
    spawn(point) {
      this.follow(point)
      anchors.push([...point])
    },
    position: (i, out) => bodyAbsolute(bodyRelative(anchors[i], origin, rel), origin, out),
  }
}

const errorOf = (p, truth) => Math.max(Math.abs(p[0] - truth[0]), Math.abs(p[1] - truth[1]), Math.abs(p[2] - truth[2]))
const reachOf = (eye, truth) => Math.hypot(eye[0] - truth[0], eye[1] - truth[1], eye[2] - truth[2])

const runSession = async (path) => {
  const world = await createEngineWorld({ capacity: 8, tickRate: 60, gravity: 0, drag: 0, radius: 0.5, restitution: 0 })
  const mirror = floatShiftMirror()
  const anchored = anchoredMirror()
  const handles = BODIES.map((b) => {
    mirror.spawn(b)
    anchored.spawn(b)
    return world.spawn(b)
  })
  const rebasesAtStart = world.rebaseCount
  const mirrorRebasesAtStart = mirror.rebases()
  const got = [0, 0, 0]
  const want = [0, 0, 0]
  const fixed = [0, 0, 0]
  const record = { steps: 0, distanceKm: 0, farthestKm: 0, rebases: 0, mirrorWorstInRangeM: 0, mirrorFinalM: 0, worstInRangeM: 0, worstAnywhereM: 0, finalM: 0, firstRebaseOverTolerance: null, anchoredWorstInRangeM: 0, anchoredFinalM: 0 }
  let last = null
  const t0 = performance.now()
  for (const eye of path()) {
    world.follow(eye)
    mirror.follow(eye)
    anchored.follow(eye)
    record.steps += 1
    if (last !== null) record.distanceKm += reachOf(eye, last) / 1000
    last = [eye[0], eye[1], eye[2]]
    record.farthestKm = Math.max(record.farthestKm, reachOf(eye, START) / 1000)
    for (let i = 0; i < BODIES.length; i++) {
      world.position(handles[i], got)
      mirror.position(i, want)
      const error = errorOf(got, BODIES[i])
      record.worstAnywhereM = Math.max(record.worstAnywhereM, error)
      if (reachOf(eye, BODIES[i]) > RENDER_COLLISION_RANGE_M) continue
      record.worstInRangeM = Math.max(record.worstInRangeM, error)
      record.mirrorWorstInRangeM = Math.max(record.mirrorWorstInRangeM, errorOf(want, BODIES[i]))
      if (error > RENDER_COLLISION_TOLERANCE_M && record.firstRebaseOverTolerance === null) record.firstRebaseOverTolerance = world.rebaseCount - rebasesAtStart
      record.anchoredWorstInRangeM = Math.max(record.anchoredWorstInRangeM, errorOf(anchored.position(i, fixed), BODIES[i]))
    }
  }
  record.wallMs = Math.round(performance.now() - t0)
  record.rebases = world.rebaseCount - rebasesAtStart
  assert.equal(record.rebases, mirror.rebases() - mirrorRebasesAtStart, 'the mirror and the engine counted different rebases')
  for (let i = 0; i < BODIES.length; i++) {
    record.finalM = Math.max(record.finalM, errorOf(world.position(handles[i], got), BODIES[i]))
    record.mirrorFinalM = Math.max(record.mirrorFinalM, errorOf(mirror.position(i, want), BODIES[i]))
    record.anchoredFinalM = Math.max(record.anchoredFinalM, errorOf(anchored.position(i, fixed), BODIES[i]))
  }
  return record
}

const SESSIONS = Object.freeze([
  { name: 'walk', label: 'an 81 km walk, 40 km out with a turn every 2 km and back to the start', path: walkOutAndBack(800, 7), minRebases: 60, within: false },
  { name: 'wander', label: '5000 hops inside a 3 km disc around the bodies, then back to the start', path: wander(5000, 3000, 11), minRebases: 2000, within: false },
  { name: 'shuttle', label: '5000 trips between two points 1100 m apart, then back to the start', path: shuttle(5000), minRebases: 4000, within: true },
])

const records = {}
for (const session of SESSIONS) {
  records[session.name] = await runSession(session.path)
  console.log('session ' + JSON.stringify({ name: session.name, toleranceM: RENDER_COLLISION_TOLERANCE_M, ...records[session.name] }))
}

for (const session of SESSIONS) {
  const r = records[session.name]
  gate(session.name + ': ' + session.label + ', rebases at least ' + session.minRebases + ' times on the engine', () => {
    assert.ok(r.rebases >= session.minRebases, 'only ' + r.rebases + ' rebases')
  })
  gate(session.name + ': the engine keeps every body within ' + RENDER_COLLISION_TOLERANCE_M + ' m of its float64 placement, within ' + RENDER_COLLISION_RANGE_M + ' m of the eye, anywhere on the path and at the end', () => {
    assert.ok(r.worstInRangeM <= RENDER_COLLISION_TOLERANCE_M, 'worst in range ' + r.worstInRangeM + ' m')
    assert.ok(r.worstAnywhereM <= RENDER_COLLISION_TOLERANCE_M, 'worst anywhere ' + r.worstAnywhereM + ' m')
    assert.ok(r.finalM <= RENDER_COLLISION_TOLERANCE_M, 'final ' + r.finalM + ' m')
    assert.equal(r.firstRebaseOverTolerance, null)
  })
  gate(session.name + ': a rebase from each body\'s float64 placement, in JavaScript only, stays within ' + RENDER_COLLISION_TOLERANCE_M + ' m in range and at the end', () => {
    assert.ok(r.anchoredWorstInRangeM <= RENDER_COLLISION_TOLERANCE_M, 'anchored worst ' + r.anchoredWorstInRangeM + ' m')
    assert.ok(r.anchoredFinalM <= RENDER_COLLISION_TOLERANCE_M, 'anchored final ' + r.anchoredFinalM + ' m')
  })
  if (session.within) {
    gate(session.name + ': control: the float32-shift arithmetic also stays within ' + RENDER_COLLISION_TOLERANCE_M + ' m here, because each shift is undone by its exact opposite', () => {
      assert.ok(r.mirrorWorstInRangeM <= RENDER_COLLISION_TOLERANCE_M, 'mirror worst ' + r.mirrorWorstInRangeM + ' m')
      assert.ok(r.mirrorFinalM <= RENDER_COLLISION_TOLERANCE_M, 'mirror final ' + r.mirrorFinalM + ' m')
    })
  } else {
    gate(session.name + ': control: the float32-shift arithmetic the engine used before, mirrored in JavaScript, passes ' + RENDER_COLLISION_TOLERANCE_M + ' m in range and at the end on this path and stays under ' + OPEN_CEILING_M + ' m', () => {
      assert.ok(r.mirrorWorstInRangeM > RENDER_COLLISION_TOLERANCE_M, 'mirror worst in range ' + r.mirrorWorstInRangeM + ' m is within the tolerance, so this path no longer shows the drift')
      assert.ok(r.mirrorFinalM > RENDER_COLLISION_TOLERANCE_M, 'mirror final ' + r.mirrorFinalM + ' m is within the tolerance, so this path no longer shows the drift')
      assert.ok(r.mirrorWorstInRangeM <= OPEN_CEILING_M, 'mirror worst in range ' + r.mirrorWorstInRangeM + ' m')
    })
  }
}

finish()
