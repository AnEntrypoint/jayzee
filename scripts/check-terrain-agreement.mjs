import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { PLANET } from '../src/engine/sceneSetup.js'
import { PAGE_SIDE } from '../src/engine/pageLayout.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const BODY_RADIUS_M = 0.5
const DRAWS = 2000
const WINDOW = 1
const AGREEMENT_TOLERANCE_M = 1e-6
const PHYSICS_TOLERANCE_M = 1e-3
const DROP_HEIGHT_M = 4
const SETTLE_TICKS = 240
const PICKS = 12
const TIERS = Object.freeze([
  { label: '64 tier', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '1024 tier, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const pageSamples = (key) => {
  const k = Math.abs(Number(key)) % 97
  const samples = new Float32Array(PAGE_SIDE * PAGE_SIDE)
  for (let s = 0; s < samples.length; s++) {
    const h = Math.imul(s + 1, 2654435761) ^ Math.imul(k + 7, 40503)
    samples[s] = ((h >>> 0) / 4294967296 - 0.5) * 0.8
  }
  return samples
}

const cellCorner = (samples, u, v) => {
  const gx = u * (PAGE_SIDE - 1)
  const gy = v * (PAGE_SIDE - 1)
  const i0 = Math.min(Math.floor(gx), PAGE_SIDE - 2)
  const j0 = Math.min(Math.floor(gy), PAGE_SIDE - 2)
  const tx = gx - i0
  const ty = gy - j0
  return { tx, ty, s00: samples[j0 * PAGE_SIDE + i0], s10: samples[j0 * PAGE_SIDE + i0 + 1], s01: samples[(j0 + 1) * PAGE_SIDE + i0], s11: samples[(j0 + 1) * PAGE_SIDE + i0 + 1] }
}

const renderedHeight = (samples, u, v) => {
  const c = cellCorner(samples, u, v)
  if (c.ty <= c.tx) return c.s00 + c.tx * (c.s10 - c.s00) + c.ty * (c.s11 - c.s10)
  return c.s00 + c.ty * (c.s01 - c.s00) + c.tx * (c.s11 - c.s01)
}

const bilinearHeight = (samples, u, v) => {
  const c = cellCorner(samples, u, v)
  return (1 - c.tx) * (1 - c.ty) * c.s00 + c.tx * (1 - c.ty) * c.s10 + (1 - c.tx) * c.ty * c.s01 + c.tx * c.ty * c.s11
}

const onSurface = (world, cell, u, v) => {
  const frame = world.cellFrame(cell.face, cell.cx, cell.cy)
  const p = [0, 1, 2].map((k) => frame.origin[k] + u * frame.uEdge[k] + v * frame.vEdge[k])
  const len = Math.hypot(p[0], p[1], p[2])
  return p.map((c) => (c * PLANET.radius) / len)
}

const locate = (world, p) => {
  const local = world.faceLocal(p)
  const offsetX = (local.ox + PLANET.radius) / PLANET.cellSize
  const offsetY = (local.oy + PLANET.radius) / PLANET.cellSize
  const cx = Math.floor(offsetX)
  const cy = Math.floor(offsetY)
  return { face: local.face, cx, cy, u: offsetX - cx, v: offsetY - cy }
}

const setup = async (tier) => {
  const world = await createEngineWorld({ capacity: 8, tickRate: 60, gravity: -9.8, drag: 0, radius: BODY_RADIUS_M, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const centre = locate(world, [0, PLANET.radius, 0])
  const pages = new Map()
  for (let dy = -WINDOW; dy <= WINDOW; dy++) {
    for (let dx = -WINDOW; dx <= WINDOW; dx++) {
      const key = world.cellKey(centre.face, centre.cx + dx, centre.cy + dy)
      pages.set(`${dx},${dy}`, { key, samples: pageSamples(key) })
      world.writePage(key, pages.get(`${dx},${dy}`).samples)
    }
  }
  world.applyPages()
  const cell = { face: centre.face, cx: centre.cx, cy: centre.cy }
  const samples = pages.get('0,0').samples
  const draws = []
  let seed = 12345
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let i = 0; i < DRAWS; i++) {
    const u = random()
    const v = random()
    const p = onSurface(world, cell, u, v)
    const at = locate(world, p)
    assert.equal(at.face, cell.face, 'draw left the centre face')
    assert.equal(at.cx, cell.cx, 'draw left the centre cell in x')
    assert.equal(at.cy, cell.cy, 'draw left the centre cell in y')
    draws.push({ p, u: at.u, v: at.v, collision: world.height(p[0], p[1], p[2]), rendered: renderedHeight(samples, at.u, at.v), bilinear: bilinearHeight(samples, at.u, at.v) })
  }
  return { world, cell, samples, draws }
}

const runTier = async (tier) => {
  const { world, cell, samples, draws } = await setup(tier)
  const worst = draws.reduce((m, d) => Math.max(m, Math.abs(d.collision - d.rendered)), 0)
  const bilinearGap = draws.reduce((m, d) => Math.max(m, Math.abs(d.bilinear - d.rendered)), 0)
  gate(`${tier.label}: collision height equals the rendered height at ${DRAWS} interior points, within ${AGREEMENT_TOLERANCE_M} m`, () => {
    assert.ok(worst <= AGREEMENT_TOLERANCE_M, 'worst gap ' + worst + ' m')
  })
  gate(`${tier.label}: control, the bilinear reading of the same samples differs from the rendered surface by more than 0.01 m`, () => {
    assert.ok(bilinearGap > 0.01, 'bilinear gap ' + bilinearGap + ' m')
  })
  gate(`${tier.label}: the centre cell's frame has the cell's edge length, and its normal points away from the planet centre`, () => {
    const frame = world.cellFrame(cell.face, cell.cx, cell.cy)
    const uLen = Math.hypot(...frame.uEdge)
    const vLen = Math.hypot(...frame.vEdge)
    const edge = PLANET.cellSize * Math.PI / 4
    assert.ok(Math.abs(uLen - edge) < 1e-3, 'u edge ' + uLen + ' m against ' + edge + ' m')
    assert.ok(Math.abs(vLen - edge) < 1e-3, 'v edge ' + vLen + ' m against ' + edge + ' m')
    const n = [frame.uEdge[1] * frame.vEdge[2] - frame.uEdge[2] * frame.vEdge[1], frame.uEdge[2] * frame.vEdge[0] - frame.uEdge[0] * frame.vEdge[2], frame.uEdge[0] * frame.vEdge[1] - frame.uEdge[1] * frame.vEdge[0]]
    assert.ok(n[0] * frame.origin[0] + n[1] * frame.origin[1] + n[2] * frame.origin[2] > 0, 'normal points inward')
    const mid = onSurface(world, cell, 0.5, 0.5)
    const at = locate(world, mid)
    assert.equal(`${at.face},${at.cx},${at.cy}`, `${cell.face},${cell.cx},${cell.cy}`, 'the frame centre does not locate to its cell')
  })
  const picks = [...draws].sort((a, b) => Math.abs(b.bilinear - b.rendered) - Math.abs(a.bilinear - a.rendered)).slice(0, PICKS)
  const contacts = []
  for (const pick of picks) {
    const dir = pick.p.map((c) => c / Math.hypot(...pick.p))
    const start = dir.map((c) => c * (PLANET.radius + pick.rendered + DROP_HEIGHT_M))
    world.follow(start)
    const handle = world.spawn(start)
    for (let t = 0; t < SETTLE_TICKS; t++) world.step()
    const rest = world.position(handle)
    const restDistance = Math.hypot(rest[0], rest[1], rest[2]) - PLANET.radius
    const at = locate(world, rest)
    const restSamples = at.cx === cell.cx && at.cy === cell.cy && at.face === cell.face ? samples : null
    const surface = restSamples ? renderedHeight(restSamples, at.u, at.v) : null
    contacts.push({ restDistance, surface, pickBilinearGap: Math.abs(pick.bilinear - pick.rendered) })
    world.despawn(handle)
  }
  const inCell = contacts.filter((c) => c.surface !== null)
  gate(`${tier.label}: a sphere resting on the terrain sits at the rendered surface plus its radius, within ${PHYSICS_TOLERANCE_M} m, at ${inCell.length} of ${PICKS} picked points`, () => {
    assert.ok(inCell.length >= PICKS / 2, 'only ' + inCell.length + ' contacts stayed in the centre cell')
    for (const c of inCell) {
      const gap = Math.abs(c.restDistance - (c.surface + BODY_RADIUS_M))
      assert.ok(gap <= PHYSICS_TOLERANCE_M, 'contact gap ' + gap + ' m at a point whose bilinear gap is ' + c.pickBilinearGap + ' m')
    }
  })
  return { worst, bilinearGap, contacts: inCell.length }
}

const started = Date.now()
const summary = []
for (const tier of TIERS) summary.push({ tier: tier.label, ...(await runTier(tier)) })
console.log(JSON.stringify({ summary, wallMs: Date.now() - started }))
finish()
