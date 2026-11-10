import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'

const root = resolve(process.cwd())
const glue = process.argv[2] ?? 'engine/out/engine-core-64mib.mjs'
const PAGES = Number(process.argv[3] ?? 256)
const REPEATS = Number(process.argv[4] ?? 5)
const PAGE_SIDE = 16
const PAGE_SAMPLES = PAGE_SIDE * PAGE_SIDE
const RADIUS = 6371000

const factory = (await import(pathToFileURL(resolve(root, glue)).href)).default
const { planetCellSize } = await import(pathToFileURL(resolve(root, 'src/engine/pageLayout.js')).href)

const bench = async () => {
  const module = await factory()
  const budget = Number(process.env.LANDSCAPE_BUDGET_MIB ?? 48) * 1024 * 1024
  const init = module._engine_init(1024, 1, budget)
  if (init !== 0) throw new Error('engine_init ' + init)
  const wc = module._engine_world_configure(1, 60, -9.8, 0, 0.5, 0, 8)
  if (wc !== 0) throw new Error('world configure ' + wc)
  const cellSize = planetCellSize(RADIUS)
  const st = module._engine_planet_configure(RADIUS, cellSize, 9.8, 8000)
  if (st !== 0) throw new Error('planet configure ' + st)
  const cellsPerFace = Math.floor((2 * RADIUS) / cellSize)
  const keyFor = (i) => module._engine_planet_key(0, i % cellsPerFace, Math.floor(i / cellsPerFace) % cellsPerFace)

  const height = (i, j, k) => 100 * Math.sin(0.01 * (i + 3 * k)) + 50 * Math.cos(0.02 * j)

  const build = () => {
    const slots = []
    const t0 = performance.now()
    for (let k = 0; k < PAGES; k++) {
      const slot = module._engine_page_stage(keyFor(k))
      if (slot < 0) break
      const base = module._engine_page_samples(slot) >> 2
      for (let j = 0; j < PAGE_SIDE; j++) {
        for (let i = 0; i < PAGE_SIDE; i++) module.HEAPF32[base + j * PAGE_SIDE + i] = height(i, j, k)
      }
      if (module._engine_page_commit(slot) !== 0) throw new Error('commit ' + slot)
      slots.push({ slot, base })
    }
    return { slots, ms: performance.now() - t0 }
  }

  const shared = build()
  const pageCount = shared.slots.length
  if (pageCount === 0) throw new Error('no page staged')

  const copyStore = (pages) => {
    const dst = new Float32Array(pages.length * PAGE_SAMPLES)
    const t0 = performance.now()
    for (let p = 0; p < pages.length; p++) {
      const src = module.HEAPF32.subarray(pages[p].base, pages[p].base + PAGE_SAMPLES)
      dst.set(src, p * PAGE_SAMPLES)
    }
    return { ms: performance.now() - t0, bytes: dst.byteLength, dst }
  }

  const samples = []
  for (let r = 0; r < REPEATS; r++) {
    const copy = copyStore(shared.slots)
    samples.push({ copyMs: copy.ms, copyBytes: copy.bytes })
  }
  const sharedBytes = pageCount * PAGE_SAMPLES * 4
  const copyMs = samples.map((s) => s.copyMs).sort((a, b) => a - b)[Math.floor(REPEATS / 2)]
  const result = {
    glue,
    radius: RADIUS,
    cellSize,
    pagesBuilt: pageCount,
    pageSamplesBytes: PAGE_SAMPLES * 4,
    sharedStoreBytes: sharedBytes,
    twoCopiesStoreBytes: sharedBytes * 2,
    buildSharedMs: +shared.ms.toFixed(3),
    buildTwoCopiesMs: +(shared.ms + copyMs).toFixed(3),
    extraCopyMsMedian: +copyMs.toFixed(3),
    repeats: REPEATS,
    residentAfterBuild: module._engine_planet_resident(),
  }
  return result
}

const result = await bench()
const out = resolve(root, 'build/diag/landscape/store.json')
writeFileSync(out, JSON.stringify(result, null, 1) + '\n')
console.log(JSON.stringify(result))
