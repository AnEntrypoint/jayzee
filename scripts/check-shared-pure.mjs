import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { biomeColor, reliefShade, shadeHeightGrid } from '../src/shared/biomeColor.js'
import { elevation } from '../src/shared/ballisticsElevation.js'
import { listBookmarks } from '../src/shared/bookmarks.js'
import { COLLIDER_DEFAULT_EXTENT_M, colliderLatticeOf, colliderLatticeSpacingOf, sourceSpacingOfBake } from '../src/shared/colliderLattice.js'
import { EQUIP_UNARMED, equipNameOf, equipResolve } from '../src/shared/equipment.js'
import { parseMaterialSlots } from '../src/shared/materialSlots.js'
import { expandWorldPresets } from '../src/shared/worldPresets.js'
import { WORLD_FIELD_INVALID, WORLD_NOT_A_PLAIN_OBJECT, WorldResolveError, assertWorld, parseWorld, validateMovement } from '../src/shared/worldResolve.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED_FILES = ['biomeColor', 'ballisticsElevation', 'bookmarks', 'colliderLattice', 'equipment', 'materialSlots', 'worldPresets', 'worldResolve']
const HOST_GLOBALS = ['Date.now', 'performance', 'console', 'window', 'process', 'setTimeout', 'globalThis', 'Math.random']

const near = (actual, expected, tol, label) => assert.ok(Math.abs(actual - expected) <= tol, `${label}: got ${actual}, expected ${expected}`)
const refusesWith = (fn, reasonCode) => {
  try {
    fn()
  } catch (error) {
    return error.reasonCode === reasonCode
  }
  return false
}
const throwsTypeError = (fn) => {
  try {
    fn()
  } catch (error) {
    return error instanceof TypeError
  }
  return false
}

const probes = {}
const probe = async (label, fn) => {
  try {
    probes[label] = { value: await fn() }
  } catch (error) {
    probes[label] = { error }
  }
}
const probed = (label) => {
  assert.ok(label in probes, 'no probe recorded ' + label)
  if (probes[label].error) throw probes[label].error
  return probes[label].value
}

gate('biomeColor: deep ocean, sea, beach and snowcap bands return their documented colours', () => {
  assert.deepEqual(biomeColor(-300, 0.5, 0.5, 0), [18, 42, 92])
  assert.deepEqual(biomeColor(-200, 0.5, 0.5, 0), [42, 92, 158], 'exactly -200 is not deep ocean')
  assert.deepEqual(biomeColor(-50, 0.5, 0.5, 0), [42, 92, 158])
  assert.deepEqual(biomeColor(4, 0.5, 0.5, 0), [214, 199, 152])
  assert.deepEqual(biomeColor(2300, 0.5, 0.5, 0), [235, 238, 242])
  assert.deepEqual(biomeColor(2200, 0.5, 0.5, 0), [235, 238, 242], 'exactly 2200 blends to snow')
})

gate('biomeColor: seaLevel shifts the height before any band is chosen', () => {
  assert.deepEqual(biomeColor(104, 0.5, 0.5, 100), [214, 199, 152], 'a height 4 m above sea level is beach')
  assert.deepEqual(biomeColor(104, 0.5, 0.5, 0), [140, 157, 92], 'dry-grass mix at humidity 0.5 and no forest')
})

gate('biomeColor: forest mix at full humidity and mid temperature gives [81, 129, 67]', () => {
  assert.deepEqual(biomeColor(100, 0.5, 1, 0), [81, 129, 67])
})

gate('biomeColor: upland and rock-snow blends interpolate by the documented spans', () => {
  assert.deepEqual(biomeColor(1300, 0, 0, 0), [120, 118, 108], 'at 1300 the upland blend reaches rock')
  assert.deepEqual(biomeColor(900, 0, 0, 0), [108, 123, 91], 'half of the 800 m upland span')
  assert.deepEqual(biomeColor(1750, 0, 0, 0), [177.5, 178, 175], 'half of the 900 m rock-snow span')
})

gate('reliefShade: flat ground is exactly 1 and a steep downhill clamps to the 0.5 floor', () => {
  assert.equal(reliefShade(0, 0), 1)
  assert.equal(reliefShade(-10, 0), 0.5)
})

gate('reliefShade: a steep uphill slope darkens to 0.7456 and a gentle one stays near 1', () => {
  near(reliefShade(10, 0), 0.7456453, 1e-6, 'steep slope')
  near(reliefShade(1, 0), 0.8750259, 1e-6, 'slope of 1')
  assert.ok(reliefShade(0.3, 0) > 1, 'a 0.3 slope on the lit side is brighter than flat, the control that the lambert term varies')
})

gate('shadeHeightGrid: flat land and water pass rgb through unchanged, with shade 1 everywhere', () => {
  const rgbIn = Float64Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120])
  const rgbOut = new Float64Array(12)
  const shade = new Float64Array(4)
  shadeHeightGrid(new Float64Array([5, 5, 5, 5]), 2, 2, 1, Uint8Array.from([1, 1, 1, 1]), rgbIn, rgbOut, 3, 3, shade)
  assert.deepEqual(Array.from(rgbOut), Array.from(rgbIn))
  assert.deepEqual(Array.from(shade), [1, 1, 1, 1])
})

gate('shadeHeightGrid: only land cells with a slope are darkened, and water cells keep their colour', () => {
  const rgbIn = Float64Array.from([200, 200, 200, 200, 200, 200, 200, 200, 200])
  const rgbOut = new Float64Array(9)
  shadeHeightGrid(Float64Array.from([0, 10, 20]), 1, 3, 1, Uint8Array.from([0, 1, 0]), rgbIn, rgbOut, 3, 3, null)
  assert.equal(rgbOut[0], 200, 'water on the left is unshaded')
  assert.equal(rgbOut[6], 200, 'water on the right is unshaded')
  near(rgbOut[3], 200 * reliefShade(10, 0), 1e-9, 'land cell at the slope centre')
  assert.ok(rgbOut[3] < 200, 'the slope control must darken the land cell')
})

gate('elevation: a 10 m shot at 10 m/s over 10 m is exactly pi/4 and over 5 m is pi/12', () => {
  near(elevation(10, 10, 10, 0), Math.PI / 4, 1e-12, 'pi/4 shot')
  near(elevation(10, 10, 5, 0), Math.PI / 12, 1e-12, 'pi/12 shot')
})

gate('elevation: no solution (negative discriminant) and zero distance return null', () => {
  assert.equal(elevation(10, 10, 10, 5), null, 'rise 5 over 10 m at 10 m/s has discriminant -10000')
  assert.equal(elevation(10, 10, 0, 0), null)
  assert.equal(elevation(1, 10, 10, 0), null, 'speed 1 cannot reach 10 m under g 10')
})

gate('elevation: refuses a non-positive speed or g, a bad distance and a non-finite rise with a reasonCode', () => {
  assert.ok(refusesWith(() => elevation(0, 10, 10, 0), 'ballistics-positive-invalid'))
  assert.ok(refusesWith(() => elevation(10, NaN, 10, 0), 'ballistics-positive-invalid'))
  assert.ok(refusesWith(() => elevation(10, 10, -1, 0), 'ballistics-distance-invalid'))
  assert.ok(refusesWith(() => elevation(10, 10, 10, Infinity), 'ballistics-rise-invalid'))
})

const bookmarkWorld = {
  spawnPoint: [1, 2, 3],
  entities: [
    { id: 'spawn-a', app: 'spawn-point', position: [4, 5, 6] },
    { id: 'crate', app: 'box', position: [0, 0, 0] },
  ],
}
const CUBE_NAMES = [
  'face-px', 'face-nx', 'face-py', 'seam-px-py', 'seam-nx-py', 'face-ny', 'seam-px-ny', 'seam-nx-ny', 'face-pz',
  'seam-px-pz', 'seam-nx-pz', 'seam-py-pz', 'corner-px-py-pz', 'corner-nx-py-pz', 'seam-ny-pz', 'corner-px-ny-pz',
  'corner-nx-ny-pz', 'face-nz', 'seam-px-nz', 'seam-nx-nz', 'seam-py-nz', 'corner-px-py-nz', 'corner-nx-py-nz',
  'seam-ny-nz', 'corner-px-ny-nz', 'corner-nx-ny-nz',
]

gate('listBookmarks: the list order is spawn, spawn points, origin, out distances, search terms, 26 cube directions, poles', () => {
  const names = listBookmarks(bookmarkWorld, null).map((b) => b.name)
  assert.deepEqual(names, ['spawn', 'a', 'origin', 'out-5km', 'out-20km', 'out-100km', 'coast', 'hills', 'forest', 'rocks', ...CUBE_NAMES, 'pole-north', 'pole-south'])
  assert.equal(names.length, 38)
})

gate('listBookmarks: spawn specs carry standNearY and the plain specs carry x and z only', () => {
  const list = listBookmarks(bookmarkWorld, null)
  assert.deepEqual(list[0].spec, { x: 1, standNearY: 2, z: 3 })
  assert.deepEqual(list[1].spec, { x: 4, standNearY: 5, z: 6 })
  assert.deepEqual(list[2].spec, { x: 0, z: 0 })
  assert.deepEqual(list[3].spec, { x: 5000, z: 0 })
  assert.deepEqual(list[6], { name: 'coast', search: 'coast' })
})

gate('listBookmarks: fromBase converts the chart point before the spec is built', () => {
  const fromBase = { point: (p) => [p[0] + 10, p[1], p[2] - 1] }
  const list = listBookmarks(bookmarkWorld, null, fromBase)
  assert.deepEqual(list[0].spec, { x: 11, standNearY: 2, z: 2 })
  assert.deepEqual(list[2].spec, { x: 10, z: -1 })
})

gate('listBookmarks: without a frame every direction has null angle and null reachability', () => {
  const dirs = listBookmarks(bookmarkWorld, null).filter((b) => b.dir || b.spec?.dir)
  assert.equal(dirs.length, 28)
  for (const d of dirs) {
    assert.equal(d.angleDeg, null)
    assert.equal(d.reachable, null)
    assert.equal(d.tiltWalkable, null)
  }
})

gate('listBookmarks: with an up-axis frame the angle, reach and tilt walkability follow the 87 and 45 degree limits', () => {
  const list = listBookmarks(bookmarkWorld, { up: [0, 1, 0] })
  const by = Object.fromEntries(list.filter((b) => 'angleDeg' in b).map((b) => [b.name, b]))
  assert.equal(by['pole-north'].angleDeg, 0)
  assert.equal(by['pole-north'].reachable, true)
  assert.equal(by['pole-north'].tiltWalkable, true)
  assert.equal(by['pole-south'].reachable, false)
  assert.equal(by['face-px'].reachable, false, 'a 90 degree face is past the 87 degree reach')
  near(by['seam-px-py'].angleDeg, 45, 1e-9, 'seam angle')
  assert.equal(by['seam-px-py'].tiltWalkable, true, 'the seam at 45 degrees is under the 45.0001 degree walkable limit')
  near(by['corner-px-py-pz'].angleDeg, 54.7356, 1e-3, 'corner angle')
  assert.equal(by['corner-px-py-pz'].reachable, true)
  assert.equal(by['corner-px-py-pz'].tiltWalkable, false, 'the corner at 54.7 degrees is steeper than walkable')
  assert.equal(by['corner-px-ny-pz'].reachable, false, 'a corner at 125 degrees is past reach')
})

gate('equipment: resolve maps a declared name to index plus one and refuses a bad list, name or undeclared name', () => {
  assert.deepEqual(equipResolve(['sword', 'bow'], 'bow'), { code: 2, reason: 'named', name: 'bow', at: 1 })
  assert.deepEqual(equipResolve(['sword', 'bow'], 'axe'), { code: null, reason: 'name-not-declared', name: 'axe' })
  assert.deepEqual(equipResolve('sword', 'bow'), { code: null, reason: 'equipment-not-a-list' })
  assert.deepEqual(equipResolve(['sword'], 3), { code: null, reason: 'name-not-a-string' })
  assert.equal(EQUIP_UNARMED, 0)
})

gate('equipment: nameOf maps code one to the first name and refuses code zero, fractions and empty slots', () => {
  assert.deepEqual(equipNameOf(['sword', 'bow'], 1), { name: 'sword', reason: 'named' })
  assert.deepEqual(equipNameOf(['sword', 'bow'], 0), { name: null, reason: 'code-below-one' })
  assert.deepEqual(equipNameOf(['sword', 'bow'], 1.5), { name: null, reason: 'code-not-an-integer' })
  assert.deepEqual(equipNameOf(['sword', 'bow'], 3), { name: null, reason: 'empty-slot' })
  assert.deepEqual(equipNameOf(null, 1), { name: null, reason: 'equipment-not-a-list' })
})

gate('materialSlots: null is accepted as no slots and a valid slot set is returned unchanged', () => {
  assert.deepEqual(parseMaterialSlots(null), { ok: true, value: null })
  const slots = { paint: { color: '#A0b1C2', roughness: 0.5, metalness: 0, texture: 'textures/brick_01.png' } }
  assert.deepEqual(parseMaterialSlots(slots), { ok: true, value: slots })
})

gate('materialSlots: refuses non-object roots, arrays, oversize sets and empty or long names', () => {
  assert.equal(parseMaterialSlots([]).reason, 'not-object')
  assert.equal(parseMaterialSlots('x').reason, 'not-object')
  const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['s' + i, {}]))
  assert.equal(parseMaterialSlots(many).reason, 'too-many-slots')
  assert.equal(parseMaterialSlots({ '': {} }).reason, 'slot-bad-name')
  assert.equal(parseMaterialSlots({ ['n'.repeat(129)]: {} }).reason, 'slot-bad-name')
  assert.equal(parseMaterialSlots({ ok: {}, ['n'.repeat(64)]: {} }).ok, true, 'a 64 character name is within the 128 limit')
})

gate('materialSlots: refuses a slot that is not an object, an unknown field, a bad colour, texture or range', () => {
  assert.equal(parseMaterialSlots({ a: [] }).reason, 'slot-not-object')
  assert.equal(parseMaterialSlots({ a: null }).reason, 'slot-not-object')
  assert.equal(parseMaterialSlots({ a: { emissive: 1 } }).reason, 'slot-unknown-field')
  assert.equal(parseMaterialSlots({ a: { color: '#FFF' } }).reason, 'slot-bad-color')
  assert.equal(parseMaterialSlots({ a: { color: 'red' } }).reason, 'slot-bad-color')
  assert.equal(parseMaterialSlots({ a: { texture: '../secret.png' } }).reason, 'slot-bad-texture')
  assert.equal(parseMaterialSlots({ a: { texture: 'a b.png' } }).reason, 'slot-bad-texture')
  const range = parseMaterialSlots({ a: { roughness: 1.5 } })
  assert.equal(range.reason, 'slot-bad-range')
  assert.equal(range.detail, 'a.roughness')
  assert.equal(parseMaterialSlots({ a: { metalness: -0.1 } }).reason, 'slot-bad-range')
  assert.equal(parseMaterialSlots({ a: { roughness: NaN } }).reason, 'slot-bad-range')
})

const presetTable = {
  base: {
    tickRate: 64,
    movement: { maxSpeed: 7, groundAccel: 300 },
    entities: [{ id: 'floor', app: 'box-static' }, { id: 'wall', app: 'box-static' }],
  },
  box: (p = {}) => ({ entities: [{ id: 'floor', app: 'box', size: p.size ?? 1 }] }),
}

gate('worldPresets: a non-function preset merges under the world, and the world keys win', () => {
  const out = expandWorldPresets({ presets: ['base'], tickRate: 30 }, presetTable)
  assert.equal(out.tickRate, 30)
  assert.equal(out.movement.maxSpeed, 7)
  assert.equal(out.movement.groundAccel, 300)
  assert.deepEqual(out.entities.map((e) => e.id), ['floor', 'wall'])
  assert.equal('presets' in out, false)
})

gate('worldPresets: a world movement key merges deep into the preset movement', () => {
  const out = expandWorldPresets({ presets: ['base'], movement: { maxSpeed: 2 } }, presetTable)
  assert.deepEqual(out.movement, { maxSpeed: 2, groundAccel: 300 })
})

gate('worldPresets: a function preset gets its parameters, replaces the entity with the same id and loses its key', () => {
  const out = expandWorldPresets({ presets: ['base', 'box'], box: { size: 3 } }, presetTable)
  assert.deepEqual(out.entities.map((e) => e.id), ['wall', 'floor'])
  assert.equal(out.entities[1].app, 'box')
  assert.equal(out.entities[1].size, 3)
  assert.equal('box' in out, false, 'the parameter key is consumed')
})

gate('worldPresets: a world with no presets key is returned as the same object', () => {
  const w = { tickRate: 30 }
  assert.equal(expandWorldPresets(w, presetTable), w)
})

gate('worldPresets: refuses a repeated name, an unknown name, a non-array list and a missing table', () => {
  assert.ok(throwsTypeError(() => expandWorldPresets({ presets: ['base', 'base'] }, presetTable)))
  assert.ok(throwsTypeError(() => expandWorldPresets({ presets: ['nope'] }, presetTable)))
  assert.ok(throwsTypeError(() => expandWorldPresets({ presets: 'base' }, presetTable)))
  assert.ok(throwsTypeError(() => expandWorldPresets({ presets: ['base'] }, undefined)))
})

gate('worldPresets: refuses parameters on a plain preset and non-object parameters on a function preset', () => {
  assert.ok(throwsTypeError(() => expandWorldPresets({ presets: ['base'], base: { x: 1 } }, presetTable)))
  assert.ok(throwsTypeError(() => expandWorldPresets({ presets: ['box'], box: 3 }, presetTable)))
})

gate('worldPresets: a prototype key such as constructor is not a preset', () => {
  assert.ok(throwsTypeError(() => expandWorldPresets({ presets: ['constructor'] }, presetTable)))
})

gate('worldResolve: an empty world resolves with the authoritative netcode profile', () => {
  const r = parseWorld({})
  assert.equal(r.ok, true)
  assert.deepEqual(r.world.netcode, { name: 'authoritative', options: {}, peerSimulated: false, minPeers: 2 })
})

gate('worldResolve: a non-object world is refused at the root with WORLD_NOT_A_PLAIN_OBJECT', () => {
  const r = parseWorld(null)
  assert.equal(r.ok, false)
  assert.equal(r.path, '')
  assert.equal(r.code, WORLD_NOT_A_PLAIN_OBJECT)
  assert.equal(parseWorld([]).code, WORLD_NOT_A_PLAIN_OBJECT)
})

gate('worldResolve: tickRate is accepted up to 1000 and refused above it, and zero is refused', () => {
  assert.equal(parseWorld({ tickRate: 1000 }).ok, true)
  const high = parseWorld({ tickRate: 1001 })
  assert.equal(high.ok, false)
  assert.equal(high.path, 'tickRate')
  assert.equal(high.code, WORLD_FIELD_INVALID)
  assert.equal(parseWorld({ tickRate: 0 }).ok, false)
})

gate('worldResolve: a movement block is validated, a null extension field is dropped and a null default field is refused', () => {
  assert.deepEqual(parseWorld({ movement: { maxSpeed: 5, sprintSpeed: 9 } }).world.movement, { maxSpeed: 5, sprintSpeed: 9 })
  assert.deepEqual(parseWorld({ movement: { sprintSpeed: null } }).world.movement, {})
  const zero = validateMovement({ maxSpeed: 0 })
  assert.equal(zero.ok, false)
  assert.equal(zero.path, 'movement.maxSpeed')
  assert.equal(validateMovement({ bogus: 1 }).field, 'bogus')
  assert.equal(validateMovement({ maxSpeed: null }).ok, false)
  assert.equal(validateMovement(null).path, 'movement')
})

gate('worldResolve: terrain true is refused, false passes through, and an object needs a parser', () => {
  assert.equal(parseWorld({ terrain: true }).path, 'terrain')
  assert.equal(parseWorld({ terrain: false }).world.terrain, false)
  assert.equal(parseWorld({ terrain: {} }).ok, false, 'no parser supplied is a refusal, not a silent accept')
  assert.ok(throwsTypeError(() => parseWorld({ terrain: {} }, { parseTerrain: 'nope' })))
})

const fakeTerrain = (t) => (t.bad
  ? { ok: false, path: 'physics.extent', reason: 'extent is wrong' }
  : { ok: true, config: { ...t, parsed: true } })

gate('worldResolve: a terrain object is replaced by the parser config, and a parser refusal gets the terrain path prefix', () => {
  const ok = parseWorld({ terrain: { seed: 1 } }, { parseTerrain: fakeTerrain })
  assert.deepEqual(ok.world.terrain, { seed: 1, parsed: true })
  const bad = parseWorld({ terrain: { bad: 1 } }, { parseTerrain: fakeTerrain })
  assert.equal(bad.path, 'terrain.physics.extent')
  assert.equal(bad.reason, 'extent is wrong')
})

gate('worldResolve: duplicate entity ids and malformed entity fields are refused with the entity path', () => {
  const dup = parseWorld({ entities: [{ id: 'a' }, { id: 'a' }] })
  assert.equal(dup.path, 'entities[1].id')
  assert.equal(dup.reason, 'duplicate entity id "a"')
  assert.equal(parseWorld({ entities: [{ position: [1, 2] }] }).path, 'entities[0].position')
  assert.equal(parseWorld({ entities: [{ rotation: [0, 0, 0] }] }).path, 'entities[0].rotation')
  assert.equal(parseWorld({ entities: [{ id: '' }] }).path, 'entities[0].id')
  assert.equal(parseWorld({ entities: [{ id: 'ok' }] }).ok, true)
})

gate('worldResolve: equipment rejects repeated and empty names, and input mobile buttons reject repeated actions', () => {
  assert.equal(parseWorld({ equipment: ['sword', 'sword'] }).path, 'equipment')
  assert.equal(parseWorld({ equipment: [''] }).path, 'equipment')
  assert.equal(parseWorld({ equipment: ['sword', 'bow'] }).ok, true)
  assert.equal(parseWorld({ input: { mobileButtons: [{ action: 'jump' }, { action: 'jump' }] } }).path, 'input.mobileButtons')
})

gate('worldResolve: a bad netcode block is refused with the netcode path and the profile message', () => {
  const string = parseWorld({ netcode: 'lockstep' })
  assert.equal(string.path, 'netcode')
  assert.equal(string.reason, '[netcode] netcode must be an object declaring profile and per-profile options, got "lockstep"')
  const peers = parseWorld({ netcode: { profile: 'lockstep', peers: -1 } })
  assert.equal(peers.reason, '[netcode] netcode.peers must be a non-negative integer, got -1')
})

gate('worldResolve: a world netcode block keeps its own keys beside the resolved profile', () => {
  const r = parseWorld({ netcode: { profile: 'lockstep', peers: 3 } })
  assert.equal(r.world.netcode.name, 'lockstep')
  assert.equal(r.world.netcode.minPeers, 3)
  assert.equal(r.world.netcode.profile, 'lockstep')
})

gate('worldResolve: assertWorld throws a WorldResolveError naming the world, and returns the world when valid', () => {
  assert.throws(() => assertWorld({ tickRate: 0 }, 'arena'), (error) => {
    assert.ok(error instanceof WorldResolveError)
    assert.equal(error.code, WORLD_FIELD_INVALID)
    assert.equal(error.path, 'tickRate')
    assert.equal(error.worldName, 'arena')
    assert.equal(error.message, '[world] invalid world "arena": tickRate must be a finite number in (0, 1000]')
    return true
  })
  assert.equal(assertWorld({ name: 'x' }).name, 'x')
  assert.throws(() => assertWorld({ tickRate: 0, name: 'named' }), (error) => error.worldName === 'named')
})

gate('colliderLattice: defaults give 128 samples at 510/127 m and no source-follow', () => {
  const l = colliderLatticeOf({})
  assert.equal(l.extentM, COLLIDER_DEFAULT_EXTENT_M)
  assert.equal(l.resolutionM, 4)
  assert.equal(l.configuredN, 128)
  assert.equal(l.N, 128)
  assert.equal(l.followsSource, false)
  assert.equal(l.fineFieldMaxN, 512)
  near(l.spacingM, 510 / 127, 1e-12, 'spacing')
})

gate('colliderLattice: an odd configured count is rounded up to even, 100 m at 3 m gives 34', () => {
  const l = colliderLatticeOf({ physics: { extent: 100, resolution: 3 } })
  assert.equal(l.configuredN, 34)
  near(l.configuredSpacingM, 100 / 33, 1e-12, 'configured spacing')
})

gate('colliderLattice: a finer source grid raises N to the source count, capped at 512', () => {
  const coarse = colliderLatticeOf({}, { sourceSpacingM: 1 })
  assert.equal(coarse.sourceN, 511)
  assert.equal(coarse.N, 511)
  assert.equal(coarse.followsSource, true)
  near(coarse.spacingM, 1, 1e-12, 'spacing follows the source')
  const capped = colliderLatticeOf({}, { sourceSpacingM: 0.1 })
  assert.equal(capped.sourceN, 512, 'the 1 MiB budget caps the source count at 512')
  assert.equal(capped.N, 512)
})

gate('colliderLattice: a source count below the configured count does not lower N, and followSource false turns the source off', () => {
  const low = colliderLatticeOf({}, { sourceSpacingM: 10 })
  assert.equal(low.sourceN, 52)
  assert.equal(low.N, 128)
  const off = colliderLatticeOf({ physics: { followSource: false } }, { sourceSpacingM: 1 })
  assert.equal(off.followsSource, false)
  assert.equal(off.N, 128)
})

gate('colliderLattice: bad extent or resolution fall back to the defaults', () => {
  assert.equal(colliderLatticeOf({ physics: { extent: 'big', resolution: -1 } }).extentM, 510)
  assert.equal(colliderLatticeOf({ physics: { extent: 'big', resolution: -1 } }).resolutionM, 4)
})

gate('colliderLattice: sourceSpacingOfBake reads extent over N minus one and refuses a bad header', () => {
  assert.equal(sourceSpacingOfBake({ N: 129, extent: 256 }), 2)
  assert.equal(sourceSpacingOfBake({ N: 1, extent: 256 }), 0)
  assert.equal(sourceSpacingOfBake({ N: 2.5, extent: 256 }), 0)
  assert.equal(sourceSpacingOfBake({ N: 129, extent: -1 }), 0)
  assert.equal(sourceSpacingOfBake(null), 0)
})

const bakeIo = (over = {}) => {
  const calls = { read: [], warn: [] }
  const io = {
    read: async (url) => { calls.read.push(url); if (over.readError) throw over.readError; return new Uint8Array([1]) },
    decode: over.decode ?? (() => ({ N: 129, extent: 256 })),
    warn: (...args) => calls.warn.push(args),
  }
  return { io, calls }
}

await probe('no-bake', async () => {
  const { io, calls } = bakeIo()
  return { lattice: await colliderLatticeSpacingOf({ physics: { extent: 256, resolution: 2 } }, io), reads: calls.read.length }
})
await probe('bake', async () => {
  const { io, calls } = bakeIo()
  return { lattice: await colliderLatticeSpacingOf({ bakedHeightfield: '/terrain/x.bin', physics: { extent: 256, resolution: 2 } }, io), reads: calls.read, warns: calls.warn.length }
})
await probe('read-failure', async () => {
  const { io, calls } = bakeIo({ readError: new Error('disk gone') })
  return { lattice: await colliderLatticeSpacingOf({ bakedHeightfield: '/terrain/x.bin', physics: { extent: 256, resolution: 2 } }, io), warns: calls.warn }
})
await probe('bad-bake', async () => {
  const { io, calls } = bakeIo({ decode: () => ({ N: 1, extent: 256 }) })
  return { lattice: await colliderLatticeSpacingOf({ bakedHeightfield: '/terrain/x.bin', physics: { extent: 256, resolution: 2 } }, io), warns: calls.warn.length }
})
await probe('missing-io', async () => colliderLatticeSpacingOf({}, undefined))

gate('colliderLattice: with no bake the async lattice is configured and never reads', () => {
  const r = probed('no-bake')
  assert.equal(r.lattice.kind, 'configured')
  assert.equal(r.lattice.sourceSpacingM, 0)
  assert.equal(r.lattice.N, 128)
  assert.equal(r.reads, 0)
})

gate('colliderLattice: a readable bake sets kind bake and follows its 2 m spacing to N 129', () => {
  const r = probed('bake')
  assert.equal(r.lattice.kind, 'bake')
  assert.equal(r.lattice.sourceSpacingM, 2)
  assert.equal(r.lattice.N, 129)
  near(r.lattice.spacingM, 2, 1e-12, 'spacing')
  assert.deepEqual(r.reads, ['/terrain/x.bin'])
  assert.equal(r.warns, 0)
})

gate('colliderLattice: a read failure falls back to the configured lattice and warns once with the cause', () => {
  const r = probed('read-failure')
  assert.equal(r.lattice.kind, 'configured')
  assert.equal(r.lattice.N, 128)
  assert.equal(r.warns.length, 1)
  assert.match(r.warns[0][0], /could not be read, so the near band takes the configured collider lattice/)
  assert.equal(r.warns[0][1], 'disk gone')
})

gate('colliderLattice: a bake with no usable spacing is treated as no bake and does not warn', () => {
  const r = probed('bad-bake')
  assert.equal(r.lattice.kind, 'configured')
  assert.equal(r.warns, 0)
})

gate('colliderLattice: a missing io object is refused with a TypeError', () => {
  const error = probes['missing-io'].error
  assert.ok(error instanceof TypeError, 'expected a TypeError, got ' + (error && error.name))
})

gate('shared-pure sources carry no comment markers and read no host global', () => {
  for (const name of SHARED_FILES) {
    const source = readFileSync(join(root, 'src/shared', name + '.js'), 'utf8')
    assert.equal(source.includes('//'), false, name + ' has a line comment marker')
    assert.equal(source.includes('/*'), false, name + ' has a block comment marker')
    for (const token of HOST_GLOBALS) {
      assert.equal(source.includes(token), false, name + ' reads ' + token)
    }
  }
})

finish()
