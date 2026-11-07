import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseTomeIndex } from '../src/savi-tome/tomeIndex.js'
import { bindSections } from '../src/savi-tome/tomeSections.js'
import { bindBuiltinBodies, builtinBody } from '../src/savi-builtins/builtinBodies.js'
import { builtinNamesFromEngine, builtinNamesFromTome, compareNameSets } from '../src/savi-builtins/builtinModules.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tomeDir = join(root, 'scripts', 'fixtures', 'savi', 'tome')
const engineDoc = join(root, 'scripts', 'fixtures', 'savi', 'engine-deep', 'api-b.md')
const sourceDir = join(root, 'src', 'savi-builtins')
const PINNED = {
  'sections/builtin-ballistics.md': '7b94f253d4abfbc7ca2a17bb4ca7b0087015b918f65ae028820b7d0cc38e5446',
  'sections/builtin-easing.md': '205ff8531a096e8edd48fd785f787b541522e843520910e642dd1040f403c043',
  'sections/builtin-env.md': 'afd98a8a0a4b7ba733bffe3e76cafa71a4a61f78ddc2d2bc8d063afb0412c7c5',
  'sections/builtin-fx.md': '9682578040965a82eb07d550ffe8f5ca29ceeabc39226380c4e4464c8d1ccb45',
  'sections/builtin-lighting.md': '9e9fabfdf2843eb83422cc09512ab5b27103b6cc9158c482747195f8a71920e3',
  'sections/builtin-math.md': '29ac2366d781d4df3d307a1054d1ab9aad4df7985d64ec35ffed5ff56c491a26',
  'sections/builtin-nav.md': 'f1bae42aee89b631dea8d8ed4ae1ad0beee206003ababb71c4a45cd103ea9189',
  'sections/builtin-noise.md': 'b805e4d75e37e3d16b136f3c3bde197aaf7dc9f83b2e46288edcde1725460881',
  'sections/builtin-path.md': 'cfaf052eebbc73845ee35eac2fadd91e5ff5b30b0328bfa487115b8e844fcc17',
  'sections/builtin-physics.md': '35d17a681716b8f5c9e7a9502a774e799da60d31f1e14d9c4f220a18dc47bdb5',
  'sections/builtin-postfx.md': 'adf53ac9e5562c6382da5877fed7e6fe336299d27c4b99e519bba9a065b2a1fb',
  'sections/builtin-room-routing.md': '14c576654fa692f0513401b1f65b079e9e39257505da212e1f4442c890e25fbc',
  'sections/builtin-spline.md': '6d988791db09df4d63330ec73ea9d208d8ea842c0bccdd021e324f92da60fd0f',
  'sections/builtin-terrain.md': 'de9d111d50f0d27851e31ad9b3a0de1071e83c2dec08c6d07cba2681eb2c2f91',
  'sections/builtin-three.md': '89e9807b7c62db58aa600fba7418e1fe8af9ae06947b659d8e656fe5f9ef1c23',
  'sections/builtin-tsl.md': '00a5868d3dd3744e803451dfbaf13d0ed1d1f8e0f52adbd997601718da69751d',
  'sections/builtin-tween.md': 'e4ec303ae85e37ac1cc5c3caeba80636a5fc6ed8441831bb30a8b8b057063e0f',
  'sections/builtin-vec3.md': 'daa72f473744fb43ceeb64b3bf40bb7e49ab7ddc542eb2abae25f4329cbc024f',
  'sections/builtin-vibe.md': '8202bf855c17f70d7fd6664484a8094a3bc7f64fd9c6ec1d5387b7e16184a8da',
  'sections/builtin-voxels.md': '7651d42de0cc54ace2cc7ffc1c5b02f496f7fcd9cf6d76d05a0271221dd66b59',
  'sections/builtin-water.md': '879e97f5cd51b5a8b0a41cd77f4fb070bf9e7a864a72aeb37b5f512a1de94623',
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}
const digestOf = (bytes) => createHash('sha256').update(bytes).digest('hex')

const rows = parseTomeIndex(readFileSync(join(tomeDir, 'INDEX.md'), 'utf8'))
const sections = bindSections(rows, (file) => {
  const path = join(tomeDir, file)
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null
})
const modules = bindBuiltinBodies(sections, digestOf, PINNED)
const engineNames = builtinNamesFromEngine(readFileSync(engineDoc, 'utf8'))

gate('the 21 builtin bodies bind, each to its pinned sha256, in index order', () => {
  same(modules.length, 21, 'builtin modules')
  sameJson(Object.keys(PINNED).length, 21, 'pinned digests')
  sameJson(modules.map((module) => module.file), rows.map((row) => row.file).filter((file) => file.startsWith('sections/builtin-')), 'order')
})

gate('the served module names are the 21 names the Tome index and the engine reference both give', () => {
  const served = modules.map((module) => module.name)
  sameJson(compareNameSets(served, builtinNamesFromTome(rows)), { onlyLeft: [], onlyRight: [], duplicatesLeft: 0, duplicatesRight: 0 }, 'served against Tome index')
  sameJson(compareNameSets(served, engineNames), { onlyLeft: [], onlyRight: [], duplicatesLeft: 0, duplicatesRight: 0 }, 'served against engine reference')
})

gate('each body is served as its strict UTF-8 text and the byte count the Tome index gives', () => {
  const easing = builtinBody(modules, 'easing')
  assert(easing.text.startsWith('## builtin/easing'), 'easing heading')
  assert(easing.text.includes('easeInOutCirc(t)'), 'easing body names its last easing function')
  same(easing.bytes, rows.find((row) => row.file === 'sections/builtin-easing.md').bytes, 'easing bytes')
  same(builtinBody(modules, 'no-such-module'), null, 'unknown module')
})

gate('a body whose digest is not pinned, a wrong pin, a duplicate module and invalid UTF-8 are each refused', () => {
  mustReject(() => bindBuiltinBodies(sections, digestOf, { ...PINNED, 'sections/builtin-easing.md': '0'.repeat(64) }))
  const { 'sections/builtin-easing.md': _, ...unpinned } = PINNED
  mustReject(() => bindBuiltinBodies(sections, digestOf, unpinned))
  const easing = sections.find((section) => section.file === 'sections/builtin-easing.md')
  mustReject(() => bindBuiltinBodies([...sections, easing], digestOf, PINNED))
  const bad = { file: 'sections/builtin-bad.md', bytes: new Uint8Array([0xff]) }
  mustReject(() => bindBuiltinBodies([bad], () => 'x', { 'sections/builtin-bad.md': 'x' }))
})

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer', 'URL']) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-builtins/builtinBodies.js is comment-free, imports nothing bare and reads no host global', () => {
  sameJson(findingsIn(readFileSync(join(sourceDir, 'builtinBodies.js'), 'utf8')), [], 'findings')
})

finish()
