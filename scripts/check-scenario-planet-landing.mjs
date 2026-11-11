import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { PLANET } from '../src/engine/sceneSetup.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { writeTickTrace } from './lib/tickTrace.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const RADIUS = 0.5
const BODIES = 256
const DROP_M = 3
const TICKS = 480
const SINK_LIMIT_M = 0.05
const FLOAT_LIMIT_M = 1.0
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '1024 tier, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const PATCH_SIDE = 16
const PATCH_SPACING_M = 2
const ANCHOR = [PLANET.radius, 0, 0]

const dropPoint = (i) => {
  const col = i % PATCH_SIDE
  const row = Math.floor(i / PATCH_SIDE)
  const across = (col - (PATCH_SIDE - 1) / 2) * PATCH_SPACING_M
  const along = (row - (PATCH_SIDE - 1) / 2) * PATCH_SPACING_M
  const p = [ANCHOR[0], across, along]
  const len = Math.hypot(...p)
  return p.map((c) => (c / len) * (PLANET.radius + DROP_M))
}

const scenario = async (tier) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: RADIUS, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const handles = []
  for (let i = 0; i < BODIES; i++) handles.push(world.spawn(dropPoint(i)))
  const tickMs = []
  for (let t = 0; t < TICKS; t++) {
    const started = performance.now()
    world.step()
    tickMs.push(performance.now() - started)
  }
  const gaps = new Float64Array(BODIES)
  const p = [0, 0, 0]
  handles.forEach((handle, i) => {
    world.position(handle, p)
    const distance = Math.hypot(p[0], p[1], p[2])
    const ground = world.height(p[0], p[1], p[2])
    gaps[i] = distance - PLANET.radius - ground - RADIUS
  })
  return { gaps, tickMs }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  gate(tier.label + ': no sphere sinks into the planet surface (gap to the surface plus radius at least -' + SINK_LIMIT_M + ' m)', () => {
    for (let i = 0; i < BODIES; i++) assert.ok(first.gaps[i] >= -SINK_LIMIT_M, 'sphere ' + i + ' sank by ' + -first.gaps[i] + ' m')
  })
  gate(tier.label + ': every sphere comes to rest on the surface (gap at most ' + FLOAT_LIMIT_M + ' m)', () => {
    for (let i = 0; i < BODIES; i++) assert.ok(first.gaps[i] <= FLOAT_LIMIT_M, 'sphere ' + i + ' floats ' + first.gaps[i] + ' m above the surface')
  })
  gate(tier.label + ': two runs agree bit for bit on every landing gap', () => {
    assert.deepEqual(new Uint32Array(new Float32Array(second.gaps).buffer), new Uint32Array(new Float32Array(first.gaps).buffer))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const trace = writeTickTrace('planet-landing', tier.label, [first.tickMs, second.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
