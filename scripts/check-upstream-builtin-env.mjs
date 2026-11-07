import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { envAt, ENV_NAMES, ENV_RETURN_FIELDS } from '../src/upstream-builtins/env.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-env.md')
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

const ctx = { self: { id: 'player' } }

gate('the upstream section gives envAt\'s signature, and the engine reference names the same return fields', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('envAt(ctx, point: Vec3 | [x, y, z]): { wind: EnvFlow, rain: number, light: number, charge: number, water: { depth: number, flow: EnvFlow }, cloud: number }'), true, 'signature')
  const engine = readFileSync(enginePath, 'utf8')
  same(engine.includes('`envAt(ctx, point)` returns `{ wind, rain, light, charge, water: { depth, flow }, cloud }`.'), true, 'engine return fields')
  sameJson(ENV_NAMES, ['envAt'], 'exported names')
  sameJson(ENV_RETURN_FIELDS, ['wind', 'rain', 'light', 'charge', 'water', 'cloud'], 'named return fields')
})

gate('grep witness: EnvFlow is named in upstream but never defined, so no shape for wind or water flow is documented', () => {
  const hits = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(md|json)$/.test(entry.name)) {
        const text = readFileSync(path, 'utf8')
        if (text.includes('EnvFlow')) hits.push(path.slice(root.length + 1))
      }
    }
  }
  walk(fixturesDir)
  same(hits.length > 0, true, 'EnvFlow is named somewhere')
  for (const path of hits) {
    const text = readFileSync(join(root, path), 'utf8')
    same(/EnvFlow\s*=|type\s+EnvFlow|interface\s+EnvFlow/.test(text), false, 'no definition of EnvFlow in ' + path)
  }
})

gate('scoped negative: envAt is refused for every valid point, because upstream names the return shape and no source for its values', () => {
  mustThrow(() => envAt(ctx, [0, 0, 0]))
  mustThrow(() => envAt(ctx, { x: 4, y: 1, z: -2 }))
})

gate('envAt refuses a missing ctx, a bad point, and a non-finite component before any scoped reason is given', () => {
  mustThrow(() => envAt(null, [0, 0, 0]))
  mustThrow(() => envAt(ctx, [0, 0]))
  mustThrow(() => envAt(ctx, [0, Number.NaN, 0]))
  mustThrow(() => envAt(ctx, { x: 1, z: 2 }))
})

finish()
