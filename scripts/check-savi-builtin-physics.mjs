import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  normaliseRaycast, normaliseTraverse, raycast, traverseCheck, createWorld, overlapPoint, overlapSegment, jumpCheck, getInputRay,
  PHYSICS_NAMES, PHYSICS_OPTION_DEFAULTS,
} from '../src/savi-builtins/physics.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-physics.md')
const fixturesDir = join(root, 'scripts', 'fixtures', 'savi')
const sourcePath = join(root, 'src', 'savi-builtins', 'physics.js')

const ctx = { self: { id: 'player' } }

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}

gate('the savi section gives the stated defaults and the signatures this module carries', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('raycast defaults to 200 meters and ignores the caller.'), true, 'raycast default sentence')
  same(section.includes('physicsOnly: true selects colliders only.'), true, 'physicsOnly sentence')
  same(section.includes('its default step height is 0.3 meters.'), true, 'step height sentence')
  same(section.includes('createWorld(opts) takes no ctx.'), true, 'createWorld sentence')
  same(section.includes('raycast(ctx, origin: Vec3, direction: Vec3, opts?: number | {'), true, 'raycast signature')
  same(section.includes('traverseCheck(ctx, from: Vec3, to: Vec3, opts?: TraverseCheckOptions): TraverseCheckResult'), true, 'traverseCheck signature')
  sameJson(PHYSICS_NAMES, ['raycast', 'overlapPoint', 'overlapSegment', 'traverseCheck', 'jumpCheck', 'getInputRay', 'createWorld'], 'exported names')
  sameJson(PHYSICS_OPTION_DEFAULTS, { raycastDistance: 200, traverseStepHeight: 0.3 }, 'stated defaults')
})

gate('a bare number is refused as raycast options, because it cannot carry bodies, which savi does not default', () => {
  mustThrow(() => normaliseRaycast(5))
})

gate('raycast options: bodies is required, distance defaults to 200 metres, and physicsOnly selects colliders', () => {
  const plain = normaliseRaycast({ bodies: 'all' })
  same(plain.distance, 200, 'default distance')
  same(plain.physicsOnly, false, 'physicsOnly default')
  same(normaliseRaycast({ bodies: 'static', physicsOnly: true, distance: 12 }).physicsOnly, true, 'physicsOnly true')
  same(normaliseRaycast({ bodies: 'dynamic', distance: 12, radius: 0.5, multiple: true }).radius, 0.5, 'radius in metres')
  mustThrow(() => normaliseRaycast(5))
  mustThrow(() => normaliseRaycast({ distance: 5 }))
})

gate('traverseCheck options: the default step height is 0.3 metres, and the key name is a scoped reading', () => {
  sameJson(normaliseTraverse(), { stepHeight: 0.3 }, 'default step height')
  sameJson(normaliseTraverse({ stepHeight: 0.5 }), { stepHeight: 0.5 }, 'given step height')
})

gate('the argument checks run before the scoped refusal', () => {
  mustThrow(() => raycast(ctx, [0, 0, 0], [0, 0, 1], { bodies: 'all' }))
  mustThrow(() => traverseCheck(ctx, [0, 0], [1, 0, 0]))
  mustThrow(() => raycast(null, [0, 0, 0], [0, 0, 1], { bodies: 'all' }))
  mustThrow(() => raycast(ctx, [0, Number.NaN, 0], [0, 0, 1], { bodies: 'all' }))
})

gate('scoped negatives: createWorld, overlap queries, jumpCheck and getInputRay are refused, because savi names them only', () => {
  mustThrow(() => createWorld())
  mustThrow(() => overlapPoint(ctx, [0, 0, 0]))
  mustThrow(() => overlapSegment(ctx, [0, 0, 0], [1, 0, 0]))
  mustThrow(() => jumpCheck(ctx, [0, 0, 0], [1, 0, 0], { speed: 1, jumpSpeed: 1 }))
  mustThrow(() => getInputRay(ctx))
})

gate('scoped negatives: unlisted raycast and traverse options, a bad bodies value, and bad distances are refused by name', () => {
  mustThrow(() => normaliseRaycast({ bodies: 'all', tags: ['x'] }))
  mustThrow(() => normaliseRaycast({ bodies: 'all', verdict: true }))
  mustThrow(() => normaliseRaycast({ bodies: 'floor' }))
  mustThrow(() => normaliseRaycast({ bodies: 'all', distance: 0 }))
  mustThrow(() => normaliseRaycast({ bodies: 'all', distance: Number.NaN }))
  mustThrow(() => normaliseRaycast({ bodies: 'all', physicsOnly: 'yes' }))
  mustThrow(() => normaliseTraverse({ stepHeight: -0.1 }))
  mustThrow(() => normaliseTraverse({ climb: 0.4 }))
})

gate('grep witness: createWorld is named in the savi fixtures, and no fixture defines it', () => {
  const hits = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(md|json)$/.test(entry.name)) {
        const text = readFileSync(path, 'utf8')
        if (text.includes('createWorld')) hits.push(path.slice(root.length + 1))
      }
    }
  }
  walk(fixturesDir)
  assert(hits.includes('scripts/fixtures/savi/tome/sections/builtin-physics.md'), 'the section names createWorld')
  assert(hits.length >= 1, 'createWorld is named somewhere in the fixtures')
  for (const path of hits) assert(!/createWorld\s*\([^)]*\)\s*\{/.test(readFileSync(join(root, path), 'utf8')), 'no definition of createWorld in ' + path)
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

gate('src/savi-builtins/physics.js is comment-free, imports nothing bare, reads no host global', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn('const t = performance.now() // x').length > 0, true, 'negative sample is caught')
})

finish()
