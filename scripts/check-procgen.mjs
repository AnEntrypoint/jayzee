import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { expandLSystem, interpretTurtle, generateLSystemTree, PRESETS } from '../src/procgen/lsystem.js'
import { mulberry32 } from '../src/procgen/rng.js'
import { createNoise2D, createFbm2D, generateHeightfield, createHeightSampler } from '../src/procgen/noiseTerrain.js'
import { paintTexture } from '../src/procgen/textureScript.js'
import { runWFC, runWFCWithRetries, rulesFromSockets } from '../src/procgen/wfc.js'
import { parseFxProgram, createFxSimulation, FxProgramError } from '../src/procgen/fxProgram.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(readFileSync(join(root, 'scripts/fixtures/procgen/spoint-procgen.json'), 'utf8'))
const plain = (value) => JSON.parse(JSON.stringify(value))
const sameAsSpoint = (actual, expected, label) => {
  assert.equal(JSON.stringify(plain(actual)), JSON.stringify(expected), label + ' differs from the spoint fixture')
}
const errorMessage = (fn) => {
  try {
    fn()
    return 'none'
  } catch (error) {
    return error.message
  }
}

const paint = (x, y, u, v, n) => [300 * u, 255 * v, 127.5 * (n(x * 0.5, y * 0.5) + 1), 255]

const HOST_GLOBALS = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer', 'fetch']

const scanSource = (name, source) => {
  const problems = []
  if (source.includes('//') || source.includes('/*')) problems.push(name + ' has a comment marker')
  if (source.includes('Math.random')) problems.push(name + ' reads Math.random')
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const host of HOST_GLOBALS) if (words.has(host)) problems.push(name + ' reads host global ' + host)
  for (const piece of source.split("from '").slice(1)) {
    if (!piece.slice(0, piece.indexOf("'")).startsWith('.')) problems.push(name + ' has a bare import')
  }
  return problems
}

gate('src/procgen modules carry no comments, no host globals and no bare imports', () => {
  const dir = join(root, 'src/procgen')
  const files = readdirSync(dir).filter((name) => name.endsWith('.js'))
  assert.ok(files.length >= 5, 'expected the procgen modules, found ' + files.length)
  const problems = files.flatMap((name) => scanSource(name, readFileSync(join(dir, name), 'utf8')))
  assert.deepEqual(problems, [])
})

gate('control: the scan flags a planted sample with a comment, a host global and a bare import', () => {
  const planted = "import x from 'node:fs'\nconst t = Date.now() // note"
  assert.deepEqual(scanSource('planted.js', planted), ['planted.js has a comment marker', 'planted.js reads host global Date', 'planted.js has a bare import'])
  assert.deepEqual(scanSource('clean.js', "import y from './rng.js'\nexport const z = 1"), [])
})

gate('mulberry32 draws stay in [0, 1) and one seed repeats its stream', () => {
  const a = mulberry32(1337)
  const b = mulberry32(1337)
  for (let i = 0; i < 10000; i++) {
    const x = a()
    assert.ok(x >= 0 && x < 1, 'draw ' + i + ' is ' + x)
    assert.equal(x, b())
  }
})

gate('LSystem: the koch and binary tree expansions have the hand-counted lengths [1,9,49] and [1,11,61,311]', () => {
  const koch = expandLSystem({ axiom: 'F', rules: { F: 'F+F-F-F+F' }, iterations: 2 })
  assert.deepEqual(koch.lengths, [1, 9, 49])
  const binary = expandLSystem({ axiom: 'F', rules: { F: 'F[+F]F[-F]F' }, iterations: 3 })
  assert.deepEqual(binary.lengths, [1, 11, 61, 311])
})

gate('LSystem turtle: F+F at 90 degrees turns the second segment to end at (-1, 1, 0)', () => {
  const { segments } = interpretTurtle('F+F', { angleDeg: 90 })
  assert.equal(segments.length, 2)
  assert.deepEqual(segments[0].start, { x: 0, y: 0, z: 0 })
  assert.deepEqual(segments[0].end, { x: 0, y: 1, z: 0 })
  assert.ok(Math.abs(segments[1].end.x + 1) < 1e-9 && Math.abs(segments[1].end.y - 1) < 1e-9 && Math.abs(segments[1].end.z) < 1e-9, 'end ' + JSON.stringify(segments[1].end))
})

gate('LSystem matches spoint for every expansion: symbols, lengths, depth, turtle end and segments', () => {
  const cases = {
    koch: { axiom: 'F', rules: { F: 'F+F-F-F+F' }, iterations: 2, seed: 1, angleDeg: 90 },
    binary: { axiom: 'F', rules: { F: 'F[+F]F[-F]F' }, iterations: 3, seed: 2, angleDeg: 25.7 },
    stochastic: { axiom: 'F', rules: { F: [{ successor: 'F[+F]F', weight: 1 }, { successor: 'F[-F]F', weight: 1 }, { successor: 'F[+F][-F]F', weight: 2 }] }, iterations: 4, seed: 7, angleDeg: 22.5 },
    plant: { axiom: 'X', rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, iterations: 4, seed: 1337, angleDeg: 25 },
    stochasticSeed99: { axiom: 'F', rules: { F: [{ successor: 'F[+F]F', weight: 1 }, { successor: 'F[-F]F', weight: 1 }, { successor: 'F[+F][-F]F', weight: 2 }] }, iterations: 5, seed: 99, angleDeg: 22.5 },
  }
  for (const expected of fixture.lsystem) {
    const { axiom, rules, iterations, seed, angleDeg } = cases[expected.name]
    const tree = generateLSystemTree({ axiom, rules, iterations, seed, angleDeg })
    assert.equal(tree.symbolString, expected.result, expected.name + ' symbols')
    assert.deepEqual(tree.lengths, expected.lengths, expected.name + ' lengths')
    assert.equal(tree.maxDepth, expected.maxDepth, expected.name + ' maxDepth')
    sameAsSpoint(tree.turtleEnd, expected.turtleEnd, expected.name + ' turtleEnd')
    sameAsSpoint(tree.segments.map((s) => [s.start.x, s.start.y, s.start.z, s.end.x, s.end.y, s.end.z, s.radius, s.depth]), expected.segments, expected.name + ' segments')
  }
})

gate('LSystem presets match spoint PRESETS', () => {
  sameAsSpoint(Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, { axiom: p.axiom, rules: p.rules, angleDeg: p.angleDeg }])), fixture.lsystemPresets, 'PRESETS')
})

gate('control: a different seed changes the stochastic expansion', () => {
  const other = expandLSystem({ axiom: 'F', rules: { F: [{ successor: 'F[+F]F', weight: 1 }, { successor: 'F[-F]F', weight: 1 }, { successor: 'F[+F][-F]F', weight: 2 }] }, iterations: 5, seed: 100 })
  assert.notEqual(other.result, fixture.lsystem[4].result)
})

gate('LSystem refusals match spoint messages', () => {
  const actual = [
    errorMessage(() => expandLSystem({ axiom: '' })),
    errorMessage(() => expandLSystem({ axiom: 'F', iterations: -1 })),
    errorMessage(() => interpretTurtle('F[F')),
    errorMessage(() => interpretTurtle('F]')),
    errorMessage(() => interpretTurtle(5)),
    errorMessage(() => expandLSystem({ axiom: 'F', rules: { F: [{ successor: 'F', weight: 0 }] }, iterations: 1 })),
  ]
  assert.deepEqual(actual, fixture.lsystemErrors)
  assert.ok(actual.every((m) => m !== 'none'))
})

gate('noise: createNoise2D and createFbm2D match spoint at 169 lattice points for seeds 1 and 42', () => {
  for (const entry of fixture.noise) {
    const n = createNoise2D(entry.seed)
    const f = createFbm2D(entry.seed, { octaves: 3, lacunarity: 2, persistence: 0.5 })
    sameAsSpoint(entry.points.map(([x, y]) => n(x, y)), entry.values, 'noise seed ' + entry.seed)
    sameAsSpoint(entry.points.map(([x, y]) => f(x, y)), entry.fbm, 'fbm seed ' + entry.seed)
  }
})

gate('control: seeds 1 and 42 give different noise, so the fixture comparison is not vacuous', () => {
  assert.notDeepEqual(plain(fixture.noise[0].values), plain(fixture.noise[1].values))
})

gate('heightfield: the normalized none shape spans exactly -amplitude to amplitude', () => {
  const h = generateHeightfield({ width: 9, height: 7, seed: 5, frequency: 0.2, amplitude: 4 })
  assert.equal(Math.min(...h.heights), -4)
  assert.equal(Math.max(...h.heights), 4)
  assert.equal(h.min, -4)
  assert.equal(h.max, 4)
})

gate('heightfield matches spoint for none, ridge, island, unnormalized and default options', () => {
  const optionSets = {
    none: { width: 9, height: 7, seed: 5, frequency: 0.2, amplitude: 4 },
    ridge: { width: 9, height: 7, seed: 5, frequency: 0.2, amplitude: 4, shape: 'ridge' },
    island: { width: 9, height: 7, seed: 5, frequency: 0.2, amplitude: 4, shape: 'island', spacing: 2 },
    unnormalized: { width: 5, height: 4, seed: 3, frequency: 0.3, amplitude: 2, normalize: false, octaves: 3, persistence: 0.4, lacunarity: 2.5 },
    defaults: { width: 3, height: 2 },
  }
  for (const expected of fixture.heightfield) {
    const h = generateHeightfield(optionSets[expected.name])
    assert.equal(h.width, expected.width)
    assert.equal(h.height, expected.height)
    assert.equal(h.spacing, expected.spacing)
    assert.equal(h.seed, expected.seed)
    sameAsSpoint(Array.from(h.heights), expected.heights, 'heightfield ' + expected.name)
    sameAsSpoint({ min: h.min, max: h.max }, { min: expected.min, max: expected.max }, 'heightfield bounds ' + expected.name)
  }
})

gate('height sampler matches spoint for ridge samples', () => {
  const sampler = createHeightSampler({ seed: 11, frequency: 0.1, amplitude: 6, shape: 'ridge' })
  sameAsSpoint(fixture.sampler.points.map(([x, y]) => sampler(x, y)), fixture.sampler.values, 'ridge sampler')
})

gate('heightfield and sampler refusals match spoint messages', () => {
  const actual = [
    errorMessage(() => generateHeightfield({ width: 0 })),
    errorMessage(() => generateHeightfield({ height: 1.5 })),
    errorMessage(() => generateHeightfield({ shape: 'cone' })),
  ]
  assert.deepEqual(actual, fixture.heightfieldErrors)
  assert.equal(errorMessage(() => createHeightSampler({ shape: 'island' })), fixture.samplerError)
})

gate('paintTexture: the 6 by 4 pixel bytes match spoint', () => {
  const tex = paintTexture({ width: 6, height: 4, seed: 5, paint })
  assert.equal(tex.width, fixture.texture.width)
  assert.equal(tex.height, fixture.texture.height)
  sameAsSpoint(Array.from(tex.pixels), fixture.texture.pixels, 'texture pixels')
})

gate('paintTexture rounds channels as Uint8ClampedArray does: [200.4, 100.6, 0.5, 254.5] gives [200, 101, 0, 254]', () => {
  const tex = paintTexture({ width: 1, height: 1, seed: 0, paint: () => [200.4, 100.6, 0.5, 254.5] })
  assert.deepEqual(Array.from(tex.pixels), [200, 101, 0, 254])
  sameAsSpoint(Array.from(paintTexture({ width: 1, height: 1, seed: 0, paint: () => [200.4, 100.6, 0.5, 254.5] }).pixels), fixture.texture1, 'single pixel')
})

gate('paintTexture hands paint u = x/(width-1) and v = y/(height-1), and u = 0 on a single column', () => {
  const seen = []
  paintTexture({ width: 3, height: 2, paint: (x, y, u, v) => { seen.push([x, y, u, v]); return [0, 0, 0, 0] } })
  assert.deepEqual(seen.map((s) => s[2]), [0, 0.5, 1, 0, 0.5, 1])
  assert.deepEqual(seen.map((s) => s[3]), [0, 0, 0, 1, 1, 1])
  const column = []
  paintTexture({ width: 1, height: 2, paint: (x, y, u, v) => { column.push([u, v]); return [0, 0, 0, 0] } })
  assert.deepEqual(column, [[0, 0], [0, 1]])
})

gate('control: paintTexture refuses a pixel that is not four finite numbers', () => {
  assert.throws(() => paintTexture({ width: 2, height: 2, paint: () => [1, 2, 3] }), /3 values/)
  assert.throws(() => paintTexture({ width: 2, height: 2, paint: () => [1, NaN, 3, 4] }), /channel 1/)
})

gate('paintTexture refusals match spoint messages', () => {
  const actual = [
    errorMessage(() => paintTexture({ width: 0, height: 2, paint })),
    errorMessage(() => paintTexture({ width: 2, height: 2, seed: 1.5, paint })),
    errorMessage(() => paintTexture({ width: 2, height: 2 })),
    errorMessage(() => paintTexture({ width: 2, height: 2, paint: () => [1, 2, 3] })),
    errorMessage(() => paintTexture({ width: 2, height: 2, paint: () => [1, NaN, 3, 4] })),
  ]
  assert.deepEqual(actual, fixture.textureErrors)
})

const tiles = [
  { id: 'grass', weight: 3, sockets: { N: 'g', S: 'g', E: 'g', W: 'g' } },
  { id: 'roadNS', weight: 1, sockets: { N: 'r', S: 'r', E: 'g', W: 'g' } },
  { id: 'roadEW', weight: 1, sockets: { N: 'g', S: 'g', E: 'r', W: 'r' } },
  { id: 'cross', weight: 1, sockets: { N: 'r', S: 'r', E: 'r', W: 'r' } },
]
const socketsOk = (grid, width, height, byId) => {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = byId.get(grid[y * width + x]).sockets
      if (x + 1 < width && here.E !== byId.get(grid[y * width + x + 1]).sockets.W) return false
      if (y + 1 < height && here.S !== byId.get(grid[(y + 1) * width + x]).sockets.N) return false
    }
  }
  return true
}
const byIdMap = new Map(tiles.map((t) => [t.id, t]))

gate('WFC: the runs for seeds 1 to 6 match spoint, including steps and grids', () => {
  for (const expected of fixture.wfc) {
    const result = runWFC({ width: 6, height: 5, tiles, seed: expected.seed })
    sameAsSpoint(result, expected.result, 'wfc seed ' + expected.seed)
  }
})

gate('WFC: every successful grid satisfies the socket rules on every shared edge', () => {
  for (const expected of fixture.wfc) {
    assert.equal(expected.result.ok, true, 'seed ' + expected.seed + ' did not collapse')
    assert.ok(socketsOk(expected.result.grid, 6, 5, byIdMap), 'seed ' + expected.seed + ' grid breaks a socket')
  }
})

gate('control: a grid with a road running into grass fails the socket check', () => {
  assert.equal(socketsOk(['roadNS', 'roadEW'], 2, 1, byIdMap), false)
  assert.equal(socketsOk(['grass', 'grass'], 2, 1, byIdMap), true)
})

gate('WFC: retries, explicit rules, contradiction, impossible tiles and max-steps match spoint', () => {
  sameAsSpoint(runWFCWithRetries({ width: 6, height: 5, tiles, seed: 10 }), fixture.wfcRetries, 'retries')
  sameAsSpoint(runWFC({ width: 4, height: 3, tiles: [{ id: 'a' }, { id: 'b', weight: 2 }], rules: [
    { from: 'a', to: 'a', dir: 'E' }, { from: 'a', to: 'b', dir: 'S' }, { from: 'b', to: 'b', dir: 'E' }, { from: 'b', to: 'a', dir: 'N' },
  ], seed: 4 }), fixture.wfcRules[0].result, 'explicit rules')
  sameAsSpoint([1, 2, 3, 4].map((seed) => runWFC({ width: 2, height: 1, tiles: [{ id: 'a' }, { id: 'b' }], rules: [{ from: 'a', to: 'a', dir: 'E' }], seed })), fixture.wfcContradiction, 'contradiction')
  const impossible = [{ id: 'x', sockets: { N: 'p', S: 'q', E: 'p', W: 'p' } }, { id: 'y', sockets: { N: 'q', S: 'p', E: 'q', W: 'q' } }]
  sameAsSpoint(runWFC({ width: 3, height: 3, tiles: impossible, seed: 2, maxSteps: 50 }), fixture.wfcImpossible, 'impossible')
  sameAsSpoint(runWFC({ width: 6, height: 5, tiles, seed: 1, maxSteps: 2 }), fixture.wfcMaxSteps, 'max-steps')
})

gate('control: the contradiction fixture really contains a contradiction, and a seed that collapses', () => {
  assert.equal(fixture.wfcContradiction.filter((r) => r.ok === false && r.reason === 'contradiction').length, 3)
  assert.equal(fixture.wfcContradiction[3].ok, true)
})

gate('WFC: a near-tie weight case, where the entropy tiebreak magnitude decides the collapse, matches spoint', () => {
  sameAsSpoint(runWFC(fixture.wfcJitter.input), fixture.wfcJitter.result, 'wfc near-tie')
})

gate('rulesFromSockets matches the sockets-only run on the tiles', () => {
  const rules = rulesFromSockets(tiles)
  sameAsSpoint(runWFC({ width: 6, height: 5, tiles, rules, seed: 3 }), fixture.wfc[2].result, 'rules from sockets')
})

gate('WFC refusals match spoint messages, and an unknown direction is named', () => {
  const actual = [
    errorMessage(() => runWFC({ width: 0, height: 2, tiles })),
    errorMessage(() => runWFC({ width: 2, height: 2, tiles: [] })),
    errorMessage(() => runWFC({ width: 2, height: 2, tiles: [{ id: 'a', weight: 0, sockets: { N: 'a', S: 'a', E: 'a', W: 'a' } }] })),
    errorMessage(() => runWFC({ width: 2, height: 2, tiles: [{ id: 'a' }, { id: 'a' }], rules: [] })),
    errorMessage(() => runWFC({ width: 2, height: 2, tiles: [{ id: 'a' }] })),
    errorMessage(() => runWFC({ width: 2, height: 2, tiles: [{ id: 'a' }], rules: [{ from: 'a', to: 'zz', dir: 'N' }] })),
  ]
  assert.deepEqual(actual, fixture.wfcErrors)
  assert.match(errorMessage(() => runWFC({ width: 2, height: 2, tiles: [{ id: 'a' }], rules: [{ from: 'a', to: 'a', dir: 'Q' }] })), /unknown direction: Q/)
})

const program = {
  seed: 99,
  populations: [
    { name: 'sparks', spawn: { rate: 40, burst: 3 }, lifetime: [0.2, 0.6], velocity: { speed: [1, 3], coneDeg: 30 }, accelerate: { gravity: [0, -9.8, 0], drag: 0.5 }, render: { kind: 'sprite', blend: 'add' }, maxParticles: 50 },
    { name: 'smoke', spawn: { rate: 8 }, lifetime: [1, 2], velocity: { speed: [0.2, 0.5], coneDeg: 10 }, accelerate: { gravity: [0, 0.3, 0] }, render: { kind: 'mesh' } },
  ],
}
const bad = (mutate) => {
  const d = JSON.parse(JSON.stringify(program))
  mutate(d)
  return d
}

gate('fxProgram: the parsed program matches spoint', () => {
  sameAsSpoint(parseFxProgram(program), fixture.fxProgram.parsed, 'parsed program')
})

gate('fxProgram: the simulation snapshots at steps 1, 5, 10 ... 40 match spoint', () => {
  const sim = createFxSimulation(parseFxProgram(program))
  const snapshots = []
  for (let s = 1; s <= 40; s++) {
    const snap = sim.step(0.05)
    if (s === 1 || s % 5 === 0) snapshots.push({ step: s, snapshot: snap })
  }
  sameAsSpoint(snapshots, fixture.fxProgram.steps, 'simulation')
})

gate('fxProgram: step 1 emits the burst of 3 plus floor(40 x 0.05) = 2 sparks and floor(8 x 0.05) = 0 smoke', () => {
  const sim = createFxSimulation(parseFxProgram(program))
  const first = sim.step(0.05)
  assert.equal(first.sparks.alive, 5)
  assert.equal(first.smoke.alive, 0)
})

gate('fxProgram: a bounded population never holds more than maxParticles', () => {
  const sim = createFxSimulation(parseFxProgram(program))
  for (let s = 0; s < 40; s++) {
    assert.ok(sim.step(0.05).sparks.alive <= 50, 'step ' + (s + 1))
  }
})

gate('fxProgram: the simulation is deterministic, and a changed seed changes it (control)', () => {
  const a = createFxSimulation(parseFxProgram(program))
  const b = createFxSimulation(parseFxProgram(program))
  let last = null
  for (let s = 0; s < 10; s++) {
    last = a.step(0.05)
    assert.deepEqual(plain(last), plain(b.step(0.05)))
  }
  const other = createFxSimulation(parseFxProgram({ ...program, seed: 98 }))
  let otherLast = null
  for (let s = 0; s < 10; s++) otherLast = other.step(0.05)
  assert.notDeepEqual(plain(last), plain(otherLast))
})

gate('fxProgram refusals match spoint reason codes', () => {
  const reasonOf = (fn) => {
    try {
      fn()
      return 'none'
    } catch (error) {
      return error.reasonCode ?? error.message
    }
  }
  const cases = [
    () => parseFxProgram({ populations: [] }),
    () => parseFxProgram({ populations: [{ name: 'a' }] }),
    () => parseFxProgram(bad((d) => { d.seed = -1 })),
    () => parseFxProgram(bad((d) => { d.populations[0].render.blend = 'xor' })),
    () => parseFxProgram(bad((d) => { d.populations[1].name = 'sparks' })),
    () => parseFxProgram(bad((d) => { d.populations[0].maxParticles = 0 })),
    () => parseFxProgram(bad((d) => { d.populations[0].spawn.burst = 1.5 })),
    () => parseFxProgram(bad((d) => { d.populations[0].lifetime = [1, 0.5] })),
    () => parseFxProgram(bad((d) => { d.populations[0].render.kind = 'ribbon' })),
    () => parseFxProgram(bad((d) => { d.populations[0].velocity = { speed: [3, 1] } })),
    () => parseFxProgram('{not json'),
    () => createFxSimulation(parseFxProgram(program)).step(1.5),
  ]
  assert.deepEqual(cases.map(reasonOf), fixture.fxErrors)
})

gate('fxProgram caps are inclusive: each bound is accepted at its value and refused just above, as spoint reads them', () => {
  const single = (fields) => ({ populations: [{ name: 'a', spawn: { rate: 1 }, render: { kind: 'sprite' }, ...fields }] })
  const reasonOf = (doc) => {
    try {
      parseFxProgram(doc)
      return 'accepted'
    } catch (error) {
      return error.reasonCode
    }
  }
  const rate = (value) => ({ populations: [{ name: 'a', spawn: { rate: value }, render: { kind: 'sprite' } }] })
  const burst = (value) => ({ populations: [{ name: 'a', spawn: { rate: 1, burst: value }, render: { kind: 'sprite' } }] })
  const actual = [
    reasonOf(single({ velocity: { coneDeg: 180 } })),
    reasonOf(single({ velocity: { coneDeg: 180.5 } })),
    reasonOf(single({ velocity: { speed: [0, 1000] } })),
    reasonOf(single({ velocity: { speed: [0, 1000.5] } })),
    reasonOf(single({ maxParticles: 1 })),
    reasonOf(single({ maxParticles: 0 })),
    reasonOf(single({ maxParticles: 100000 })),
    reasonOf(single({ maxParticles: 100001 })),
    reasonOf(rate(10000)),
    reasonOf(rate(10000.5)),
    reasonOf(burst(100000)),
    reasonOf(burst(100001)),
    reasonOf(single({ lifetime: [600, 600] })),
    reasonOf(single({ lifetime: [600.5, 600.5] })),
    reasonOf(single({ accelerate: { drag: 100 } })),
    reasonOf(single({ accelerate: { drag: 100.5 } })),
    reasonOf({ seed: 0xffffffff, populations: single({}).populations }),
    reasonOf({ seed: 2 ** 32, populations: single({}).populations }),
  ]
  assert.deepEqual(actual, ['accepted', 'velocity-invalid', 'accepted', 'velocity-invalid', 'accepted', 'max-particles-invalid', 'accepted', 'max-particles-invalid', 'accepted', 'spawn-rate-invalid', 'accepted', 'spawn-burst-invalid', 'accepted', 'lifetime-invalid', 'accepted', 'accelerate-invalid', 'accepted', 'seed-invalid'])
})

gate('control: a program with seventeen populations is refused as population-count-invalid', () => {
  const many = Array.from({ length: 17 }, (_, i) => ({ ...program.populations[1], name: 'p' + i }))
  assert.throws(() => parseFxProgram({ populations: many }), (error) => error instanceof FxProgramError && error.reasonCode === 'population-count-invalid')
})

finish()
