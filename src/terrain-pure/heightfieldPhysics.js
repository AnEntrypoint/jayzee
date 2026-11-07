export const HF_MAGIC = 0x48464d31
export const HF_HEADER_BYTES = 8
export const HF_SUPPORTED_BITS = [8, 16]
export const LEGACY_HASH_VERSION = 0

export class BakedFieldError extends Error {
  constructor(url, why, code = 'bad-artifact', cause) {
    super('[baked-heightfield] ' + url + ': ' + why, cause ? { cause } : undefined)
    this.name = 'BakedFieldError'
    this.code = code
  }
}

export const bakedHashVersionOf = (artifact) => artifact.hashVersion ?? LEGACY_HASH_VERSION

export const bakedEpochOf = (artifact) => artifact.chartEpoch ?? 0

export const dequantizeSectors = (artifact) => {
  const { N, sectors, sectorMin, sectorMax, q } = artifact
  const sn = sectors.nodesPerSector
  const gridS = sectors.gridS
  const qmax = sectors.qmax
  const out = new Float32Array(N * N)
  for (let iz = 0; iz < N; iz++) {
    const sz = Math.min(Math.floor(iz / sn), gridS - 1)
    for (let ix = 0; ix < N; ix++) {
      const sx = Math.min(Math.floor(ix / sn), gridS - 1)
      const si = sz * gridS + sx
      const lo = sectorMin[si]
      const hi = sectorMax[si]
      const qv = q[iz * N + ix]
      out[iz * N + ix] = hi > lo ? lo + (qv / qmax) * (hi - lo) : lo
    }
  }
  return out
}

export const createHeightField = (artifact, opts = {}) => {
  const heights = artifact.sectors ? dequantizeSectors(artifact) : artifact.heights
  const { N, extent } = artifact
  const step = extent / (N - 1)
  const half = extent / 2
  const cx = (artifact.center && artifact.center[0]) || 0
  const cz = (artifact.center && artifact.center[1]) || 0
  const at = (ix, iz) => {
    const x = ix < 0 ? 0 : ix > N - 1 ? N - 1 : ix
    const z = iz < 0 ? 0 : iz > N - 1 ? N - 1 : iz
    const v = heights[z * N + x]
    return typeof v === 'number' ? v : 0
  }
  const chartEpoch = bakedEpochOf(artifact)
  const epochOf = typeof opts.epochOf === 'function' ? opts.epochOf : null
  const isCurrent = () => (epochOf === null ? true : epochOf() === chartEpoch)
  return {
    N,
    extent,
    center: [cx, cz],
    codeVersion: artifact.codeVersion,
    stepM: step,
    chartEpoch,
    isCurrent,
    covers: (x, z) => isCurrent() && Math.abs(x - cx) <= half && Math.abs(z - cz) <= half,
    heightAtLocal(x, z) {
      if (!isCurrent()) return NaN
      const fx = (x - cx + half) / step
      const fz = (z - cz + half) / step
      const ix = Math.floor(fx)
      const iz = Math.floor(fz)
      const tx = fx - ix
      const tz = fz - iz
      const h00 = at(ix, iz)
      const h10 = at(ix + 1, iz)
      const h01 = at(ix, iz + 1)
      const h11 = at(ix + 1, iz + 1)
      return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz
    },
  }
}

export const checkBakedJson = (url, json) => {
  if (!json || typeof json !== 'object') throw new BakedFieldError(url, 'malformed: expected a JSON object, got ' + JSON.stringify(json))
  const N = json.N
  if (!(N > 0)) throw new BakedFieldError(url, 'malformed: N is ' + JSON.stringify(N ?? null) + ', expected a positive sample count')
  const heights = json.heights
  const q = json.sectors ? json.sectors.q : undefined
  if (!Array.isArray(heights) && !Array.isArray(q)) throw new BakedFieldError(url, 'malformed: no height samples, expected an array at heights or at sectors.q')
  if (Array.isArray(heights) && heights.length !== N * N) throw new BakedFieldError(url, 'sample count mismatch: N=' + N + ' declares ' + N * N + ' heights, the array holds ' + heights.length)
  if (Array.isArray(q) && q.length !== N * N) throw new BakedFieldError(url, 'sample count mismatch: N=' + N + ' declares ' + N * N + ' quantized samples, sectors.q holds ' + q.length)
  return json
}

export const parseHeightfieldHeader = (url, bytes) => {
  if (!bytes || bytes.byteLength < HF_HEADER_BYTES) throw new BakedFieldError(url, 'truncated: ' + (bytes ? bytes.byteLength : 0) + ' bytes, a heightfield header alone is ' + HF_HEADER_BYTES + ' bytes')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint32(0, true)
  if (magic !== HF_MAGIC) throw new BakedFieldError(url, 'not a heightfield: bytes 0..3 are 0x' + magic.toString(16).padStart(8, '0') + ', expected magic 0x' + HF_MAGIC.toString(16))
  const hlen = view.getUint32(4, true)
  if (!(hlen > 0) || HF_HEADER_BYTES + hlen > bytes.byteLength) throw new BakedFieldError(url, 'malformed: the header-length field says ' + hlen + ' bytes, the file is ' + bytes.byteLength + ' bytes')
  let header
  try {
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HF_HEADER_BYTES, HF_HEADER_BYTES + hlen)))
  } catch (error) {
    throw new BakedFieldError(url, 'unreadable header: ' + (error && error.message ? error.message : error), 'bad-artifact', error)
  }
  const N = header && header.N
  if (!Number.isInteger(N) || N < 2) throw new BakedFieldError(url, 'malformed header: N is ' + JSON.stringify(N ?? null) + ', expected an integer >= 2')
  const sectors = header.sectors
  const gridS = sectors && sectors.gridS
  if (!sectors || !Number.isInteger(gridS) || gridS < 1 || !Number.isInteger(sectors.nodesPerSector)) {
    throw new BakedFieldError(url, 'malformed header: sectors is ' + JSON.stringify(sectors ?? null) + ', expected integer gridS >= 1 and nodesPerSector')
  }
  const bits = sectors.bits || 8
  if (!HF_SUPPORTED_BITS.includes(bits)) throw new BakedFieldError(url, 'malformed header: sectors.bits is ' + JSON.stringify(sectors.bits ?? null) + ', expected ' + HF_SUPPORTED_BITS.join(' or '))
  const expected = HF_HEADER_BYTES + hlen + 8 * gridS * gridS + (bits === 16 ? 2 : 1) * N * N
  if (bytes.byteLength !== expected) {
    const word = bytes.byteLength < expected ? 'truncated' : 'longer than declared'
    throw new BakedFieldError(url, word + ': the file is ' + bytes.byteLength + ' bytes, but N=' + N + ' with sectors.gridS=' + gridS + ' at ' + bits + '-bit samples is exactly ' + expected + ' bytes')
  }
  return { header, N, bits }
}

export const bakedTerrainMismatch = (artifact, tcfg, frame, keyOf) => {
  const bakedEpoch = artifact.chartEpoch ?? 0
  const liveEpoch = frame && Number.isFinite(frame.chartEpoch) ? frame.chartEpoch : 0
  if (bakedEpoch !== liveEpoch) return 'baked at chartEpoch ' + bakedEpoch + ', world frame is at chartEpoch ' + liveEpoch + ': the chart was reanchored'
  if (artifact.terrainKey !== undefined) {
    const key = keyOf(tcfg)
    return artifact.terrainKey === key ? null : 'terrain key ' + artifact.terrainKey + ' != world ' + key
  }
  if (artifact.radius !== tcfg.radius) return 'radius ' + artifact.radius + ' != world ' + tcfg.radius
  if ((artifact.reliefScale ?? null) !== (tcfg.reliefScale ?? null)) return 'reliefScale ' + artifact.reliefScale + ' != world ' + tcfg.reliefScale
  const unit = (v) => {
    const l = Math.hypot(...v)
    return v.map((c) => c / l)
  }
  const want = tcfg.anchorDir || [0, 1, 0]
  const sameDir = Array.isArray(artifact.anchorDir) && artifact.anchorDir.length === 3 && unit(artifact.anchorDir).every((v, i) => Math.abs(v - unit(want)[i]) < 1e-6)
  if (!sameDir) return 'anchorDir ' + JSON.stringify(artifact.anchorDir) + ' != world ' + JSON.stringify(tcfg.anchorDir)
  return null
}

export const resolveBakedField = ({ url, artifact, hashVersion, bakeCode = null, tcfg, frame, keyOf = () => undefined, epochOf }) => {
  if (!artifact) return { field: null, fallback: 'no-artifact' }
  const bakedVersion = bakedHashVersionOf(artifact)
  if (bakedVersion !== hashVersion) return { field: null, fallback: 'hashVersion ' + bakedVersion + ' != world ' + hashVersion }
  if (bakeCode !== null && artifact.codeVersion !== bakeCode) {
    throw new BakedFieldError(url, 'stale bake: stamped with height code version ' + JSON.stringify(artifact.codeVersion ?? null) + ', this tree bakes ' + bakeCode + ': the height-generating code changed under the artifact, re-bake it', 'stale-bake')
  }
  if (bakeCode === null && !artifact.codeVersion) return { field: null, fallback: 'no-code-version' }
  const mismatch = bakedTerrainMismatch(artifact, tcfg, frame, keyOf)
  if (mismatch) return { field: null, fallback: mismatch }
  const field = createHeightField(artifact, { epochOf: epochOf || (() => (frame && Number.isFinite(frame.chartEpoch) ? frame.chartEpoch : 0)) })
  field.codeVersionVerified = bakeCode !== null
  return { field, fallback: null }
}
