import { gate, finish } from './lib/gate.mjs'
import { createCellIndex3D, resultCount, resultTruncated, CELL_SIZE_M } from '../src/spatial-pure/cellIndex3d.js'
import { SpatialIndex } from '../src/spatial-pure/octree.js'

const fail = (what) => { throw new Error(what) }
const expect = (actual, expected, what) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) fail(`${what}: expected ${e} got ${a}`)
}
const refuses = (fn, pattern, what) => {
  let thrown = null
  try { fn() } catch (error) { thrown = error }
  if (!thrown) fail(`${what}: did not throw`)
  if (!(thrown instanceof TypeError) || !pattern.test(thrown.message)) fail(`${what}: wrong error ${thrown.message}`)
}
const seeded = (seed) => {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const PLANET_R = 6000
const onSphere = (rnd, altitude = 0) => {
  const u = rnd() * 2 - 1, phi = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = PLANET_R + altitude
  return [r * s * Math.cos(phi), r * u, r * s * Math.sin(phi)]
}
const bruteSphere = (points, alive, c, r) => {
  const out = []
  for (let i = 0; i < points.length; i++) {
    if (!alive[i]) continue
    const p = points[i], dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2]
    if (dx * dx + dy * dy + dz * dz <= r * r) out.push(i)
  }
  return out
}
const taken = (out, returned) => Array.from(out.subarray(0, resultCount(returned)))

gate('the index states a 32 m cell and refuses a missing, fractional or negative budget and a bad cell size', () => {
  expect(CELL_SIZE_M, 32, 'cell size')
  expect(createCellIndex3D({ capacity: 4 }).cellSize, 32, 'default cell')
  refuses(() => createCellIndex3D(), /capacity/, 'no config')
  refuses(() => createCellIndex3D({ capacity: 0 }), /capacity/, 'zero')
  refuses(() => createCellIndex3D({ capacity: 2.5 }), /capacity/, 'fraction')
  refuses(() => createCellIndex3D({ capacity: 8, cellSize: 0 }), /cellSize/, 'zero cell')
  refuses(() => createCellIndex3D({ capacity: 8, cellSize: NaN }), /cellSize/, 'NaN cell')
})

gate('every array is a typed array sized once from the budget', () => {
  const index = createCellIndex3D({ capacity: 1000 })
  const b = index.buffers
  expect(b.position instanceof Float64Array && b.position.length === 3000, true, 'positions')
  for (const name of ['next', 'prev', 'bucketOf', 'cellX', 'cellY', 'cellZ']) expect(b[name] instanceof Int32Array && b[name].length === 1000, true, name)
  expect(b.live instanceof Uint8Array && b.live.length === 1000, true, 'live')
  expect(b.heads.length, 2048, 'hash table is the next power of two at or above twice the budget')
  expect(index.tableSize, 2048, 'table size reported')
})

gate('a sphere query on a planet returns the same slots as a brute scan, in ascending slot order, for 400 seeded queries', () => {
  const rnd = seeded(11)
  const n = 6000
  const index = createCellIndex3D({ capacity: n })
  const points = [], alive = []
  for (let i = 0; i < n; i++) { const p = onSphere(rnd, rnd() * 60); points.push(p); alive.push(true); index.set(i, p[0], p[1], p[2]) }
  expect(index.size, n, 'size')
  const out = new Int32Array(n)
  let hits = 0
  for (let q = 0; q < 400; q++) {
    const c = onSphere(rnd, rnd() * 60), r = rnd() * 400
    const got = taken(out, index.querySphere(c[0], c[1], c[2], r, out))
    expect(got, bruteSphere(points, alive, c, r), `query ${q}`)
    hits += got.length
  }
  if (hits < 400) fail(`the queries found only ${hits} slots, so the comparison is not exercising the index`)
})

gate('moves, removals and re-insertions keep the index equal to a brute scan across 20000 seeded operations', () => {
  const rnd = seeded(29)
  const n = 1500
  const index = createCellIndex3D({ capacity: n })
  const points = new Array(n).fill(null), alive = new Array(n).fill(false)
  const out = new Int32Array(n)
  for (let op = 0; op < 20000; op++) {
    const slot = Math.floor(rnd() * n), roll = rnd()
    if (roll < 0.15) { index.remove(slot); alive[slot] = false }
    else if (roll < 0.6 && alive[slot]) {
      const p = points[slot]
      const moved = [p[0] + (rnd() - 0.5) * 80, p[1] + (rnd() - 0.5) * 80, p[2] + (rnd() - 0.5) * 80]
      points[slot] = moved; index.set(slot, moved[0], moved[1], moved[2])
    } else { const p = onSphere(rnd, rnd() * 40); points[slot] = p; alive[slot] = true; index.set(slot, p[0], p[1], p[2]) }
    if (op % 50 === 0) {
      const c = onSphere(rnd), r = rnd() * 900
      expect(taken(out, index.querySphere(c[0], c[1], c[2], r, out)), bruteSphere(points, alive, c, r), `op ${op}`)
    }
  }
  expect(index.size, alive.filter(Boolean).length, 'live count')
})

gate('two points that share an XZ column on opposite sides of the planet sit in different cells, and the XZ index scans both where the 3D index scans one', () => {
  const index = createCellIndex3D({ capacity: 4096 })
  const flat = new SpatialIndex()
  const rnd = seeded(5)
  let slot = 0
  for (let i = 0; i < 120; i++) {
    const x = (rnd() - 0.5) * 60, z = (rnd() - 0.5) * 60
    const y = Math.sqrt(PLANET_R * PLANET_R - x * x - z * z)
    index.set(slot, x, y, z); flat.insert(slot, [x, y, z]); slot++
    index.set(slot, x, -y, z); flat.insert(slot, [x, -y, z]); slot++
  }
  const out = new Int32Array(4096)
  index.resetStats()
  const got = taken(out, index.querySphere(0, PLANET_R, 0, 30, out))
  const visited3d = index.stats.visited
  const flatGot = flat.nearby([0, PLANET_R, 0], 30).sort((a, b) => a - b)
  expect(got, flatGot, 'both indexes agree on the answer')
  if (got.some((s) => s % 2 === 1)) fail('a far-side slot was returned')
  if (visited3d > 120) fail(`the 3D index examined ${visited3d} slots, which includes the far side`)
  let flatExamined = 0
  for (let s = 0; s < slot; s++) { const p = flat.getPosition(s); if (Math.abs(p[0]) <= 62 && Math.abs(p[2]) <= 62) flatExamined++ }
  if (flatExamined < 240) fail(`the XZ column holds ${flatExamined} slots, expected both sides`)
  if (!(visited3d * 2 <= flatExamined)) fail(`3D examined ${visited3d}, XZ column holds ${flatExamined}`)
})

gate('a radial cylinder query takes its up from the planet centre and matches a brute scan at the pole, the equator and the far side', () => {
  const rnd = seeded(71)
  const n = 3000
  const index = createCellIndex3D({ capacity: n })
  const centres = [[0, PLANET_R, 0], [PLANET_R, 0, 0], [0, -PLANET_R, 0], [-3000, 4000, 3316.6]]
  const points = []
  for (let i = 0; i < n; i++) {
    const c = centres[i % centres.length], len = Math.hypot(c[0], c[1], c[2])
    const p = [c[0] + (rnd() - 0.5) * 300, c[1] + (rnd() - 0.5) * 300, c[2] + (rnd() - 0.5) * 300]
    points.push(p); index.set(i, p[0], p[1], p[2])
    if (len === 0) fail('bad centre')
  }
  const out = new Int32Array(n)
  for (const c of centres) {
    const len = Math.hypot(c[0], c[1], c[2]), u = [c[0] / len, c[1] / len, c[2] / len]
    for (const [r, h] of [[60, 10], [120, 40], [20, 140], [0, 0]]) {
      const brute = []
      for (let i = 0; i < n; i++) {
        const p = points[i], dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2]
        const along = dx * u[0] + dy * u[1] + dz * u[2]
        if (Math.abs(along) <= h && dx * dx + dy * dy + dz * dz - along * along <= r * r) brute.push(i)
      }
      expect(taken(out, index.queryRadialCylinder(c[0], c[1], c[2], r, h, out)), brute, `centre ${c} r ${r} h ${h}`)
    }
  }
  refuses(() => index.queryRadialCylinder(0, 0, 0, 10, 10, out), /planet centre/, 'centre has no up')
  refuses(() => index.queryRadialCylinder(0, 10, 0, 10, -1, out), /halfHeight/, 'negative half height')
})

gate('nearest returns the closest slot inside the radius, the lowest slot on a tie, and -1 when none is in reach', () => {
  const index = createCellIndex3D({ capacity: 16 })
  index.set(7, 100, 6000, 0)
  index.set(3, -100, 6000, 0)
  index.set(9, 0, 6000, 40)
  expect(index.nearest(0, 6000, 0, 500), 9, 'closest')
  expect(index.nearest(0, 6000, -500, 520), 3, 'tie takes the lowest slot')
  expect(index.nearest(0, 6000, 0, 39), -1, 'none in reach')
  expect(index.nearest(0, -6000, 0, 500), -1, 'far side')
  expect(index.nearest(0, 6000, 0, 1e7), 9, 'a planet-wide reach falls back to a scan and gives the same answer')
})

gate('a result array that is too small is filled, and the return value reports the truncation', () => {
  const index = createCellIndex3D({ capacity: 64 })
  for (let i = 0; i < 40; i++) index.set(i, i * 0.5, 6000, 0)
  const small = new Int32Array(8)
  const returned = index.querySphere(0, 6000, 0, 100, small)
  expect(resultTruncated(returned), true, 'truncated')
  expect(resultCount(returned), 8, 'filled')
  expect(index.stats.overflow, 32, 'dropped slots counted')
  const full = new Int32Array(64)
  const whole = index.querySphere(0, 6000, 0, 100, full)
  expect([resultTruncated(whole), resultCount(whole)], [false, 40], 'a large enough array is complete')
})

gate('a query wider than the population scans the slots once instead of walking empty cells', () => {
  const index = createCellIndex3D({ capacity: 32 })
  for (let i = 0; i < 20; i++) index.set(i, i * 500 - 5000, 0, 0)
  const out = new Int32Array(32)
  index.resetStats()
  expect(resultCount(index.querySphere(0, 0, 0, 20000, out)), 20, 'all found')
  expect([index.stats.scans, index.stats.cellsProbed], [1, 0], 'one scan and no cell walk')
})

gate('non-finite positions leave the index, bad slots, centres, radii and result arrays are refused', () => {
  const index = createCellIndex3D({ capacity: 8 })
  const out = new Int32Array(8)
  expect(index.set(1, 1, 2, 3), true, 'set')
  expect(index.set(1, NaN, 2, 3), false, 'NaN removes')
  expect([index.has(1), index.size], [false, 0], 'gone')
  refuses(() => index.set(8, 0, 0, 0), /slot/, 'slot at capacity')
  refuses(() => index.set(-1, 0, 0, 0), /slot/, 'negative slot')
  refuses(() => index.querySphere(NaN, 0, 0, 1, out), /centre/, 'NaN centre')
  refuses(() => index.querySphere(0, 0, 0, -1, out), /radius/, 'negative radius')
  refuses(() => index.querySphere(0, 0, 0, 1, []), /result array/, 'plain array result')
  refuses(() => index.nearest(0, 0, 0, Infinity), /radius/, 'infinite radius')
  const p = [0, 0, 0]
  index.set(2, 4, 5, 6)
  expect([index.readPosition(2, p), p], [true, [4, 5, 6]], 'read back')
  expect(index.readPosition(3, p), false, 'empty slot')
  index.clear()
  expect([index.size, resultCount(index.querySphere(0, 0, 0, 100, out))], [0, 0], 'clear empties')
})

gate('200000 moves and 20000 queries after construction leave every buffer the same object and add no measurable heap', () => {
  const n = 4000
  const index = createCellIndex3D({ capacity: n })
  const rnd = seeded(97)
  const out = new Int32Array(n)
  const before = Object.values(index.buffers)
  const lengths = before.map((b) => b.length)
  const churn = (moves, queries) => {
    let found = 0
    for (let i = 0; i < moves; i++) {
      const slot = (i * 7919) % n
      const u = rnd() * 2 - 1, phi = rnd() * 6.283185307179586, s = Math.sqrt(1 - u * u)
      index.set(slot, PLANET_R * s * Math.cos(phi), PLANET_R * u, PLANET_R * s * Math.sin(phi))
      if (i % 9 === 0) index.remove((slot + 1) % n)
    }
    for (let q = 0; q < queries; q++) {
      const u = rnd() * 2 - 1, phi = rnd() * 6.283185307179586, s = Math.sqrt(1 - u * u)
      found += resultCount(index.querySphere(PLANET_R * s * Math.cos(phi), PLANET_R * u, PLANET_R * s * Math.sin(phi), 300, out))
      index.nearest(PLANET_R * s * Math.cos(phi), PLANET_R * u, PLANET_R * s * Math.sin(phi), 200)
    }
    return found
  }
  churn(40000, 4000)
  const heapBefore = process.memoryUsage().heapUsed
  const found = churn(200000, 20000)
  const grown = process.memoryUsage().heapUsed - heapBefore
  const after = Object.values(index.buffers)
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i] || after[i].length !== lengths[i]) fail(`buffer ${i} was replaced or resized`)
  if (found < 1000) fail(`the queries found only ${found} slots`)
  if (grown > 2 * 1024 * 1024) fail(`heap grew by ${grown} bytes across the measured run`)
  const control = []
  const controlBefore = process.memoryUsage().heapUsed
  for (let q = 0; q < 220000; q++) control.push([q, q, q])
  const controlGrown = process.memoryUsage().heapUsed - controlBefore
  if (!(controlGrown > 2 * 1024 * 1024)) fail(`negative control: an allocating loop of the same length grew the heap by only ${controlGrown} bytes, so the measurement cannot see allocation`)
})

finish()
