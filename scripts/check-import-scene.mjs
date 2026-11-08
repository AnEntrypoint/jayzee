import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { mapSceneObject, mapScene } from '../src/sdk/sceneImport.js'
import { importTiledMap } from '../src/sdk/tiledImport.js'

const TABLE = { crate: 'Crate.template', door: 'Door.template' }

const refusalOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return null
}

const expectRefusal = (fn, code) => {
  const error = refusalOf(fn)
  assert.ok(error, `expected a refusal with reasonCode ${code}`)
  assert.equal(error.reasonCode, code)
}

const crate = () => ({
  id: 'crate-1',
  kind: 'crate',
  position: { x: 1, y: 2, z: 3 },
  rotation: [0, 0, 0.5, 0.8660254],
  state: { hp: 5, color: 'red' },
})

const expectedCrate = {
  id: 'crate-1',
  template: 'Crate.template',
  position: [1, 2, 3],
  rotation: [0, 0, 0.5, 0.8660254],
  scale: [1, 1, 1],
  custom: { hp: 5, color: 'red' },
}

gate('mapSceneObject returns the spoint placement shape', () => {
  assert.deepEqual(mapSceneObject(crate(), TABLE, 0), expectedCrate)
})

gate('mapSceneObject result is frozen', () => {
  const placement = mapSceneObject(crate(), TABLE, 0)
  assert.equal(Object.isFrozen(placement), true)
  assert.deepEqual(Object.keys(placement), ['id', 'template', 'position', 'rotation', 'scale', 'custom'])
})

gate('mapSceneObject takes position as an array or as x,y,z', () => {
  assert.deepEqual(mapSceneObject({ id: 'a', kind: 'crate', position: [4, 5, 6] }, TABLE).position, [4, 5, 6])
  assert.deepEqual(mapSceneObject({ id: 'a', kind: 'crate', position: { x: 1, y: 2, z: 3 } }, TABLE).position, [1, 2, 3])
})

gate('mapSceneObject position is copied, not aliased to the caller', () => {
  const input = [4, 5, 6]
  const placement = mapSceneObject({ id: 'a', kind: 'crate', position: input }, TABLE)
  placement.position[0] = 99
  assert.deepEqual(input, [4, 5, 6])
})

gate('mapSceneObject defaults a missing position to the origin, rotation to identity and scale to unit', () => {
  const placement = mapSceneObject({ id: 'a', kind: 'crate' }, TABLE)
  assert.deepEqual(placement.position, [0, 0, 0])
  assert.deepEqual(placement.rotation, [0, 0, 0, 1])
  assert.deepEqual(placement.scale, [1, 1, 1])
  assert.deepEqual(placement.custom, {})
})

gate('mapSceneObject null scale defaults to unit, explicit scale is kept in both forms', () => {
  assert.deepEqual(mapSceneObject({ id: 'a', kind: 'crate', scale: null }, TABLE).scale, [1, 1, 1])
  assert.deepEqual(mapSceneObject({ id: 'a', kind: 'crate', scale: [2, 2, 2] }, TABLE).scale, [2, 2, 2])
  assert.deepEqual(mapSceneObject({ id: 'a', kind: 'crate', scale: { x: 2, y: 3, z: 4 } }, TABLE).scale, [2, 3, 4])
})

gate('mapSceneObject custom is a shallow copy of state', () => {
  const object = crate()
  const placement = mapSceneObject(object, TABLE)
  placement.custom.hp = 0
  assert.equal(object.state.hp, 5)
})

gate('mapSceneObject custom is empty for a null or absent state', () => {
  assert.deepEqual(mapSceneObject({ id: 'a', kind: 'crate', state: null }, TABLE).custom, {})
  assert.deepEqual(mapSceneObject({ id: 'a', kind: 'crate' }, TABLE).custom, {})
})

gate('control: a valid object with the same table is not refused', () => {
  assert.doesNotThrow(() => mapSceneObject(crate(), TABLE, 0))
})

gate('mapSceneObject refuses a non-object with scene-object', () => {
  expectRefusal(() => mapSceneObject(null, TABLE), 'scene-object')
  expectRefusal(() => mapSceneObject('crate', TABLE), 'scene-object')
  expectRefusal(() => mapSceneObject(undefined, TABLE), 'scene-object')
})

gate('mapSceneObject refuses a missing, empty or non-string id with scene-object-id', () => {
  expectRefusal(() => mapSceneObject({ kind: 'crate' }, TABLE), 'scene-object-id')
  expectRefusal(() => mapSceneObject({ id: '', kind: 'crate' }, TABLE), 'scene-object-id')
  expectRefusal(() => mapSceneObject({ id: 7, kind: 'crate' }, TABLE), 'scene-object-id')
})

gate('mapSceneObject refuses a kind with no template with scene-kind-unmapped', () => {
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'bomb' }, TABLE), 'scene-kind-unmapped')
  expectRefusal(() => mapSceneObject({ id: 'a' }, TABLE), 'scene-kind-unmapped')
})

gate('mapSceneObject refuses an inherited key such as toString as an unmapped kind', () => {
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'toString' }, TABLE), 'scene-kind-unmapped')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'constructor' }, TABLE), 'scene-kind-unmapped')
})

gate('mapSceneObject refuses a non-string kind even when String(kind) is a mapped key', () => {
  const table = { '1': 'One.template' }
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 1 }, table), 'scene-kind-unmapped')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: ['1'] }, table), 'scene-kind-unmapped')
})

gate('mapSceneObject refuses an empty or non-string template with scene-kind-unmapped', () => {
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate' }, { crate: '' }), 'scene-kind-unmapped')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate' }, { crate: 5 }), 'scene-kind-unmapped')
})

gate('mapSceneObject refuses a missing kind table with scene-kind-table', () => {
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate' }, undefined), 'scene-kind-table')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate' }, null), 'scene-kind-table')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate' }, 'crate'), 'scene-kind-table')
})

gate('mapSceneObject refuses a malformed position with scene-vector', () => {
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', position: [1, 2] }, TABLE), 'scene-vector')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', position: [1, 2, NaN] }, TABLE), 'scene-vector')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', position: { x: 1, y: 2 } }, TABLE), 'scene-vector')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', position: 'abc' }, TABLE), 'scene-vector')
})

gate('mapSceneObject refuses a non-finite scale with scene-vector', () => {
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', scale: [1, Infinity, 1] }, TABLE), 'scene-vector')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', scale: '1' }, TABLE), 'scene-vector')
})

gate('mapSceneObject refuses a sparse position or scale with scene-vector, not undefined components', () => {
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', position: [,,,] }, TABLE), 'scene-vector')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', scale: [1,,1] }, TABLE), 'scene-vector')
})

gate('mapSceneObject refuses a sparse rotation with scene-quaternion', () => {
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', rotation: [,,,,] }, TABLE), 'scene-quaternion')
})

gate('mapSceneObject refuses a malformed rotation with scene-quaternion', () => {
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', rotation: [0, 0, 0] }, TABLE), 'scene-quaternion')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', rotation: { x: 0, y: 0, z: 0, w: 1 } }, TABLE), 'scene-quaternion')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', rotation: [0, 0, 0, '1'] }, TABLE), 'scene-quaternion')
})

gate('mapSceneObject refuses a non-object state with scene-state, where spoint dropped it silently', () => {
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', state: 'hot' }, TABLE), 'scene-state')
  expectRefusal(() => mapSceneObject({ id: 'a', kind: 'crate', state: [1, 2] }, TABLE), 'scene-state')
})

gate('mapSceneObject refusal names the object index it came from', () => {
  const error = refusalOf(() => mapSceneObject({ id: 'a', kind: 'bomb' }, TABLE, 3))
  assert.equal(error.message, 'SceneImport: object[3] kind "bomb" has no template')
})

const sceneOf = (objects, extra = {}) => ({ id: 'town', spawn: [0, 1, 0], objects, ...extra })

gate('mapScene returns the place and placements in input order', () => {
  const result = mapScene(sceneOf([crate(), { id: 'door-1', kind: 'door' }]), TABLE)
  assert.deepEqual(result.place, { id: 'town', spawn: [0, 1, 0] })
  assert.equal(result.placements.length, 2)
  assert.deepEqual(result.placements[0], expectedCrate)
  assert.deepEqual(result.placements[1], {
    id: 'door-1',
    template: 'Door.template',
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    custom: {},
  })
})

gate('mapScene result and its arrays are frozen', () => {
  const result = mapScene(sceneOf([crate()]), TABLE)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.place), true)
  assert.equal(Object.isFrozen(result.placements), true)
})

gate('mapScene defaults a missing spawn to the origin and missing or null objects to none', () => {
  assert.deepEqual(mapScene({ id: 'town' }, TABLE).place.spawn, [0, 0, 0])
  assert.deepEqual(mapScene({ id: 'town', objects: null }, TABLE).placements, [])
  assert.deepEqual(mapScene({ id: 'town' }, TABLE).placements, [])
})

gate('mapScene refuses objects that are present but not an array with scene-objects', () => {
  expectRefusal(() => mapScene({ id: 'town', objects: {} }, TABLE), 'scene-objects')
  expectRefusal(() => mapScene({ id: 'town', objects: 'crate' }, TABLE), 'scene-objects')
})

gate('mapScene refuses a hole in the objects array with scene-object, not a hole in placements', () => {
  expectRefusal(() => mapScene(sceneOf([, crate()]), TABLE), 'scene-object')
})

gate('mapScene refuses a repeated object id with scene-object-duplicate', () => {
  expectRefusal(() => mapScene(sceneOf([crate(), crate()]), TABLE), 'scene-object-duplicate')
  const error = refusalOf(() => mapScene(sceneOf([crate(), crate()]), TABLE))
  assert.equal(error.message, 'SceneImport: object[1] id "crate-1" repeats')
})

gate('mapScene refuses a missing or empty scene id and a non-object scene', () => {
  expectRefusal(() => mapScene({ objects: [] }, TABLE), 'scene-id')
  expectRefusal(() => mapScene({ id: '', objects: [] }, TABLE), 'scene-id')
  expectRefusal(() => mapScene(null, TABLE), 'scene-root')
  expectRefusal(() => mapScene('town', TABLE), 'scene-root')
})

gate('mapScene refuses a missing kind table with scene-kind-table', () => {
  expectRefusal(() => mapScene(sceneOf([]), undefined), 'scene-kind-table')
})

gate('mapScene refuses a malformed spawn with scene-vector', () => {
  expectRefusal(() => mapScene(sceneOf([], { spawn: [0, 0] }), TABLE), 'scene-vector')
})

gate('mapScene checks objects before the spawn, as spoint does', () => {
  expectRefusal(() => mapScene(sceneOf([{ id: 'a', kind: 'bomb' }], { spawn: [0, 0] }), TABLE), 'scene-kind-unmapped')
})

gate('mapScene refuses a bad object with the index that failed', () => {
  const error = refusalOf(() => mapScene(sceneOf([crate(), { id: 'door-1', kind: 'bomb' }]), TABLE))
  assert.equal(error.reasonCode, 'scene-kind-unmapped')
  assert.equal(error.message, 'SceneImport: object[1] kind "bomb" has no template')
})

const tiledMap = () => ({
  orientation: 'orthogonal',
  tilewidth: 16,
  tileheight: 16,
  width: 3,
  height: 2,
  properties: [{ name: 'music', type: 'string', value: 'town' }],
  layers: [
    { type: 'tilelayer', name: 'ground', width: 3, height: 2, data: [1, 0, 2, 0, 3, 0] },
    {
      type: 'objectgroup',
      name: 'spawns',
      objects: [
        { id: 7, name: 'spawn', type: 'Spawn', x: 24, y: 8, width: 0, height: 0, rotation: 0, visible: true, properties: [{ name: 'team', type: 'string', value: 'red' }] },
        { id: 8, x: 5, y: 6 },
      ],
    },
    { type: 'tilelayer', name: 'hidden', visible: false, width: 1, data: [9] },
    { type: 'imagelayer', name: 'bg' },
  ],
})

const expectedTiled = {
  width: 3,
  height: 2,
  tileSize: 16,
  properties: { music: 'town' },
  placements: [
    { kind: 'tile', layer: 'ground', gid: 1, col: 0, row: 0, x: 0, y: 0 },
    { kind: 'tile', layer: 'ground', gid: 2, col: 2, row: 0, x: 32, y: 0 },
    { kind: 'tile', layer: 'ground', gid: 3, col: 1, row: 1, x: 16, y: 16 },
    {
      kind: 'object', layer: 'spawns', id: 7, name: 'spawn', type: 'Spawn', x: 24, y: 8,
      width: 0, height: 0, rotation: 0, visible: true, gid: null, properties: { team: 'red' },
    },
    {
      kind: 'object', layer: 'spawns', id: 8, name: '', type: '', x: 5, y: 6,
      width: 0, height: 0, rotation: 0, visible: true, gid: null, properties: {},
    },
  ],
}

gate('importTiledMap returns the spoint shape with tiles in row-major order and objects in layer order', () => {
  assert.deepEqual(importTiledMap(tiledMap()), expectedTiled)
})

gate('importTiledMap skips hidden layers and layer types it does not read', () => {
  const imported = importTiledMap(tiledMap())
  assert.equal(imported.placements.some(p => p.layer === 'hidden'), false)
  assert.equal(imported.placements.some(p => p.layer === 'bg'), false)
})

gate('importTiledMap with only an image layer gives no placements', () => {
  const result = importTiledMap({ orientation: 'orthogonal', tilewidth: 8, layers: [{ type: 'imagelayer', name: 'bg' }] })
  assert.deepEqual(result.placements, [])
  assert.deepEqual(result.properties, {})
})

gate('importTiledMap imports a 400 by 400 tile layer without spreading its placements into arguments', () => {
  const data = new Array(400 * 400).fill(1)
  const result = importTiledMap({ orientation: 'orthogonal', tilewidth: 16, layers: [{ type: 'tilelayer', name: 'big', width: 400, data }] })
  assert.equal(result.placements.length, 160000)
  assert.deepEqual(result.placements[159999], { kind: 'tile', layer: 'big', gid: 1, col: 399, row: 399, x: 6384, y: 6384 })
})

gate('importTiledMap refuses a non-orthogonal or missing orientation with tiled-orientation', () => {
  expectRefusal(() => importTiledMap({ ...tiledMap(), orientation: 'isometric' }), 'tiled-orientation')
  expectRefusal(() => importTiledMap({ ...tiledMap(), orientation: undefined }), 'tiled-orientation')
})

gate('importTiledMap refuses a tilewidth that is not a positive integer with tiled-tilesize', () => {
  expectRefusal(() => importTiledMap({ ...tiledMap(), tilewidth: 0 }), 'tiled-tilesize')
  expectRefusal(() => importTiledMap({ ...tiledMap(), tilewidth: 1.5 }), 'tiled-tilesize')
  expectRefusal(() => importTiledMap({ ...tiledMap(), tilewidth: '16' }), 'tiled-tilesize')
})

gate('importTiledMap refuses a non-object map or layer with tiled-shape', () => {
  expectRefusal(() => importTiledMap(null), 'tiled-shape')
  expectRefusal(() => importTiledMap('map'), 'tiled-shape')
  expectRefusal(() => importTiledMap({ ...tiledMap(), layers: [null] }), 'tiled-shape')
  expectRefusal(() => importTiledMap({ ...tiledMap(), layers: [5] }), 'tiled-shape')
})

gate('importTiledMap refuses missing or non-array layers with tiled-shape', () => {
  expectRefusal(() => importTiledMap({ ...tiledMap(), layers: undefined }), 'tiled-shape')
  expectRefusal(() => importTiledMap({ ...tiledMap(), layers: {} }), 'tiled-shape')
})

gate('importTiledMap refuses a tile layer without a positive integer width with tiled-layer', () => {
  const layers = (width) => [{ type: 'tilelayer', name: 'g', width, data: [1] }]
  expectRefusal(() => importTiledMap({ orientation: 'orthogonal', tilewidth: 8, layers: layers(undefined) }), 'tiled-layer')
  expectRefusal(() => importTiledMap({ orientation: 'orthogonal', tilewidth: 8, layers: layers(0) }), 'tiled-layer')
  expectRefusal(() => importTiledMap({ orientation: 'orthogonal', tilewidth: 8, layers: layers(1.5) }), 'tiled-layer')
})

gate('importTiledMap refuses tile data that is not an array with tiled-shape', () => {
  const layers = [{ type: 'tilelayer', name: 'g', width: 2, data: 'AAAA' }]
  expectRefusal(() => importTiledMap({ orientation: 'orthogonal', tilewidth: 8, layers }), 'tiled-shape')
})

gate('importTiledMap refuses a gid that is not a non-negative integer with tiled-gid', () => {
  const withGid = (gid) => ({ orientation: 'orthogonal', tilewidth: 8, layers: [{ type: 'tilelayer', name: 'g', width: 2, data: [gid] }] })
  expectRefusal(() => importTiledMap(withGid(1.5)), 'tiled-gid')
  expectRefusal(() => importTiledMap(withGid('1')), 'tiled-gid')
  expectRefusal(() => importTiledMap(withGid(-1)), 'tiled-gid')
  expectRefusal(() => importTiledMap(withGid(null)), 'tiled-gid')
})

gate('importTiledMap reads gid 0 as an empty cell, not a refusal', () => {
  const result = importTiledMap({ orientation: 'orthogonal', tilewidth: 8, layers: [{ type: 'tilelayer', name: 'g', width: 2, data: [0, 0] }] })
  assert.deepEqual(result.placements, [])
})

gate('importTiledMap refuses an object without a finite position with tiled-object', () => {
  const withObject = (obj) => ({ orientation: 'orthogonal', tilewidth: 8, layers: [{ type: 'objectgroup', name: 'o', objects: [obj] }] })
  expectRefusal(() => importTiledMap(withObject({ id: 1, y: 2 })), 'tiled-object')
  expectRefusal(() => importTiledMap(withObject({ id: 1, x: NaN, y: 2 })), 'tiled-object')
  expectRefusal(() => importTiledMap(withObject({ id: 1, x: '5', y: 2 })), 'tiled-object')
})

gate('importTiledMap refuses a non-finite object width, height or rotation with tiled-object', () => {
  const withObject = (fields) => ({ orientation: 'orthogonal', tilewidth: 8, layers: [{ type: 'objectgroup', name: 'o', objects: [{ id: 1, x: 0, y: 0, ...fields }] }] })
  expectRefusal(() => importTiledMap(withObject({ width: 'wide' })), 'tiled-object')
  expectRefusal(() => importTiledMap(withObject({ height: NaN })), 'tiled-object')
  expectRefusal(() => importTiledMap(withObject({ rotation: Infinity })), 'tiled-object')
})

gate('importTiledMap refuses an object entry that is not an object with tiled-shape', () => {
  const layers = [{ type: 'objectgroup', name: 'o', objects: [null] }]
  expectRefusal(() => importTiledMap({ orientation: 'orthogonal', tilewidth: 8, layers }), 'tiled-shape')
})

gate('importTiledMap refuses an object layer without an objects array with tiled-shape', () => {
  const layers = [{ type: 'objectgroup', name: 'o' }]
  expectRefusal(() => importTiledMap({ orientation: 'orthogonal', tilewidth: 8, layers }), 'tiled-shape')
})

gate('importTiledMap refuses a property without a name with tiled-property', () => {
  const withProps = (properties) => ({ orientation: 'orthogonal', tilewidth: 8, properties, layers: [] })
  expectRefusal(() => importTiledMap(withProps([{ value: 1 }])), 'tiled-property')
  expectRefusal(() => importTiledMap(withProps([null])), 'tiled-property')
})

gate('importTiledMap refuses a property named __proto__ instead of setting the prototype', () => {
  const withProps = (properties) => ({ orientation: 'orthogonal', tilewidth: 8, properties, layers: [] })
  expectRefusal(() => importTiledMap(withProps([{ name: '__proto__', value: { polluted: true } }])), 'tiled-property')
  assert.equal({}.polluted, undefined)
})

gate('importTiledMap refuses a repeated property name with tiled-property', () => {
  const withProps = (properties) => ({ orientation: 'orthogonal', tilewidth: 8, properties, layers: [] })
  expectRefusal(() => importTiledMap(withProps([{ name: 'a', value: 1 }, { name: 'a', value: 2 }])), 'tiled-property')
})

gate('importTiledMap accepts a property named constructor as an ordinary key', () => {
  const result = importTiledMap({ orientation: 'orthogonal', tilewidth: 8, properties: [{ name: 'constructor', value: 'x' }], layers: [] })
  assert.equal(result.properties.constructor, 'x')
  assert.deepEqual(Object.keys(result.properties), ['constructor'])
})

gate('importTiledMap refuses properties that are present but not an array with tiled-shape', () => {
  expectRefusal(() => importTiledMap({ orientation: 'orthogonal', tilewidth: 8, properties: {}, layers: [] }), 'tiled-shape')
})

gate('control: a hidden layer with broken data is skipped, not read', () => {
  const layers = [{ type: 'tilelayer', name: 'h', visible: false, width: 0, data: 'bad' }]
  assert.deepEqual(importTiledMap({ orientation: 'orthogonal', tilewidth: 8, layers }).placements, [])
})

gate('control: a valid map with the same layer shapes is not refused', () => {
  assert.doesNotThrow(() => importTiledMap(tiledMap()))
})

gate('importTiledMap refusal carries its reasonCode and TiledImport prefix', () => {
  const error = refusalOf(() => importTiledMap({ ...tiledMap(), tilewidth: 0 }))
  assert.equal(error.reasonCode, 'tiled-tilesize')
  assert.equal(error.message, 'TiledImport: tilewidth must be a positive integer')
})

finish()
