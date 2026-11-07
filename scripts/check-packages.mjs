import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as core from '../src/packages/spoint-core/index.js'
import * as ecs from '../src/packages/ecs/index.js'
import * as mapspinner from '../src/packages/mapspinner/index.js'
import * as streamingGltf from '../src/packages/streaming-gltf/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const schemaDir = join(here, '..', 'src', 'packages', 'streaming-gltf', 'schema')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, message) => {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}
const near = (actual, expected, tolerance, message) => {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: got ${actual}, expected ${expected} within ${tolerance}`)
}
const throwsOf = (ErrorClass, fn) => {
  try {
    fn()
  } catch (error) {
    return error instanceof ErrorClass
  }
  return false
}
const hex = (value) => '0x' + value.toString(16).padStart(8, '0')

const fnv1Variant = (bytes) => {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash = Math.imul(hash, 16777619) >>> 0
    hash = (hash ^ byte) >>> 0
  }
  return hash
}

const seededUnitQuaternions = (count) => {
  let state = 12345
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296 * 2 - 1
  }
  const out = []
  while (out.length < count) {
    const q = [next(), next(), next(), next()]
    const length = Math.hypot(...q)
    if (length > 1e-3) out.push(q.map((c) => c / length))
  }
  return out
}

const sameRotationError = (a, b) => {
  const sign = a.reduce((sum, c, i) => sum + c * b[i], 0) < 0 ? -1 : 1
  return Math.max(...a.map((c, i) => Math.abs(c - sign * b[i])))
}

const quaternionFromAxisAngle = (axis, angle) => {
  const half = angle / 2
  const s = Math.sin(half)
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)]
}

const conjugate = (q) => [-q[0], -q[1], -q[2], q[3]]

gate('spoint-core exports exactly the seven ported functions', () => {
  same(Object.keys(core).sort(), ['fnv1a32', 'fnv1aFoldF64', 'fnv1aStr', 'mulQuat', 'packQuat', 'rotVec', 'unpackQuat'], 'export names')
  assert(!Object.keys(core).includes('fnv1a_32'), 'snake_case name leaked into the JavaScript surface')
})

gate('fnv1a32 reproduces the published FNV-1a vectors for empty, a and foobar', () => {
  same(hex(core.fnv1a32(new Uint8Array(0))), '0x811c9dc5', 'empty input returns the offset basis')
  same(hex(core.fnv1aStr('a')), '0xe40c292c', 'vector for a')
  same(hex(core.fnv1aStr('foobar')), '0xbf9cf968', 'vector for foobar')
  assert(fnv1Variant(new TextEncoder().encode('a')) !== core.fnv1aStr('a'), 'control: FNV-1 (multiply before xor) must differ from FNV-1a on a')
})

gate('fnv1a32 refuses anything that is not a Uint8Array', () => {
  assert(throwsOf(TypeError, () => core.fnv1a32([97])), 'a plain array was accepted')
  assert(core.fnv1a32(Uint8Array.of(97)) === core.fnv1aStr('a'), 'control: a Uint8Array of the same byte must hash the same')
})

gate('fnv1aStr hashes UTF-8 bytes rather than UTF-16 code units', () => {
  same(core.fnv1aStr('é'), core.fnv1a32(Uint8Array.of(0xc3, 0xa9)), 'e-acute as UTF-8')
  assert(core.fnv1aStr('é') !== core.fnv1a32(Uint8Array.of(0xe9, 0x00)), 'control: the UTF-16 bytes must hash differently')
})

gate('fnv1aFoldF64 folds negative zero and positive zero to one value', () => {
  const basis = 0x811c9dc5
  assert(core.fnv1aFoldF64(basis, 0) === core.fnv1aFoldF64(basis, -0), 'signed zeros hash differently')
  const rawNegativeZero = core.fnv1a32(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0x80))
  assert(core.fnv1aFoldF64(basis, -0) !== rawNegativeZero, 'control: the folded -0 must not be the raw sign-bit fold')
})

gate('fnv1aFoldF64 folds every NaN to the canonical quiet NaN', () => {
  const basis = 0x811c9dc5
  const payloadNaN = new DataView(new ArrayBuffer(8))
  payloadNaN.setBigUint64(0, 0x7ff8000000000001n, true)
  const payloadBytes = new Uint8Array(payloadNaN.buffer)
  same(core.fnv1aFoldF64(basis, Number.NaN), core.fnv1a32(Uint8Array.of(0, 0, 0, 0, 0, 0, 0xf8, 0x7f)), 'NaN folds to the canonical quiet NaN bytes')
  const rawPayloadFold = core.fnv1a32(payloadBytes)
  assert(core.fnv1aFoldF64(basis, Number.NaN) !== rawPayloadFold, 'control: a payload NaN must not fold to its raw bits')
})

gate('fnv1aFoldF64 distinguishes ordinary numbers', () => {
  const basis = 0x811c9dc5
  assert(core.fnv1aFoldF64(basis, 1) !== core.fnv1aFoldF64(basis, 2), 'two numbers folded to one hash')
  assert(core.fnv1aFoldF64(basis, 1) === core.fnv1aFoldF64(basis, 1), 'folding is not deterministic')
})

gate('packQuat and unpackQuat round-trip seeded unit quaternions within one 10-bit quantum', () => {
  let worst = 0
  for (const q of seededUnitQuaternions(200)) {
    worst = Math.max(worst, sameRotationError(core.unpackQuat(core.packQuat(...q)), q))
  }
  assert(worst < 0.002, `worst component error ${worst}`)
  const rotated = quaternionFromAxisAngle([0, 0, 1], Math.PI / 2)
  assert(sameRotationError(core.unpackQuat(core.packQuat(...rotated)), [0, 0, 0, 1]) > 0.5, 'control: a 90 degree rotation must not decode as identity')
})

gate('packQuat stores the dropped largest index in the top two bits and decodes identity to w one', () => {
  assert(core.packQuat(0, 0, 0, 1) >>> 30 === 3, 'identity should drop w')
  assert(core.packQuat(1, 0, 0, 0) >>> 30 === 0, 'control: a quaternion dominated by x should drop x')
  const identity = core.unpackQuat(core.packQuat(0, 0, 0, 1))
  near(identity[3], 1, 0.002, 'decoded w')
  for (const component of identity.slice(0, 3)) near(component, 0, 0.002, 'decoded xyz')
})

gate('packQuat round-trips a quaternion dominated by each axis in turn', () => {
  for (let axis = 0; axis < 4; axis++) {
    const q = [0.1, 0.2, 0.3, 0.4]
    q[axis] = 0.95
    const length = Math.hypot(...q)
    const unit = q.map((c) => c / length)
    assert(core.packQuat(...unit) >>> 30 === axis, `dominant axis ${axis} did not set the index bits`)
    assert(sameRotationError(core.unpackQuat(core.packQuat(...unit)), unit) < 0.002, `axis ${axis} did not round-trip`)
  }
})

gate('packQuat folds the sign of the largest component so q and -q pack to the same word', () => {
  for (const q of seededUnitQuaternions(20)) {
    assert(core.packQuat(...q) === core.packQuat(...q.map((c) => -c)), 'q and -q packed differently')
  }
  const a = core.packQuat(0.1, 0.2, 0.3, 0.9)
  const b = core.packQuat(0.3, 0.2, 0.1, 0.9)
  assert(a !== b, 'control: distinct quaternions must pack to distinct words')
})

gate('mulQuat is the Hamilton product: i times j is k and j times i is minus k', () => {
  same(core.mulQuat([1, 0, 0, 0], [0, 1, 0, 0]), [0, 0, 1, 0], 'i * j')
  same(core.mulQuat([0, 1, 0, 0], [1, 0, 0, 0]), [0, 0, -1, 0], 'j * i')
  assert(core.mulQuat([0, 1, 0, 0], [1, 0, 0, 0])[2] !== 1, 'control: j * i must not equal k')
})

gate('mulQuat by the identity leaves a quaternion unchanged and by minus one negates it', () => {
  const q = [0.1, -0.2, 0.3, 0.9]
  same(core.mulQuat(q, [0, 0, 0, 1]), q, 'q * identity')
  same(core.mulQuat(q, [0, 0, 0, -1]), q.map((c) => -c), 'q * -1')
  assert(core.mulQuat(q, [0, 0, 0, -1])[3] !== q[3], 'control: multiplying by -1 must change w')
})

gate('rotVec turns x by ninety degrees about z into y, the right-handed convention', () => {
  const q = quaternionFromAxisAngle([0, 0, 1], Math.PI / 2)
  const rotated = core.rotVec([1, 0, 0], q)
  near(rotated[0], 0, 1e-12, 'x')
  near(rotated[1], 1, 1e-12, 'y')
  near(rotated[2], 0, 1e-12, 'z')
  const inverse = core.rotVec([1, 0, 0], conjugate(q))
  near(inverse[1], -1, 1e-12, 'control: the conjugate turns x into minus y')
})

gate('rotVec agrees with the conjugation q v q* built from mulQuat', () => {
  const vectors = [[0.3, -1.2, 2.0], [1, 0, 0], [-4.5, 0.25, 0.75]]
  for (const q of seededUnitQuaternions(40)) {
    for (const v of vectors) {
      const viaRotVec = core.rotVec(v, q)
      const [x, y, z] = core.mulQuat(core.mulQuat(q, [...v, 0]), conjugate(q))
      near(viaRotVec[0], x, 1e-12, 'x')
      near(viaRotVec[1], y, 1e-12, 'y')
      near(viaRotVec[2], z, 1e-12, 'z')
    }
  }
  const q = quaternionFromAxisAngle([1, 0, 0], 0.7)
  assert(core.rotVec([0, 1, 0], q)[2] !== core.rotVec([0, 1, 0], conjugate(q))[2], 'control: conjugation must matter')
})

gate('mulQuat and rotVec refuse inputs shorter than their arity and ignore extra entries', () => {
  assert(throwsOf(RangeError, () => core.mulQuat([0, 0, 0], [0, 0, 0, 1])), 'a three-element quaternion was accepted')
  assert(throwsOf(RangeError, () => core.rotVec([1, 0], [0, 0, 0, 1])), 'a two-element vector was accepted')
  same(core.rotVec([1, 0, 0, 9], [0, 0, 0, 1]), [1, 0, 0], 'extra entries should be ignored, as Rust does')
  assert(!throwsOf(RangeError, () => core.rotVec([1, 0, 0], [0, 0, 0, 1])), 'control: an exact-length input must be accepted')
})

gate('ecs createEntity hands out increasing ids and an explicit id moves the counter past it', () => {
  const world = ecs.createWorld()
  const first = world.createEntity()
  const second = world.createEntity()
  assert(second > first, 'ids did not increase')
  const explicit = world.createEntity(5000)
  const after = world.createEntity()
  assert(after > 5000, 'the counter did not move past an explicit id')
  const low = world.createEntity(1)
  const later = world.createEntity()
  assert(later > after && world.exists(low), 'control: an explicit id below the counter must not reset it')
  assert(world.exists(explicit) && explicit !== after, 'explicit id was lost')
})

gate('ecs addComponent refuses a missing entity and stores data on a live one', () => {
  const world = ecs.createWorld()
  assert(throwsOf(Error, () => world.addComponent(987654, 'pos', { x: 1 })), 'a missing entity accepted a component')
  const id = world.createEntity()
  world.addComponent(id, 'pos', { x: 1 })
  same(world.getComponent(id, 'pos'), { x: 1 }, 'stored component')
  assert(!world.hasComponent(id, 'vel'), 'control: an absent component must read as absent')
})

gate('ecs destroyEntity removes an entity from every store and leaves its neighbours alone', () => {
  const world = ecs.createWorld()
  const doomed = world.createEntity()
  const survivor = world.createEntity()
  world.addComponent(doomed, 'pos', 1)
  world.addComponent(doomed, 'vel', 2)
  world.addComponent(survivor, 'pos', 3)
  world.destroyEntity(doomed)
  assert(!world.exists(doomed) && !world.hasComponent(doomed, 'pos') && !world.hasComponent(doomed, 'vel'), 'destroyed entity kept a component')
  assert(world.hasComponent(survivor, 'pos') && world.entityCount === 1, 'control: the surviving entity must keep its component')
  world.destroyEntity(987654)
  assert(world.entityCount === 1, 'destroying an unknown id changed the count')
})

gate('ecs query has, not and hasAny select exactly the entities their clauses name', () => {
  const world = ecs.createWorld()
  const a = world.createEntity()
  const b = world.createEntity()
  const c = world.createEntity()
  world.addComponent(a, 'pos', 1)
  world.addComponent(a, 'vel', 1)
  world.addComponent(b, 'pos', 2)
  world.addTag(b, 'dead')
  world.addComponent(c, 'vel', 3)
  const withoutDead = ecs.createQuery(world, { has: ['pos'], not: ['dead'] }).refresh()
  same(withoutDead, [a], 'has pos, not dead')
  same(ecs.createQuery(world, { has: ['pos'] }).refresh(), [a, b], 'control: without the not clause the dead entity is selected')
  same(ecs.createQuery(world, { hasAny: ['vel', 'dead'] }).refresh(), [a, b, c], 'hasAny vel or dead')
  same(ecs.createQuery(world, { has: ['pos'], hasAny: ['vel', 'dead'] }).refresh(), [a, b], 'has pos and any of vel or dead')
})

gate('ecs query.changed follows world mutations and clears on refresh', () => {
  const world = ecs.createWorld()
  const id = world.createEntity()
  world.addComponent(id, 'pos', 1)
  const query = ecs.createQuery(world, { has: ['pos'] })
  query.refresh()
  assert(!query.changed(), 'a fresh refresh reported a change')
  world.hasComponent(id, 'pos')
  assert(!query.changed(), 'control: a read must not count as a change')
  world.addComponent(world.createEntity(), 'pos', 2)
  assert(query.changed(), 'a mutation was not reported as a change')
})

gate('ecs query.entries yields required components and only the optional ones present', () => {
  const world = ecs.createWorld()
  const a = world.createEntity()
  const b = world.createEntity()
  world.addComponent(a, 'pos', 1)
  world.addComponent(a, 'vel', 1)
  world.addComponent(b, 'pos', 2)
  world.addTag(b, 'dead')
  const entries = [...ecs.createQuery(world, { has: ['pos'], hasAny: ['vel', 'dead'] }).entries()]
  same(entries.map((entry) => entry.id), [a, b], 'entry ids')
  same(Object.keys(entries[0].components).sort(), ['pos', 'vel'], 'components of a')
  assert(!('dead' in entries[0].components), 'control: an absent optional component must not be keyed')
  same(Object.keys(entries[1].components).sort(), ['dead', 'pos'], 'components of b')
})

gate('ecs createPrefab applies overrides to the root and never to children', () => {
  const world = ecs.createWorld()
  const spec = {
    components: { pos: { x: 0, y: 0 } },
    tags: ['npc'],
    children: [{ components: { pos: { x: 5, y: 5 } } }],
  }
  const made = world.createPrefab(spec, { pos: { x: 9 } })
  same(world.getComponent(made.id, 'pos'), { x: 9, y: 0 }, 'root component after override')
  assert(world.hasTag(made.id, 'npc'), 'root tag was not applied')
  same(world.getComponent(made.children[0].id, 'pos'), { x: 5, y: 5 }, 'child component')
  assert(world.getComponent(made.children[0].id, 'pos').x !== 9, 'control: an override leaked into a child')
  same(spec.components.pos, { x: 0, y: 0 }, 'the spec was mutated')
})

gate('ecs registerSystem runs by ascending priority, passes the world, and unregister stops a system', () => {
  const world = ecs.createWorld()
  const order = []
  const seenWorlds = []
  world.registerSystem('late', (w) => { order.push('late'); seenWorlds.push(w) }, 5)
  const unregisterEarly = world.registerSystem('early', (w) => { order.push('early'); seenWorlds.push(w) }, -1)
  const { update } = world
  update(0.016)
  same(order, ['early', 'late'], 'priority order')
  assert(seenWorlds.every((w) => w === world), 'a system did not receive the world')
  unregisterEarly()
  order.length = 0
  update(0.016)
  same(order, ['late'], 'control: an unregistered system must not run')
})

gate('ecs destroy blocks creation and update, and restore brings the snapshot back', () => {
  const world = ecs.createWorld()
  const id = world.createEntity()
  world.addComponent(id, 'pos', 1)
  const snap = world.snapshot()
  let calls = 0
  world.registerSystem('count', () => { calls++ })
  world.update(0)
  assert(calls === 1, 'control: the system must run before destroy')
  world.destroy()
  assert(world.destroyed === true, 'destroyed flag not set')
  assert(throwsOf(Error, () => world.createEntity()), 'a destroyed world created an entity')
  world.update(0)
  assert(calls === 1, 'a destroyed world ran a system')
  world.restore(snap)
  assert(world.destroyed === false && world.exists(id) && world.getComponent(id, 'pos') === 1, 'restore did not bring the entity back')
  assert(world.createEntity() !== id, 'the id counter was not kept past restored ids')
})

gate('ecs snapshot is a detached copy that restore reproduces', () => {
  const world = ecs.createWorld()
  const id = world.createEntity()
  world.addComponent(id, 'pos', 1)
  const snap = world.snapshot()
  world.addComponent(id, 'late', 2)
  assert(!('late' in snap.components), 'the snapshot shares state with the world')
  assert(world.hasComponent(id, 'late'), 'control: the live world must keep the later component before restore')
  world.restore(snap)
  assert(!world.hasComponent(id, 'late') && world.getComponent(id, 'pos') === 1, 'restore did not revert the world')
})

gate('ecs version moves on mutation and not on reads', () => {
  const world = ecs.createWorld()
  const id = world.createEntity()
  const before = world.version
  world.hasComponent(id, 'pos')
  world.exists(id)
  world.entities()
  assert(world.version === before, 'a read changed the version')
  world.addTag(id, 'flag')
  assert(world.version > before, 'control: a mutation must advance the version')
})

gate('mapspinner resolvePlanetRadiusM defaults to 6360000 m and prefers radiusM over radius', () => {
  near(mapspinner.resolvePlanetRadiusM(), 6360000, 0, 'default radius')
  near(mapspinner.resolvePlanetRadiusM({ radiusM: 1000 }), 1000, 0, 'radiusM')
  near(mapspinner.resolvePlanetRadiusM({ radius: 2000 }), 2000, 0, 'radius fallback')
  near(mapspinner.resolvePlanetRadiusM({ radiusM: 1, radius: 2 }), 1, 0, 'radiusM over radius')
  assert(mapspinner.resolvePlanetRadiusM() !== 1000, 'control: the default must not be the test radius')
})

gate('mapspinner resolvePlanetRadiusM refuses zero, negative and non-finite radii', () => {
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert(throwsOf(TypeError, () => mapspinner.resolvePlanetRadiusM({ radiusM: bad })), `radius ${bad} was accepted`)
  }
  near(mapspinner.resolvePlanetRadiusM({ radiusM: 5 }), 5, 0, 'control: a positive radius is accepted')
})

gate('mapspinner Quadtree refuses a non-positive size and an out-of-range maxLevel', () => {
  assert(throwsOf(RangeError, () => new mapspinner.Quadtree(0)), 'a zero size was accepted')
  const tree = new mapspinner.Quadtree(1000)
  assert(throwsOf(RangeError, () => tree.setConfig(1000, 40, 2)), 'maxLevel above 32 was accepted')
  tree.setConfig(1000, 11, 2)
  assert(tree.maxLevel === 11, 'control: a valid maxLevel must be stored')
})

gate('mapspinner Quadtree leaves tile the root square exactly for near and far cameras', () => {
  const size = 1000
  const root = (2 * size) ** 2
  const tree = new mapspinner.Quadtree(size)
  for (const [camZ, camAlt] of [[1500, 500], [5000, 5000], [1200, 200]]) {
    const leaves = tree.updateQuadtree(0, 0, camZ, 0, 0, undefined, undefined, camAlt).map((leaf) => ({ ...leaf }))
    const area = leaves.reduce((sum, leaf) => sum + leaf.l * leaf.l, 0)
    near(area, root, 1e-6, `leaf area at camAlt ${camAlt}`)
    for (const leaf of leaves) {
      assert(leaf.ox >= -size && leaf.oy >= -size && leaf.ox + leaf.l <= size + 1e-9 && leaf.oy + leaf.l <= size + 1e-9, 'a leaf left the root square')
    }
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i], b = leaves[j]
        const overlaps = a.ox < b.ox + b.l && b.ox < a.ox + a.l && a.oy < b.oy + b.l && b.oy < a.oy + a.l
        assert(!overlaps, 'two leaves overlap')
      }
    }
  }
})

gate('mapspinner Quadtree splits toward the camera and never past maxLevel', () => {
  const tree = new mapspinner.Quadtree(1000)
  tree.setConfig(1000, 0, 2)
  const single = tree.updateQuadtree(0, 0, 1500, 0, 0, undefined, undefined, 500).map((leaf) => leaf.l)
  same(single, [2000], 'maxLevel 0 must leave one leaf spanning the root')
  tree.setConfig(1000, 4, 2)
  const leaves = tree.updateQuadtree(0, 0, 1500, 0, 0, undefined, undefined, 500)
  assert(leaves.length > 1, 'control: a near camera with maxLevel 4 must split')
  assert(Math.max(...leaves.map((leaf) => leaf.level)) <= 4, 'a leaf went past maxLevel')
})

gate('mapspinner Quadtree near-field leaf floor refines the ground under the camera only when set', () => {
  const size = 6360000
  const tree = new mapspinner.Quadtree(size)
  tree.setConfig(size, 11, 2)
  tree.setNearFieldLeafFloor(100, 1.0, null, 0)
  const withFloor = tree.updateQuadtree(0, 0, 1.7, 0, 0, undefined, undefined, 1.7)
  const under = withFloor.find((leaf) => leaf.ox <= 1 && 1 < leaf.ox + leaf.l && leaf.oy <= 1 && 1 < leaf.oy + leaf.l)
  assert(under.l <= 100, `leaf under the camera is ${under.l} m with the floor set`)
  const plain = new mapspinner.Quadtree(size)
  plain.setConfig(size, 11, 2)
  const without = plain.updateQuadtree(0, 0, 1.7, 0, 0, undefined, undefined, 1.7)
  const bare = without.find((leaf) => leaf.ox <= 1 && 1 < leaf.ox + leaf.l && leaf.oy <= 1 && 1 < leaf.oy + leaf.l)
  assert(bare.l > 100, 'control: without the floor the leaf under the camera must stay coarser than 100 m')
})

gate('mapspinner setNearFieldLeafFloor keeps only positive finite leaf sizes', () => {
  const tree = new mapspinner.Quadtree(1000)
  near(tree.setNearFieldLeafFloor(-1), 0, 0, 'negative leaf size')
  near(tree.setNearFieldLeafFloor(Number.NaN), 0, 0, 'NaN leaf size')
  near(tree.setNearFieldLeafFloor(50), 50, 0, 'control: a positive leaf size is kept')
  near(tree.nearLeafFloor, 50, 0, 'nearLeafFloor getter')
})

gate('mapspinner localToDeformed puts the face centre on the pole and sits z above the sphere', () => {
  const R = 6360000
  same(mapspinner.localToDeformed(0, 0, 0, R), [0, 0, R], 'face centre')
  for (const [x, y, z] of [[1000, -500, 0], [-2.5e6, 2.0e6, 0], [3.0e5, 1.0e5, 250]]) {
    const p = mapspinner.localToDeformed(x, y, z, R)
    near(Math.hypot(...p), R + z, 1e-6 * R, `radius at height ${z}`)
  }
  assert(Math.abs(Math.hypot(...mapspinner.localToDeformed(1000, 0, 100, R)) - R) > 1e-3, 'control: a point 100 m above the sphere must not measure R')
})

gate('mapspinner groundPerFaceMetre is pi over four along the face axis and smaller toward the diagonal corner', () => {
  const R = 6360000
  near(mapspinner.groundPerFaceMetre(0, 0, R), Math.PI / 4, 1e-7, 'centre metric')
  near(mapspinner.groundPerFaceMetre(R * 0.99, 0, R), Math.PI / 4, 1e-7, 'axis metric stays constant')
  const diagonal = mapspinner.groundPerFaceMetre(R * 0.99, R * 0.99, R)
  assert(diagonal < Math.PI / 4 - 0.03, `diagonal metric ${diagonal} did not fall below pi over four`)
  assert(Math.abs(diagonal - mapspinner.groundPerFaceMetre(0, 0, R)) > 0.01, 'control: the diagonal must not equal the centre')
})

gate('mapspinner buildGridGeometry emits the counted vertices and triangles and winds every triangle the same way', () => {
  const skirt = mapspinner.buildGridGeometry(2, true)
  const bare = mapspinner.buildGridGeometry(2, false)
  assert(skirt.vertices.length / 3 === 25 && skirt.indices.length === 96, `skirt counts ${skirt.vertices.length / 3}, ${skirt.indices.length}`)
  assert(bare.vertices.length / 3 === 9 && bare.indices.length === 24, `bare counts ${bare.vertices.length / 3}, ${bare.indices.length}`)
  const windingSigns = (geometry) => {
    const p = geometry.vertices
    const signs = []
    for (let i = 0; i < geometry.indices.length; i += 3) {
      const a = geometry.indices[i], b = geometry.indices[i + 1], c = geometry.indices[i + 2]
      const cross = (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[b * 3 + 1] - p[a * 3 + 1]) * (p[c * 3] - p[a * 3])
      signs.push(Math.sign(cross))
    }
    return signs
  }
  const uniform = (values) => values.every((v) => v === values[0])
  const nonDegenerate = (signs) => signs.filter((s) => s !== 0)
  assert(nonDegenerate(windingSigns(skirt)).length > 0, 'the skirt grid has no non-degenerate triangle to check')
  assert(uniform(nonDegenerate(windingSigns(skirt))), 'skirt triangles wind both ways')
  assert(uniform(nonDegenerate(windingSigns(bare))), 'bare triangles wind both ways')
  const firstLive = windingSigns(skirt).findIndex((s) => s !== 0) * 3
  const flipped = { ...skirt, indices: Uint32Array.from(skirt.indices) }
  flipped.indices[firstLive + 1] = skirt.indices[firstLive + 2]
  flipped.indices[firstLive + 2] = skirt.indices[firstLive + 1]
  assert(!uniform(nonDegenerate(windingSigns(flipped))), 'control: one reversed triangle must break the uniform winding')
})

gate('mapspinner buildGridGeometry marks exactly the ring vertices and keeps every index in range', () => {
  const skirt = mapspinner.buildGridGeometry(2, true)
  const count = skirt.vertices.length / 3
  let flagged = 0
  for (let v = 0; v < count; v++) if (skirt.vertices[v * 3 + 2] === 1) flagged++
  assert(flagged === 16, `flagged ring vertices ${flagged}`)
  assert(skirt.indices.every((index) => index < count), 'an index points past the vertex list')
  const bare = mapspinner.buildGridGeometry(2, false)
  let bareFlagged = 0
  for (let v = 0; v < bare.vertices.length / 3; v++) if (bare.vertices[v * 3 + 2] === 1) bareFlagged++
  assert(bareFlagged === 0, 'control: a skirtless grid must carry no ring vertices')
})

gate('mapspinner buildGridGeometry is deterministic and gridSize sets the vertex grid', () => {
  const first = mapspinner.buildGridGeometry(4, true)
  const second = mapspinner.buildGridGeometry(4, true)
  same(Array.from(first.indices), Array.from(second.indices), 'two builds differ')
  assert(first.vertices.length / 3 === 49, `gridSize 4 vertices ${first.vertices.length / 3}`)
  assert(mapspinner.buildGridGeometry(2, true).vertices.length !== first.vertices.length, 'control: a different gridSize must change the vertex count')
})

gate('mapspinner perspectiveZeroToOne maps the near plane to depth 0 and the far plane to depth 1', () => {
  const nearPlane = 0.5, farPlane = 100
  const matrix = mapspinner.perspectiveZeroToOne(Math.PI / 3, 16 / 9, nearPlane, farPlane)
  const depthAt = (z) => {
    const clipZ = matrix[10] * z + matrix[14]
    const clipW = matrix[11] * z + matrix[15]
    return clipZ / clipW
  }
  near(depthAt(-nearPlane), 0, 1e-6, 'near plane depth')
  near(depthAt(-farPlane), 1, 1e-6, 'far plane depth')
  const openGl = new Float32Array(16)
  openGl[10] = (farPlane + nearPlane) / (nearPlane - farPlane)
  openGl[14] = 2 * farPlane * nearPlane / (nearPlane - farPlane)
  openGl[11] = -1
  const openGlNearDepth = (openGl[10] * -nearPlane + openGl[14]) / nearPlane
  near(openGlNearDepth, -1, 1e-6, 'control: an OpenGL matrix puts the near plane at -1')
  assert(Math.abs(depthAt(-nearPlane) - openGlNearDepth) > 0.5, 'control: the zero-to-one depth must differ from OpenGL depth')
})

gate('mapspinner heightfield codec round-trips 8-bit and 16-bit payloads', () => {
  const base = {
    N: 3,
    extent: 4096,
    center: [0, 0, 0],
    anchorDir: [0, 0, 1],
    radius: 6360000,
    reliefScale: 1.5,
    anchorHeight: 12.25,
    seed: 7,
    hashVersion: 3,
    terrainKey: 'alpha',
    codeVersion: 9,
    sectors: { gridS: 2, nodesPerSector: 4 },
    sectorMin: [0.5, 1.25, -2, 3],
    sectorMax: [4, 5.5, 6, 7.75],
  }
  for (const bits of [8, 16]) {
    const q = Array.from({ length: 9 }, (_, i) => (i * 37) % (bits === 8 ? 256 : 65536))
    const payload = mapspinner.encodeHeightfield({ ...base, sectors: { ...base.sectors, bits }, q })
    const decoded = mapspinner.decodeHeightfield(payload)
    same(Array.from(decoded.q), q, `${bits}-bit codes`)
    same(Array.from(decoded.sectorMin), base.sectorMin, `${bits}-bit sector minima`)
    same(Array.from(decoded.sectorMax), base.sectorMax, `${bits}-bit sector maxima`)
    assert(decoded.N === 3 && decoded.seed === 7 && decoded.terrainKey === 'alpha', 'header fields did not survive')
    assert(decoded.sectors.qmax === (bits === 8 ? 255 : 65535), `${bits}-bit qmax ${decoded.sectors.qmax}`)
  }
  const corrupt = mapspinner.encodeHeightfield({ ...base, sectors: { ...base.sectors, bits: 8 }, q: Array(9).fill(1) })
  new DataView(corrupt).setUint32(0, 0, true)
  assert(mapspinner.decodeHeightfield(corrupt) === null, 'control: a wrong magic must decode as null')
})

gate('mapspinner heightfield codec pads the header to four bytes and refuses other bit widths', () => {
  const base = {
    N: 2, extent: 1, center: [0, 0, 0], anchorDir: [0, 0, 1], radius: 1, reliefScale: 1,
    anchorHeight: 0, seed: 1, hashVersion: 1, terrainKey: 'k', codeVersion: 1,
    sectorMin: [1], sectorMax: [2], q: [1, 2, 3, 4],
  }
  const payload = mapspinner.encodeHeightfield({ ...base, sectors: { gridS: 1, nodesPerSector: 4, bits: 8 } })
  const headerLength = new DataView(payload).getUint32(4, true)
  assert(headerLength % 4 === 0, `header length ${headerLength} is not 4-aligned`)
  assert(payload.byteLength === 8 + headerLength + 8 + 4, `payload length ${payload.byteLength}`)
  assert(throwsOf(RangeError, () => mapspinner.encodeHeightfield({ ...base, sectors: { gridS: 1, nodesPerSector: 4, bits: 12 } })), '12-bit quantization was accepted')
  assert(mapspinner.encodeHeightfield({ ...base, sectors: { gridS: 1, nodesPerSector: 4, bits: 16 } }).byteLength > payload.byteLength, 'control: 16-bit codes must take more bytes than 8-bit')
})

gate('mapspinner seaHeightMean is zero at zero amplitude, linear in amplitude and sensitive to choppiness', () => {
  assert(mapspinner.seaHeightMean(0.5, 0) === 0, 'zero amplitude gave a non-zero mean')
  const unit = mapspinner.seaHeightMean(0.5, 1)
  assert(unit > 0, 'control: a unit amplitude must give a positive mean')
  assert(mapspinner.seaHeightMean(0.5, 2) === 2 * unit, 'the mean is not linear in amplitude')
  assert(mapspinner.seaHeightMean(0.9, 1) !== unit, 'control: a different choppiness must change the mean')
})

gate('mapspinner lodDistFactor defaults to the altitude multiplier and yields to the knob', () => {
  near(mapspinner.lodDistFactor(0.25), 2.0, 1e-12, 'default factor')
  near(mapspinner.lodDistFactor(0.25, { __distFactor: 3 }), 3, 0, 'knob factor')
  assert(mapspinner.lodDistFactor(0.25, {}) !== 3, 'control: an empty knob set must not read as 3')
})

gate('mapspinner resolveLodConfig refuses a field of view outside the open interval (0, pi)', () => {
  for (const bad of [0, Math.PI, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    assert(throwsOf(RangeError, () => mapspinner.resolveLodConfig({}, bad)), `fovy ${bad} was accepted`)
  }
  near(mapspinner.resolveLodConfig({}, 1.0).fovy, 1.0, 0, 'control: a valid fovy must be accepted')
})

gate('mapspinner resolveLodConfig uses declared defaults without knobs and clamps knob overrides', () => {
  const plain = mapspinner.resolveLodConfig({}, 1.0)
  near(plain.maxLevel, 11, 0, 'default maxLevel')
  near(plain.splitFactor, 0.25, 0, 'default splitFactor')
  const high = mapspinner.resolveLodConfig({}, 1.0, { __maxLevel: 99, __splitFactor: 0.01 })
  near(high.maxLevel, 22, 0, 'maxLevel clamped to the ceiling')
  near(high.splitFactor, 0.05, 0, 'splitFactor clamped to the floor')
  near(mapspinner.resolveLodConfig({}, 1.0, { __maxLevel: 0 }).maxLevel, 2, 0, 'maxLevel clamped to the floor')
  assert(plain.maxLevel !== 2, 'control: the default must not be the floor')
})

gate('mapspinner resolveLodConfig publishes resolved values only into knobs it owns', () => {
  const knobs = {}
  mapspinner.resolveLodConfig({}, 1.0, knobs)
  near(knobs.__maxLevel, 11, 0, 'published maxLevel')
  near(knobs.__splitFactor, 0.25, 0, 'published splitFactor')
  mapspinner.resolveLodConfig({}, 1.0, knobs)
  near(knobs.__maxLevel, 11, 0, 'a second read-modify-write must be a no-op')
  knobs.__maxLevel = 4
  const shed = mapspinner.resolveLodConfig({}, 1.0, knobs)
  near(shed.maxLevel, 4, 0, 'a shed knob is honoured')
  near(knobs.__maxLevel, 4, 0, 'control: a value this function did not publish must be left alone')
  const operator = { __maxLevel: 5 }
  near(mapspinner.resolveLodConfig({}, 1.0, operator).maxLevel, 5, 0, 'operator knob')
  near(operator.__maxLevel, 5, 0, 'operator knob was overwritten')
})

gate('mapspinner applyLodConfig sets the quadtree split distance and config from the resolved values', () => {
  const radius = 6360000
  const viewport = 1080
  const cfg = mapspinner.resolveLodConfig({}, 1.0, {})
  const tree = new mapspinner.Quadtree(radius)
  const splitDist = mapspinner.applyLodConfig(tree, radius, viewport, cfg)
  near(splitDist, tree.splitDist, 0, 'return value is the tree split distance')
  const expected = new mapspinner.Quadtree(radius)
  near(splitDist, expected.computeSplitDist(cfg.splitFactor * mapspinner.LOD_STEP, viewport, cfg.fovy), 1e-9, 'split distance')
  assert(tree.maxLevel === cfg.maxLevel, 'maxLevel was not applied')
  const halfViewport = new mapspinner.Quadtree(radius)
  assert(mapspinner.applyLodConfig(halfViewport, radius, viewport / 2, cfg) < splitDist, 'control: a smaller viewport must give a smaller split distance')
})

const schemaNames = [
  'glTF.EP_progressive_lod.schema.json',
  'mesh.EP_progressive_lod.schema.json',
  'texture.EP_progressive_lod.schema.json',
  'lod.EP_progressive_lod.schema.json',
]
const schemas = Object.fromEntries(schemaNames.map((name) => [name, JSON.parse(readFileSync(join(schemaDir, name), 'utf8'))]))
const validator = streamingGltf.createSchemaValidator(schemas)

const readmeExample = {
  version: 1,
  storage: 'sibling-file',
  meshes: [
    {
      meshIndex: 0,
      primIndex: 0,
      lods: [
        { ratio: 0.04, kind: 'textured', inline: true, indexCount: 312 },
        { ratio: 0.15, kind: 'textured', inline: false, path: 'lod_2.glb', indexCount: 1180, bytes: 24010, decodeAABB: null },
        { ratio: 1.0, kind: 'textured', inline: false, path: 'lod_0.glb', indexCount: 7800, bytes: 161200, decodeAABB: null },
      ],
    },
  ],
  textures: [
    {
      textureIndex: 0,
      name: 'albedo',
      lods: [
        { width: 128, inline: true, bytes: 3100 },
        { width: 512, inline: false, path: 'tex0_512.webp', bytes: 22000 },
        { width: 2048, inline: false, path: 'tex0_2048.webp', bytes: 210000 },
      ],
    },
  ],
}
const clone = (value) => JSON.parse(JSON.stringify(value))

gate('the EP_progressive_lod schema files load and every reference resolves', () => {
  assert(throwsOf(Error, () => streamingGltf.createSchemaValidator({ ...schemas, 'mesh.EP_progressive_lod.schema.json': undefined })), 'a validator was built without the mesh schema')
  assert(streamingGltf.createSchemaValidator(schemas).validate(readmeExample).ok, 'control: the complete schema set must validate the README example')
})

gate('the README example payload validates against the EP_progressive_lod schema', () => {
  const result = validator.validate(readmeExample)
  assert(result.ok, `README example rejected: ${result.errors.join('; ')}`)
})

gate('the EP_progressive_lod schema rejects malformed payloads', () => {
  const ratioZero = clone(readmeExample)
  ratioZero.meshes[0].lods[0].ratio = 0
  assert(!validator.validate(ratioZero).ok, 'a ratio of zero was accepted')
  const badStorage = clone(readmeExample)
  badStorage.storage = 'bogus'
  assert(!validator.validate(badStorage).ok, 'an unknown storage mode was accepted')
  const extraTop = clone(readmeExample)
  extraTop.extensionsNote = 'x'
  assert(!validator.validate(extraTop).ok, 'an unknown top-level key was accepted')
  const missingPrim = clone(readmeExample)
  delete missingPrim.meshes[0].primIndex
  assert(!validator.validate(missingPrim).ok, 'a mesh without primIndex was accepted')
  const shortAabb = clone(readmeExample)
  shortAabb.meshes[0].lods[1].decodeAABB = { min: [0, 0], max: [1, 1, 1] }
  assert(!validator.validate(shortAabb).ok, 'a two-element decodeAABB min was accepted')
  assert(validator.validate(readmeExample).ok, 'control: the unmodified example must still validate')
})

const clusterResult = (lods, aabb = [0.123456, 0, 0, 1, 1, 1], sphere = [0, 0, 0, 1]) => ({
  clusters: [{ aabb, sphere, lods }],
  lodCount: lods.length,
  indexCoarse: { length: 6 },
})

gate('buildClusterLodExtra writes version 2, the counts and rounded boxes with stream triples', () => {
  const extra = streamingGltf.buildClusterLodExtra(clusterResult([{ offset: 0, count: 3, stream: 0 }, { offset: 3, count: 3, stream: 1 }]), 4)
  assert(extra.version === 2 && extra.clusterCount === 1 && extra.lodCount === 2, 'header counts')
  assert(extra.coarseIndexAccessor === 4 && extra.coarseIndexCount === 6, 'coarse index fields')
  near(extra.clusters[0].aabb[0], 0.1235, 0, 'rounded aabb minimum')
  same(extra.clusters[0].lods, [[0, 3, 0], [3, 3, 1]], 'lod triples')
  assert(extra.clusters[0].aabb[0] !== 0.1234, 'control: the value must round, not truncate, to 0.1235')
})

gate('buildClusterLodExtra adds materialBucket only when one is given', () => {
  const plain = streamingGltf.buildClusterLodExtra(clusterResult([{ offset: 0, count: 3, stream: 0 }]))
  assert(!('materialBucket' in plain), 'a materialBucket appeared without one being given')
  const tagged = streamingGltf.buildClusterLodExtra(clusterResult([{ offset: 0, count: 3, stream: 0 }]), -1, 'stone')
  assert(tagged.materialBucket === 'stone', 'control: a given materialBucket must be written')
})

gate('parseClusterLod returns null without a valid EP_cluster_lod payload', () => {
  assert(streamingGltf.parseClusterLod(undefined) === null, 'undefined extras parsed')
  assert(streamingGltf.parseClusterLod({ EP_cluster_lod: { clusters: [] } }) === null, 'an empty cluster list parsed')
  assert(streamingGltf.parseClusterLod({ EP_cluster_lod: { clusters: [{ aabb: [0, 0, 0, 1, 1, 1], sphere: [0, 0], lods: [[0, 3]] }] } }) === null, 'a two-element sphere parsed')
  assert(streamingGltf.parseClusterLod({ EP_cluster_lod: { clusters: [{ aabb: [0, 0, 0, Number.NaN, 1, 1], sphere: [0, 0, 0, 1], lods: [[0, 3]] }] } }) === null, 'a NaN aabb parsed')
  const valid = { EP_cluster_lod: { clusters: [{ aabb: [0, 0, 0, 1, 1, 1], sphere: [0, 0, 0, 1], lods: [[0, 3]] }] } }
  assert(streamingGltf.parseClusterLod(valid) !== null, 'control: a valid payload must parse')
})

gate('parseClusterLod derives a radius-only sphere from the aabb and defaults the stream to zero', () => {
  const parsed = streamingGltf.parseClusterLod({ EP_cluster_lod: { clusters: [{ aabb: [0, 0, 0, 2, 2, 2], sphere: [1], lods: [[0, 3]] }] } })
  const [cx, cy, cz, radius] = parsed.clusters[0].sphere
  near(cx, 1, 1e-12, 'centre x')
  near(cy, 1, 1e-12, 'centre y')
  near(cz, 1, 1e-12, 'centre z')
  near(radius, Math.sqrt(3), 1e-12, 'radius')
  same(parsed.clusters[0].lods, [{ offset: 0, count: 3, stream: 0 }], 'default stream')
  const explicit = streamingGltf.parseClusterLod({ EP_cluster_lod: { clusters: [{ aabb: [0, 0, 0, 1, 1, 1], sphere: [0, 0, 0, 1], lods: [[0, 3, 1]] }] } })
  assert(explicit.clusters[0].lods[0].stream === 1, 'control: an explicit stream must be kept')
})

gate('parse of build keeps the cluster boxes, the lod ranges and the counts', () => {
  const built = streamingGltf.buildClusterLodExtra(clusterResult([{ offset: 0, count: 3, stream: 0 }, { offset: 3, count: 6, stream: 1 }]), -1, 'rock')
  const parsed = streamingGltf.parseClusterLod({ EP_cluster_lod: built })
  same(parsed.clusters[0].aabb, [0.1235, 0, 0, 1, 1, 1], 'aabb survives')
  same(parsed.clusters[0].lods, [{ offset: 0, count: 3, stream: 0 }, { offset: 3, count: 6, stream: 1 }], 'lods survive')
  assert(parsed.lodCount === 2 && parsed.materialBucket === 'rock', 'counts or bucket lost')
  assert(parsed.clusters[0].aabb[0] !== 0.123456, 'control: the parsed box must carry the rounded value')
})

gate('lod0OnlyClusterLodExtras keeps the first lod of each cluster and refuses a non-zero stream', () => {
  const built = streamingGltf.buildClusterLodExtra(clusterResult([{ offset: 0, count: 3, stream: 0 }, { offset: 3, count: 3, stream: 1 }]))
  const reduced = streamingGltf.lod0OnlyClusterLodExtras({ EP_cluster_lod: built })
  const meta = reduced.EP_cluster_lod
  assert(meta.lodCount === 1 && meta.coarseIndexAccessor === -1 && meta.coarseIndexCount === 0, 'counts not reset')
  same(meta.clusters[0].lods, [[0, 3, 0]], 'only lod0 kept')
  const onCoarse = streamingGltf.buildClusterLodExtra(clusterResult([{ offset: 0, count: 3, stream: 1 }]))
  assert(throwsOf(RangeError, () => streamingGltf.lod0OnlyClusterLodExtras({ EP_cluster_lod: onCoarse })), 'a lod0 on stream 1 was accepted')
  assert(throwsOf(TypeError, () => streamingGltf.lod0OnlyClusterLodExtras({})), 'extras without clusters were accepted')
})

gate('triangleArea gives the area of a unit right triangle and scales with the world matrix', () => {
  const positions = Float64Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0)
  near(streamingGltf.triangleArea(positions, 0, 1, 2), 0.5, 1e-12, 'unit right triangle')
  const scaleTwo = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]
  near(streamingGltf.triangleArea(positions, 0, 1, 2, scaleTwo), 2, 1e-12, 'scaled triangle')
  near(streamingGltf.triangleArea(positions, 0, 1, 2, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), 0.5, 1e-12, 'control: the identity matrix leaves the area unchanged')
})

gate('collapseDegenerateTriangles collapses a collinear triangle and leaves a proper one alone', () => {
  const positions = Float64Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0)
  const index = Uint32Array.of(0, 1, 2, 0, 1, 3)
  const collapsed = streamingGltf.collapseDegenerateTriangles(index, positions)
  assert(collapsed === 1, `collapsed ${collapsed}`)
  same(Array.from(index), [0, 0, 0, 0, 1, 3], 'collinear triangle was not collapsed to one vertex')
})

gate('dropDegenerateTriangles removes collinear triangles, keeps typed arrays and keeps proper meshes intact', () => {
  const positions = Float64Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0)
  const result = streamingGltf.dropDegenerateTriangles(Uint32Array.of(0, 1, 2, 0, 1, 3), positions)
  assert(result.dropped === 1 && result.index instanceof Uint32Array, 'drop count or type')
  same(Array.from(result.index), [0, 1, 3], 'kept triangle')
  const proper = Uint32Array.of(0, 1, 3)
  const untouched = streamingGltf.dropDegenerateTriangles(proper, positions)
  assert(untouched.dropped === 0 && untouched.index === proper, 'control: a proper mesh must come back as the same array')
})

gate('collapseFanTriangles collapses an edge longer than three cluster diagonals and keeps short edges', () => {
  const clusters = [{ aabb: [0, 0, 0, 1, 0, 0], lods: [{ offset: 0, count: 3, stream: 0 }] }]
  const streamIndex = [Uint32Array.of(0, 1, 2)]
  const streamBase = [0]
  const far = Float64Array.of(0, 0, 0, 10, 0, 0, 0.5, 0, 0)
  assert(streamingGltf.collapseFanTriangles(clusters, far, streamIndex, streamBase) === 1, 'a 10 unit edge was not collapsed')
  const near_ = Float64Array.of(0, 0, 0, 1, 0, 0, 0.5, 0.5, 0)
  const shortIndex = [Uint32Array.of(0, 1, 2)]
  assert(streamingGltf.collapseFanTriangles(clusters, near_, shortIndex, streamBase) === 0, 'control: edges within the reach must not collapse')
})

gate('collapseFanTriangles refuses a lod range that runs past its index stream', () => {
  const positions = Float64Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0)
  const streamIndex = [Uint32Array.of(0, 1, 2)]
  assert(throwsOf(RangeError, () => streamingGltf.collapseFanTriangles([{ aabb: [0, 0, 0, 1, 1, 1], lods: [{ offset: 0, count: 6, stream: 0 }] }], positions, streamIndex, [0])), 'a range past the stream was accepted')
  assert(streamingGltf.collapseFanTriangles([{ aabb: [0, 0, 0, 1, 1, 1], lods: [{ offset: 0, count: 3, stream: 0 }] }], positions, streamIndex, [0]) === 0, 'control: an in-range lod must be accepted')
})

gate('mapspinner Mat4.mul composes translations and does not commute with scaling', () => {
  const identity = mapspinner.Mat4.translate([0, 0, 0])
  const t1 = mapspinner.Mat4.translate([1, 2, 3])
  const t2 = mapspinner.Mat4.translate([4, 5, 6])
  same(Array.from(mapspinner.Mat4.mul(identity, t1)), Array.from(t1), 'identity times translate')
  same(Array.from(mapspinner.Mat4.mul(t1, t2)).slice(12, 15), [5, 7, 9], 'translations add')
  const scale = Float32Array.of(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1)
  const scaleThenMove = JSON.stringify(Array.from(mapspinner.Mat4.mul(scale, t1)))
  const moveThenScale = JSON.stringify(Array.from(mapspinner.Mat4.mul(t1, scale)))
  assert(scaleThenMove !== moveThenScale, 'control: scale and translate must not commute')
})

gate('mapspinner Mat4.perspective is the OpenGL projection and differs from the zero-to-one one', () => {
  const projection = mapspinner.Mat4.perspective(Math.PI / 3, 16 / 9, 0.5, 100)
  const depthAt = (m, z) => (m[10] * z + m[14]) / (m[11] * z + m[15])
  near(depthAt(projection, -0.5), -1, 1e-6, 'near plane depth')
  near(depthAt(projection, -100), 1, 1e-6, 'far plane depth')
  const into = new Float32Array(16)
  mapspinner.Mat4.perspective(Math.PI / 3, 16 / 9, 0.5, 100, into)
  same(Array.from(into), Array.from(projection), 'out variant matches the fresh one')
  const zeroToOne = mapspinner.perspectiveZeroToOne(Math.PI / 3, 16 / 9, 0.5, 100)
  assert(Math.abs(depthAt(zeroToOne, -0.5) - depthAt(projection, -0.5)) > 0.5, 'control: the zero-to-one near depth must differ from the OpenGL one')
})

gate('mapspinner Mat4.lookAt sends the eye to the origin, the centre onto minus z, and keeps an orthonormal basis', () => {
  const eye = [3, -2, 5]
  const centre = [1, 1, 0]
  const view = mapspinner.Mat4.lookAt(eye, centre, [0, 1, 0])
  const apply = (p) => [0, 1, 2].map((row) => view[row] * p[0] + view[4 + row] * p[1] + view[8 + row] * p[2] + view[12 + row])
  const origin = apply(eye)
  near(Math.hypot(...origin), 0, 1e-5, 'eye maps to the origin')
  const distance = Math.hypot(eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2])
  const target = apply(centre)
  near(target[0], 0, 1e-5, 'centre x')
  near(target[1], 0, 1e-5, 'centre y')
  near(target[2], -distance, 1e-5, 'centre depth')
  const rows = [0, 1, 2].map((row) => [view[row], view[4 + row], view[8 + row]])
  for (let i = 0; i < 3; i++) {
    near(Math.hypot(...rows[i]), 1, 1e-5, `row ${i} length`)
    for (let j = i + 1; j < 3; j++) near(rows[i].reduce((s, c, k) => s + c * rows[j][k], 0), 0, 1e-5, `rows ${i} and ${j} orthogonal`)
  }
  assert(Math.hypot(view[12], view[13], view[14]) > 1, 'control: a moved eye must give a non-zero translation column')
})

gate('mapspinner Mat4.lookAt stays orthonormal when up is parallel to the view direction', () => {
  const view = mapspinner.Mat4.lookAt([0, 0, 5], [0, 0, 0], [0, 0, 1])
  const rows = [0, 1, 2].map((row) => [view[row], view[4 + row], view[8 + row]])
  for (let i = 0; i < 3; i++) near(Math.hypot(...rows[i]), 1, 1e-5, `row ${i} length under the parallel-up fallback`)
  const usual = mapspinner.Mat4.lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0])
  assert(Math.abs(usual[0] - view[0]) + Math.abs(usual[5] - view[5]) > 0.1, 'control: the fallback basis must differ from the usual one')
})

gate('mapspinner TEXTURE_UNITS holds twelve distinct consecutive units and refuses writes', () => {
  same(Object.values(mapspinner.TEXTURE_UNITS).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'unit numbers')
  assert(Object.isFrozen(mapspinner.TEXTURE_UNITS), 'the unit table is not frozen')
  assert(throwsOf(TypeError, () => { mapspinner.TEXTURE_UNITS.hpf = 9 }), 'control: a write to the frozen table must be refused')
})

gate('mapspinner hpfQuintic is fixed at 0, 1 and one half and is not linear', () => {
  near(mapspinner.hpfQuintic(0), 0, 0, 'at 0')
  near(mapspinner.hpfQuintic(1), 1, 0, 'at 1')
  near(mapspinner.hpfQuintic(0.5), 0.5, 1e-12, 'at one half')
  assert(Math.abs(mapspinner.hpfQuintic(0.25) - 0.25) > 0.1, 'control: the quintic must not be the identity')
})

gate('mapspinner hpf pool sizes and resolution assertions agree', () => {
  same(mapspinner.hpfPoolFloats(3), 216, 'six faces of 3 by 3 by four channels')
  assert(mapspinner.assertHpfPool(new Float32Array(216), 3).length === 216, 'a correct pool was refused')
  assert(throwsOf(RangeError, () => mapspinner.assertHpfPool(new Float32Array(215), 3)), 'control: a short pool must be refused')
  mapspinner.assertHpfRes(2)
  for (const bad of [1, 2.5, Number.NaN, '3']) assert(throwsOf(RangeError, () => mapspinner.assertHpfRes(bad)), `res ${bad} was accepted`)
})

gate('mapspinner hpfLattice picks bracketing nodes, clamps at the far edge and validates taps', () => {
  const tap = mapspinner.hpfLattice(3)
  const origin = tap(0, 0)
  const far = tap(1, 1)
  const middle = tap(0.4, 0.4)
  assert(origin.x0 === 0 && origin.x1 === 1 && origin.wx === 0, 'origin taps')
  assert(far.x0 === 2 && far.x1 === 2 && far.y1 === 2, 'far edge clamps to the last node')
  assert(middle.x0 === 0 && middle.x1 === 1, 'middle brackets nodes 0 and 1')
  near(middle.wx, mapspinner.hpfQuintic(0.8), 1e-12, 'middle weight')
  assert(middle.wx > 0.9 && middle.wx < 1, 'control: the middle weight must be strictly between 0.9 and 1')
  assert(mapspinner.assertHpfTap({ x0: 0, x1: 1, y0: 0, y1: 1, wx: 0.5, wy: 0.5 }, 3).wx === 0.5, 'a valid tap was refused')
  assert(throwsOf(RangeError, () => mapspinner.assertHpfTap({ x0: 3, x1: 1, y0: 0, y1: 1, wx: 0.5, wy: 0.5 }, 3)), 'control: a node past the last one must be refused')
})

gate('mapspinner hpfFaceSampler reproduces a constant face and reads a ramp at its nodes', () => {
  const res = 4
  const constant = new Float32Array(res * res * 4).fill(0.25)
  const flat = mapspinner.hpfFaceSampler(constant, res)
  for (const [u, v] of [[0, 0], [0.3, 0.7], [1, 1], [0.5, 0.123]]) {
    const out = flat(u, v, [0, 0, 0, 0])
    for (const channel of out) near(channel, 0.25, 1e-6, `constant face at ${u},${v}`)
  }
  const ramp = new Float32Array(res * res * 4)
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) ramp.fill(x, (y * res + x) * 4, (y * res + x) * 4 + 4)
  const slope = mapspinner.hpfFaceSampler(ramp, res)
  near(slope(0, 0, [0, 0, 0, 0])[0], 0, 1e-6, 'ramp at the first node')
  near(slope(1, 0, [0, 0, 0, 0])[0], 3, 1e-6, 'ramp at the last node')
  assert(slope(1, 0, [0, 0, 0, 0])[0] !== flat(1, 0, [0, 0, 0, 0])[0], 'control: a ramp must not read as a constant face')
})

gate('mapspinner hpfPoolSampler reads the requested face and refuses faces outside 0..5', () => {
  const res = 3
  const faceFloats = res * res * 4
  const pool = new Float32Array(6 * faceFloats)
  for (let face = 0; face < 6; face++) pool.fill(face + 1, face * faceFloats, (face + 1) * faceFloats)
  const sample = mapspinner.hpfPoolSampler(pool, res)
  for (let face = 0; face < 6; face++) near(sample(face, 0.3, 0.6, [0, 0, 0, 0])[0], face + 1, 1e-6, `face ${face}`)
  assert(throwsOf(RangeError, () => sample(6, 0, 0, [0, 0, 0, 0])), 'face 6 was accepted')
  assert(throwsOf(RangeError, () => sample(-1, 0, 0, [0, 0, 0, 0])), 'face -1 was accepted')
  assert(throwsOf(RangeError, () => mapspinner.hpfPoolSampler(new Float32Array(10), res)), 'a short pool was accepted')
  assert(sample(0, 0.3, 0.6, [0, 0, 0, 0])[0] !== sample(1, 0.3, 0.6, [0, 0, 0, 0])[0], 'control: different faces must read different values')
})

finish()
