import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as lighting from '../src/upstream-builtins/lighting.js'
import { LIGHTING_NAMES } from '../src/upstream-builtins/lighting.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-lighting.md')
const enginePath = join(root, 'scripts', 'fixtures', 'upstream', 'engine-deep', 'api-b.md')
const fixturesDir = join(root, 'scripts', 'fixtures', 'upstream')

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

gate('the upstream section names every lighting node and function this module carries, with its type', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('sunDirection: vec3; sunRadiance: vec3; ambientRadiance: vec3'), true, 'sun and ambient types')
  same(section.includes('wet: float; rain: float'), true, 'wet and rain types')
  same(section.includes('windDirection: vec2; windSpeed: float; windTravel: vec2'), true, 'wind types')
  same(section.includes('lightsAt(P, { shadow }?): vec3'), true, 'lightsAt signature')
  same(section.includes('lightCount(P): int; lightRadiance(P, i): vec3; lightPosition(P, i): vec3'), true, 'light count and radiance signatures')
  sameJson(LIGHTING_NAMES, ['sunDirection', 'sunRadiance', 'ambientRadiance', 'wet', 'rain', 'windDirection', 'windSpeed', 'windTravel', 'fogColor', 'sunVisibility', 'lightsAt', 'lightCount', 'lightRadiance', 'lightPosition'], 'exported names')
  const engine = readFileSync(enginePath, 'utf8')
  same(engine.includes('Read-only shader nodes:'), true, 'engine calls them read-only shader nodes')
})

gate('scoped negative: every lighting node and function is refused, because upstream gives names and types only', () => {
  for (const name of ['sunDirection', 'sunRadiance', 'ambientRadiance', 'wet', 'rain', 'windDirection', 'windSpeed', 'windTravel']) {
    mustThrow(() => lighting[name]())
  }
  mustThrow(() => lighting.fogColor([0, 0, 0]))
  mustThrow(() => lighting.sunVisibility({ x: 1, y: 2, z: 3 }))
  mustThrow(() => lighting.lightsAt([0, 0, 0], { shadow: true }))
  mustThrow(() => lighting.lightCount([0, 0, 0]))
  mustThrow(() => lighting.lightRadiance([0, 0, 0], 0))
  mustThrow(() => lighting.lightPosition([0, 0, 0], 1))
})

gate('the argument checks run before the scoped refusal: bad points, bad indices and bad options are refused', () => {
  mustThrow(() => lighting.sunVisibility([0, 0]))
  mustThrow(() => lighting.fogColor([0, Number.NaN, 0]))
  mustThrow(() => lighting.lightsAt([0, 0, 0], 'shadow'))
  mustThrow(() => lighting.lightRadiance([0, 0, 0], -1))
  mustThrow(() => lighting.lightPosition([0, 0, 0], 1.5))
})

gate('grep witness: the lighting names have no value or semantics anywhere in the upstream fixtures beyond the section and the engine line', () => {
  const hits = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(md|json)$/.test(entry.name)) {
        const text = readFileSync(path, 'utf8')
        if (text.includes('sunVisibility') || text.includes('lightsAt') || text.includes('sunRadiance')) hits.push(path.slice(root.length + 1))
      }
    }
  }
  walk(fixturesDir)
  sameJson(hits.sort(), ['scripts/fixtures/upstream/engine-deep/api-b.md', 'scripts/fixtures/upstream/tome/sections/builtin-lighting.md'].sort(), 'files that name the lighting functions')
})

finish()
