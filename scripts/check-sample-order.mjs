import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cellOrigin, PAGE_SIDE, PAGE_SPAN, PAGE_U_EDGE, PAGE_V_EDGE, planetCellSize, sampleOffset } from '../src/engine/pageLayout.js'
import { finish, gate } from './lib/gate.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
const RADIUS = 6371000
const GLUE = join(root, 'engine/out/engine-core-512mib.mjs')
const TOL = 0.25
const CELLS = []
for (let dy = -3; dy <= 2; dy++) for (let dx = -3; dx <= 2; dx++) CELLS.push({ dx, dy })
const CENTRAL = CELLS.filter(({ dx, dy }) => dx >= -2 && dx <= 1 && dy >= -2 && dy <= 1)

const planetSource = read('engine/src/planet_frame.cpp')
const gpuSource = read('engine/src/render/render_webgpu.cpp')
const glSource = read('engine/src/render/render_webgl2.cpp')

gate('the planet lookup reads the page at s[j0 * kPageSide + i0], with i along offset x and j along offset y', () => {
  assert.ok(planetSource.includes('const double gx = clampUnit(offsetX - cx) * (kPageSide - 1);'))
  assert.ok(planetSource.includes('const double gy = clampUnit(offsetY - cy) * (kPageSide - 1);'))
  assert.ok(planetSource.includes('s[j0 * kPageSide + i0]'))
})

gate('the +y face basis is c = (0,1,0), u = (1,0,0), v = (0,0,-1) in the Frame order c, u, v', () => {
  assert.ok(planetSource.includes('{{0, 1, 0}, {1, 0, 0}, {0, 0, -1}},'))
})

gate('both renderers place texel (gi, gj) at origin + uEdge gi/15 + vEdge gj/15, with texel x = gi and y = gj', () => {
  assert.ok(gpuSource.includes('let world = origin + uEdge * (f32(gi) / 15.0) + vEdge * (f32(gj) / 15.0) + normal * h;'))
  assert.ok(gpuSource.includes('textureLoad(heights, vec2i(i32(gi), i32(gj)), i32(layer), 0)'))
  assert.ok(glSource.includes('aOrigin + aUEdge * (float(gi) / 15.0) + aVEdge * (float(gj) / 15.0)'))
  assert.ok(glSource.includes('texelFetch(heights, ivec3(gi, gj, int(aLayer)), 0)'))
})

gate('the shared layout puts sample (col, row) at origin + (col/15) uEdge + (row/15) vEdge, with u on +x and v on -z', () => {
  assert.deepEqual(PAGE_U_EDGE, [PAGE_SPAN, 0, 0])
  assert.deepEqual(PAGE_V_EDGE, [0, 0, -PAGE_SPAN])
  assert.deepEqual(sampleOffset(15, 0), [20, 0, 0])
  assert.deepEqual(sampleOffset(0, 15), [0, 0, -20])
  assert.deepEqual(cellOrigin(1, 2), [20, 0, -40])
})

gate('the planet cell size makes one cell span one page near the pole, and the anchor a cell corner', () => {
  const cell = planetCellSize(RADIUS)
  assert.ok(Math.abs(cell * Math.PI / 4 - PAGE_SPAN) < 1e-3)
  assert.ok(Math.abs(RADIUS / cell - Math.round(RADIUS / cell)) < 1e-6)
})

const probe = async (mirror) => {
  const mod = await (await import(pathToFileURL(GLUE).href)).default()
  assert.equal(mod._engine_init(1024, 1, 512 * 1024 * 1024), 0)
  assert.equal(mod._engine_world_configure(10240, 60, -9.8, 0, 0.5, 0, 8), 0)
  assert.equal(mod._engine_planet_configure(RADIUS, planetCellSize(RADIUS), 9.8, 8000), 0)
  mod._engine_planet_locate(0, RADIUS, 0)
  const at = mod._engine_planet_scratch() >> 2
  const anchor = { face: mod.HEAPU32[at], cx: mod.HEAPU32[at + 1], cy: mod.HEAPU32[at + 2] }
  let mismatches = 0
  let checked = 0
  CELLS.forEach(({ dx, dy }, k) => {
    const key = mod._engine_planet_key(anchor.face, anchor.cx + dx, anchor.cy + dy)
    const slot = mod._engine_page_stage(key)
    assert.ok(slot >= 0, 'page stage refused at cell ' + dx + ',' + dy)
    const samples = mod._engine_page_samples(slot) >> 2
    for (let s = 0; s < PAGE_SIDE * PAGE_SIDE; s++) {
      const col = s % PAGE_SIDE
      const row = Math.floor(s / PAGE_SIDE)
      const source = mirror ? row * PAGE_SIDE + (PAGE_SIDE - 1 - col) : s
      mod.HEAPF32[samples + s] = k * 256 + source
    }
    mod._engine_page_commit(slot)
  })
  mod._engine_tick(1)
  CENTRAL.forEach(({ dx, dy }) => {
    const k = CELLS.findIndex((c) => c.dx === dx && c.dy === dy)
    for (let row = 1; row < PAGE_SIDE - 1; row++) {
      for (let col = 1; col < PAGE_SIDE - 1; col++) {
        const origin = cellOrigin(dx, dy)
        const offset = sampleOffset(col, row)
        const h = mod._engine_planet_height(origin[0] + offset[0], RADIUS + origin[1] + offset[1], origin[2] + offset[2])
        const expected = k * 256 + row * PAGE_SIDE + col
        checked += 1
        if (Math.abs(h - expected) > TOL) mismatches += 1
      }
    }
  })
  return { checked, mismatches }
}

const straight = await probe(false)
const mirrored = await probe(true)
console.log('sample order: checked ' + straight.checked + ' interior samples, mismatches ' + straight.mismatches)
console.log('mirrored-terrain control: checked ' + mirrored.checked + ' interior samples, mismatches ' + mirrored.mismatches)

gate('the planet lookup returns every interior page sample at its render-frame position', () => {
  assert.equal(straight.checked, CENTRAL.length * (PAGE_SIDE - 2) ** 2)
  assert.equal(straight.mismatches, 0)
})

gate('the mirrored-terrain control fails the same check, so the check can see a mirrored page', () => {
  assert.equal(mirrored.checked, straight.checked)
  assert.ok(mirrored.mismatches > 0, 'the mirrored control passed; the check cannot see a mirrored page')
})

finish()
