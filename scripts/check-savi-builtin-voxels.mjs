import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { part, material, checker, random, noise, SHAPE_BUILDER_NAMES } from '../src/savi-builtins/voxels.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-voxels.md')
const sourcePath = join(root, 'src', 'savi-builtins', 'voxels.js')
const section = readFileSync(sectionPath, 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustThrow = (check, fragment) => {
  let message = null
  try {
    check()
  } catch (error) {
    message = error.message
  }
  assert(message !== null, 'negative control was accepted')
  assert(message.includes(fragment), 'refused for the wrong reason: ' + message)
}

gate('the savi section names the part, the shape builders, the bounds and serialize shapes, and the four brushes', () => {
  same(section.includes('part(): VoxelPart'), true, 'part signature')
  same(section.includes('VoxelPart.set({ x, y, z, material }): VoxelPart'), true, 'set signature')
  same(section.includes('VoxelPart.bounds(): [[x, y, z], [x, y, z]] | null'), true, 'bounds signature')
  same(section.includes('VoxelPart.serialize(): { version: 1, bounds, palette: string[], voxels: [x, y, z, paletteIndex][] }'), true, 'serialize signature')
  same(section.includes('material(id: string): Brush'), true, 'material signature')
  same(section.includes('noise(ids: string[], opts?: { scale?: number, seed?: number | string, weights?: number[] }): Brush'), true, 'noise signature')
})

gate('every shape builder the section names is refused by name after its material is checked', () => {
  sameJson(SHAPE_BUILDER_NAMES, ['fill', 'hollowBox', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus', 'line'], 'shape builders')
  for (const name of SHAPE_BUILDER_NAMES) {
    same(section.includes(name + '('), true, name + ' in the section')
    mustThrow(() => part()[name]({ material: material('stone') }), name + ' has no documented headless behaviour')
    mustThrow(() => part()[name]({ material: 'stone' }), 'material is a Brush')
  }
})

gate('set places one voxel at integer coordinates and returns the same part; bounds are the inclusive corners, null when empty', () => {
  const p = part()
  same(p.bounds(), null, 'empty bounds')
  same(p.set({ x: 0, y: 0, z: 0, material: material('stone') }), p, 'chaining returns the part')
  p.set({ x: 2, y: 1, z: 3, material: material('wood') })
  sameJson(p.bounds(), [[0, 0, 0], [2, 1, 3]], 'inclusive corners')
})

gate('serialize is version 1, sorted by position with a sorted palette, so insertion order does not change the bytes', () => {
  const first = part()
  first.set({ x: 1, y: 0, z: 0, material: material('wood') }).set({ x: 0, y: 0, z: 0, material: material('stone') })
  const second = part()
  second.set({ x: 0, y: 0, z: 0, material: material('stone') }).set({ x: 1, y: 0, z: 0, material: material('wood') })
  sameJson(first.serialize(), { version: 1, bounds: [[0, 0, 0], [1, 0, 0]], palette: ['stone', 'wood'], voxels: [[0, 0, 0, 0], [1, 0, 0, 1]] }, 'serialized form')
  sameJson(first.serialize(), second.serialize(), 'insertion order')
})

gate('a later set on the same cell replaces the earlier material', () => {
  const p = part()
  p.set({ x: 0, y: 0, z: 0, material: material('stone') })
  p.set({ x: 0, y: 0, z: 0, material: material('wood') })
  sameJson(p.serialize().voxels, [[0, 0, 0, 0]], 'one voxel')
  sameJson(p.serialize().palette, ['wood'], 'palette after replace')
})

gate('add merges a part or a serialized part, offset by at, and round-trips through serialize', () => {
  const source = part()
  source.set({ x: 0, y: 0, z: 0, material: material('stone') })
  const target = part()
  target.add(source, { at: [5, 0, 0] })
  sameJson(target.serialize().voxels, [[5, 0, 0, 0]], 'offset merge from a part')
  const copy = part()
  copy.add(target.serialize())
  sameJson(copy.serialize(), target.serialize(), 'round trip')
  sameJson(part().add(target).serialize().bounds, [[5, 0, 0], [5, 0, 0]], 'merge with no at')
  mustThrow(() => part().add(target, { at: [1.5, 0, 0] }), 'at component 0 is a whole number')
  mustThrow(() => part().add(target, { at: [0, 0] }), 'at is [x, y, z]')
})

gate('a serialized part is checked: version, palette index, duplicates, bounds and unknown keys are refused', () => {
  const good = { version: 1, bounds: [[0, 0, 0], [0, 0, 0]], palette: ['stone'], voxels: [[0, 0, 0, 0]] }
  part().add(good)
  mustThrow(() => part().add({ ...good, version: 2 }), 'serialized version is 1')
  mustThrow(() => part().add({ ...good, voxels: [[0, 0, 0, 1]] }), 'palette index 1 is not in the palette')
  mustThrow(() => part().add({ ...good, voxels: [[0, 0, 0, 0], [0, 0, 0, 0]] }), 'duplicate voxel at 0,0,0')
  mustThrow(() => part().add({ ...good, bounds: [[0, 0, 0], [1, 0, 0]] }), 'bounds do not match the voxels')
  mustThrow(() => part().add({ ...good, bounds: undefined }), 'bounds is required')
  mustThrow(() => part().add({ ...good, extra: 1 }), 'serialized part option extra')
})

gate('coordinates are whole numbers; an offset that leaves the safe integer range is refused', () => {
  mustThrow(() => part().set({ x: 1.5, y: 0, z: 0, material: material('stone') }), 'x is a whole number')
  mustThrow(() => part().set({ x: Number.NaN, y: 0, z: 0, material: material('stone') }), 'x is a whole number')
  const source = part()
  source.set({ x: 1, y: 0, z: 0, material: material('stone') })
  mustThrow(() => part().add(source, { at: [Number.MAX_SAFE_INTEGER, 0, 0] }), 'moved coordinate is a whole number')
})

gate('brushes validate their names, ids, weights and noise options; only a material brush can paint a voxel', () => {
  sameJson(material('stone'), { kind: 'material', id: 'stone' }, 'material brush')
  sameJson(random(['a', 'b'], [1, 3]).weights, [1, 3], 'random weights')
  sameJson(noise(['a'], { scale: 2, seed: 'mine' }).seed, 'mine', 'noise seed')
  mustThrow(() => material(''), 'material id is a non-empty string')
  mustThrow(() => checker('a'), 'material id is a non-empty string')
  mustThrow(() => random([]), 'ids is a non-empty list')
  mustThrow(() => random(['a', 'b'], [1]), 'weights are one number per id')
  mustThrow(() => random(['a', 'b'], [1, -1]), 'weights are zero or more numbers')
  mustThrow(() => random(['a', 'b'], [0, 0]), 'weights sum to more than zero')
  mustThrow(() => noise(['a'], { scale: 0 }), 'scale is a positive finite number')
  mustThrow(() => noise(['a'], { seed: 1.5 }), 'seed is a whole number or a non-empty string')
  mustThrow(() => noise(['a'], { frequency: 2 }), 'noise option frequency')
  mustThrow(() => part().set({ x: 0, y: 0, z: 0, material: checker('a', 'b') }), 'checker brush has no documented headless behaviour')
  mustThrow(() => part().set({ x: 0, y: 0, z: 0, material: random(['a']) }), 'random brush has no documented headless behaviour')
  mustThrow(() => part().set({ x: 0, y: 0, z: 0, material: noise(['a']) }), 'noise brush has no documented headless behaviour')
  mustThrow(() => part().set({ x: 0, y: 0, z: 0, material: 'stone' }), 'material is a Brush')
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

const withoutStrings = (source) => source.replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, "''")

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (source.includes('Math.random')) found.push('uses Math.random')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(withoutStrings(source).split(/[^A-Za-z0-9_$]/))
  for (const token of hostGlobals) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-builtins/voxels.js is comment-free, imports nothing bare, reads no host global', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn('const t = performance.now() // x').length > 0, true, 'negative sample is caught')
})

finish()
