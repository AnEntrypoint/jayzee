export const HEIGHTFIELD_BAKE_ENTRIES = Object.freeze([
  'src/packages/mapspinner/height-cpu.js',
  'src/packages/mapspinner/heightfield-codec.js',
  'src/terrain-pure/heightfieldBake.js',
])

export const DEFAULT_NODES_PER_SECTOR = 16
export const DEFAULT_BAKE_BITS = 16
const SUPPORTED_BITS = [8, 16]

export class HeightfieldBakeError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'HeightfieldBakeError'
    this.code = code
  }
}

export function tangentBasis(anchorDir) {
  const l = Array.isArray(anchorDir) && anchorDir.length === 3 ? Math.hypot(anchorDir[0], anchorDir[1], anchorDir[2]) : NaN
  if (!(l > 0) || !Number.isFinite(l)) throw new HeightfieldBakeError('bake-anchor-not-a-direction', `anchorDir must be a finite non-zero 3-vector, got ${JSON.stringify(anchorDir ?? null)}`)
  const up = [anchorDir[0] / l, anchorDir[1] / l, anchorDir[2] / l]
  const ref = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  let east = [ref[1] * up[2] - ref[2] * up[1], ref[2] * up[0] - ref[0] * up[2], ref[0] * up[1] - ref[1] * up[0]]
  const el = Math.hypot(east[0], east[1], east[2])
  east = [east[0] / el, east[1] / el, east[2] / el]
  const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]]
  return { up, east, north }
}

export function quantizeSectors(heights, N, nodesPerSector = DEFAULT_NODES_PER_SECTOR, bits = DEFAULT_BAKE_BITS) {
  if (!Number.isInteger(N) || N < 2) throw new HeightfieldBakeError('bake-n-too-small', `N must be an integer of at least 2, got ${N}`)
  if (!heights || heights.length !== N * N) throw new HeightfieldBakeError('bake-sample-count', `N=${N} needs ${N * N} heights, got ${heights ? heights.length : 0}`)
  if (!Number.isInteger(nodesPerSector) || nodesPerSector < 1) throw new HeightfieldBakeError('bake-sector-size', `nodesPerSector must be a positive integer, got ${nodesPerSector}`)
  if (!SUPPORTED_BITS.includes(bits)) throw new HeightfieldBakeError('bake-bits', `bits must be 8 or 16, got ${bits}`)
  const gridS = Math.ceil(N / nodesPerSector)
  const qmax = (1 << bits) - 1
  const sectorMin = new Float32Array(gridS * gridS).fill(Infinity)
  const sectorMax = new Float32Array(gridS * gridS).fill(-Infinity)
  const sectorOf = (i) => Math.min(Math.floor(i / nodesPerSector), gridS - 1)
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const h = heights[iz * N + ix]
      if (!Number.isFinite(h)) throw new HeightfieldBakeError('bake-height-not-finite', `height at ${ix},${iz} is ${h}`)
      const si = sectorOf(iz) * gridS + sectorOf(ix)
      if (h < sectorMin[si]) sectorMin[si] = h
      if (h > sectorMax[si]) sectorMax[si] = h
    }
  }
  const q = bits === 16 ? new Uint16Array(N * N) : new Uint8Array(N * N)
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const si = sectorOf(iz) * gridS + sectorOf(ix)
      const lo = sectorMin[si]
      const hi = sectorMax[si]
      const t = hi > lo ? (heights[iz * N + ix] - lo) / (hi - lo) : 0
      q[iz * N + ix] = Math.max(0, Math.min(qmax, Math.round(t * qmax)))
    }
  }
  return { sectors: { gridS, nodesPerSector, bits, qmax }, sectorMin, sectorMax, q }
}

export function bakeHeightfield(opts) {
  const { heightAt, radius, extent, N, codeVersion } = opts
  if (typeof heightAt !== 'function') throw new HeightfieldBakeError('bake-no-height-function', 'bakeHeightfield needs heightAt(dir)')
  if (!(radius > 0) || !Number.isFinite(radius)) throw new HeightfieldBakeError('bake-radius', `radius must be a positive finite number, got ${radius}`)
  if (!(extent > 0) || !Number.isFinite(extent)) throw new HeightfieldBakeError('bake-extent', `extent must be a positive finite number of metres, got ${extent}`)
  if (!Number.isInteger(N) || N < 2) throw new HeightfieldBakeError('bake-n-too-small', `N must be an integer of at least 2, got ${N}`)
  if (typeof codeVersion !== 'string' || codeVersion === '') throw new HeightfieldBakeError('bake-no-code-version', 'a bake is stamped with the code version of its source closure, pass heightfieldCodeVersion(...)')
  const { up, east, north } = tangentBasis(opts.anchorDir ?? [0, 1, 0])
  const center = opts.center ?? [0, 0]
  const step = extent / (N - 1)
  const half = extent / 2
  const heights = new Float64Array(N * N)
  const dir = [0, 0, 0]
  for (let iz = 0; iz < N; iz++) {
    const z = center[1] - half + iz * step
    for (let ix = 0; ix < N; ix++) {
      const x = center[0] - half + ix * step
      dir[0] = radius * up[0] + x * east[0] + z * north[0]
      dir[1] = radius * up[1] + x * east[1] + z * north[1]
      dir[2] = radius * up[2] + x * east[2] + z * north[2]
      heights[iz * N + ix] = heightAt(dir)
    }
  }
  const packed = quantizeSectors(heights, N, opts.nodesPerSector ?? DEFAULT_NODES_PER_SECTOR, opts.bits ?? DEFAULT_BAKE_BITS)
  return {
    N,
    extent,
    center: [center[0], center[1]],
    anchorDir: up,
    radius,
    reliefScale: opts.reliefScale,
    anchorHeight: heightAt(up),
    seed: opts.seed,
    hashVersion: opts.hashVersion,
    terrainKey: opts.terrainKey,
    codeVersion,
    ...packed,
  }
}
