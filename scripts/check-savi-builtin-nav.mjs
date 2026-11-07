import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createNav, NAV_NAMES } from '../src/savi-builtins/nav.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-nav.md')
const sourcePath = join(root, 'src', 'savi-builtins', 'nav.js')

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

const inside = (x, z) => Math.abs(x) <= 40 && Math.abs(z) <= 40
const flat = { heightAt: (x, z) => (inside(x, z) ? 0 : null) }
const body = { radius: 1, step: 0.5, slope: 45 }

gate('the name and the documented result sentences are the ones savi gives for nav', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('findPath returns feet positions.'), true, 'feet sentence')
  same(section.includes('ok: false means a cut-off path that ends at the reachable spot nearest the goal.'), true, 'cut-off sentence')
  same(section.includes('partial: true means the search is still reading the ground: ask again on a later tick.'), true, 'partial sentence')
  same(section.includes('An empty list with no partial means no path was found.'), true, 'empty sentence')
  same(section.includes('maxDrop is 3 meters and bodies is all.'), true, 'defaults sentence')
  same(section.includes('findPath(ctx, from: Vec3, to: Vec3, opts?: { radius?, height?, step?, slope?, maxDrop?, bodies?: \'all\' | \'static\', ignore?: string[], budget? }): { points: Vec3[], ok: boolean, partial?: true }'), true, 'signature')
  sameJson(NAV_NAMES, ['findPath'], 'exported names')
})

gate('a straight flat walk gives the cells from start to goal, one metre apart, with ok true and no partial key', () => {
  const nav = createNav({ ground: flat, body })
  const r = nav.findPath([0, 0, 0], [4, 0, 0])
  same(r.ok, true, 'ok')
  same('partial' in r, false, 'partial key absent')
  sameJson(r.points, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]], 'points')
})

gate('a wall of unwalkable ground is walked around, and no returned point stands inside the wall', () => {
  const ground = { heightAt: (x, z) => (!inside(x, z) || (Math.round(x) === 2 && Math.abs(Math.round(z)) <= 3) ? null : 0) }
  const nav = createNav({ ground, body })
  const r = nav.findPath([0, 0, 0], [4, 0, 0])
  same(r.ok, true, 'ok around the wall')
  same(r.points.length > 5, true, 'a detour is longer than the straight walk')
  same(r.points.some((p) => p[0] === 2 && Math.abs(p[2]) <= 3), false, 'no point inside the wall')
  same(r.points[r.points.length - 1][0] === 4 && r.points[r.points.length - 1][2] === 0, true, 'ends at the goal')
})

gate('a step higher than the body step is a cut-off; a step equal to it is walkable', () => {
  const ground = { heightAt: (x, z) => (!inside(x, z) ? null : x >= 2 ? 1 : 0) }
  const short = createNav({ ground, body }).findPath([0, 0, 0], [4, 0, 0])
  same(short.ok, false, 'a rise of 1 with step 0.5 is cut off')
  same(short.points[short.points.length - 1][0], 1, 'cut-off ends at the reachable spot nearest the goal')
  const tall = createNav({ ground, body: { radius: 1, step: 1, slope: 45 } }).findPath([0, 0, 0], [4, 0, 0])
  same(tall.ok, true, 'a rise of 1 with step 1 is walkable')
})

gate('a drop deeper than maxDrop is refused, and the default maxDrop is 3 metres', () => {
  const ground = { heightAt: (x, z) => (!inside(x, z) ? null : x >= 2 ? -4 : 0) }
  const steep = { radius: 1, step: 0.5, slope: 89 }
  same(createNav({ ground, body: steep }).findPath([0, 0, 0], [4, 0, 0]).ok, false, 'a drop of 4 with the default 3 is refused')
  same(createNav({ ground, body: steep }).findPath([0, 0, 0], [4, 0, 0], { maxDrop: 5 }).ok, true, 'a drop of 4 with maxDrop 5 is taken')
  same(createNav({ ground, body }).findPath([0, 0, 0], [4, 0, 0], { maxDrop: 5 }).ok, false, 'a 4 m drop on a 1 m run is still refused by the slope limit')
})

gate('the slope limit is the rise over run tangent in degrees; a steeper ramp is refused', () => {
  const ground = { heightAt: (x, z) => (inside(x, z) ? 0.9 * x : null) }
  same(createNav({ ground, body: { radius: 1, step: 1, slope: 30 } }).findPath([0, 0, 0], [4, 0, 0]).ok, false, 'a 42 degree ramp is refused at a 30 degree limit')
  same(createNav({ ground, body: { radius: 1, step: 1, slope: 60 } }).findPath([0, 0, 0], [4, 0, 0]).ok, true, 'the same ramp is walkable at a 60 degree limit')
})

gate('a goal across a full wall is a cut-off that ends at the reachable spot nearest the goal', () => {
  const ground = { heightAt: (x, z) => (!inside(x, z) || Math.round(x) === 2 ? null : 0) }
  const r = createNav({ ground, body }).findPath([0, 0, 0], [4, 0, 0])
  same(r.ok, false, 'cut off')
  same('partial' in r, false, 'no partial on a finished search')
  same(r.points[r.points.length - 1][0], 1, 'nearest reachable point to the goal is x 1')
})

gate('an unwalkable start gives an empty list with no partial: no path was found', () => {
  const ground = { heightAt: (x, z) => (!inside(x, z) || (x === 0 && z === 0) ? null : 0) }
  const r = createNav({ ground, body }).findPath([0, 0, 0], [4, 0, 0])
  sameJson(r, { points: [], ok: false }, 'no path')
})

gate('a search with a budget reports partial, keeps its place, and finishes on a later call', () => {
  const nav = createNav({ ground: flat, body })
  let calls = 0
  let r = nav.findPath([0, 0, 0], [30, 0, 0], { budget: 3 })
  calls++
  same(r.partial, true, 'first call is partial')
  same(r.ok, false, 'partial is not ok yet')
  while (r.partial && calls < 100) {
    r = nav.findPath([0, 0, 0], [30, 0, 0], { budget: 3 })
    calls++
  }
  same(r.partial === undefined, true, 'finished without partial')
  same(r.ok, true, 'finished ok')
  same(calls > 2, true, 'it took more than one call')
  same(r.points.length, 31, 'straight walk of 31 cells')
  same(r.points[30][0], 30, 'ends at the goal')
})

gate('scoped negatives: static bodies, ignore lists, a height, and other unknown options are refused, because the ground model has no body list, no object ids and no ceilings', () => {
  const nav = createNav({ ground: flat, body })
  mustThrow(() => nav.findPath([0, 0, 0], [4, 0, 0], { bodies: 'static' }))
  mustThrow(() => nav.findPath([0, 0, 0], [4, 0, 0], { ignore: ['crate-1'] }))
  mustThrow(() => nav.findPath([0, 0, 0], [4, 0, 0], { height: 1.8 }))
  mustThrow(() => nav.findPath([0, 0, 0], [4, 0, 0], { anything: true }))
})

gate('negative controls: bad budgets, bad options, bad points and bad bodies are refused', () => {
  const nav = createNav({ ground: flat, body })
  mustThrow(() => nav.findPath([0, 0, 0], [4, 0, 0], { budget: 0 }))
  mustThrow(() => nav.findPath([0, 0, 0], [4, 0, 0], { budget: 1.5 }))
  mustThrow(() => nav.findPath([0, 0, 0], [4, 0, 0], { radius: 0 }))
  mustThrow(() => nav.findPath([0, 0, 0], [4, 0, 0], { slope: 90 }))
  mustThrow(() => nav.findPath([Number.NaN, 0, 0], [4, 0, 0]))
  mustThrow(() => createNav({ ground: {}, body }))
  mustThrow(() => createNav({ ground: flat, body: { radius: 0, step: 0.5, slope: 45 } }))
  mustThrow(() => createNav({ ground: flat, body: { radius: 1, step: 0.5, slope: 90 } }))
  mustThrow(() => createNav({ ground: flat }))
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (source.includes('Math.random')) found.push('uses Math.random')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of hostGlobals) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-builtins/nav.js is comment-free, imports nothing bare, reads no host global', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn('const t = performance.now() // x').length > 0, true, 'negative sample is caught')
})

finish()
