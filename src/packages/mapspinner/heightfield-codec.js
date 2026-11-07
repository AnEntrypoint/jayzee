const MAGIC = 0x48464d31
const JSON_PAD_BYTE = 0x20
const PREFIX_BYTES = 8
const SUPPORTED_BITS = [8, 16]

function assertBits(bits) {
  if (!SUPPORTED_BITS.includes(bits)) throw new RangeError(`heightfield quantization must be one of ${SUPPORTED_BITS.join(' or ')} bits, got ${bits}: any other width quantizes to a wider range than the stored array can hold and decodes as wrapped garbage`)
  return bits
}

function headerJson(a, gridS, bits) {
  return JSON.stringify({
    N: a.N,
    extent: a.extent,
    center: a.center,
    anchorDir: a.anchorDir,
    radius: a.radius,
    reliefScale: a.reliefScale,
    anchorHeight: a.anchorHeight,
    seed: a.seed,
    hashVersion: a.hashVersion,
    terrainKey: a.terrainKey,
    codeVersion: a.codeVersion,
    sectors: { gridS, nodesPerSector: a.sectors.nodesPerSector, bits },
  })
}

function writeFloats(buffer, offset, count, values) {
  const out = new Float32Array(buffer, offset, count)
  for (let i = 0; i < count; i++) out[i] = values[i]
}

export function encodeHeightfield(a) {
  const { N } = a
  const gridS = a.sectors.gridS
  const bits = assertBits(a.sectors.bits || 8)
  const sectorCount = gridS * gridS
  const headerBytes = new TextEncoder().encode(headerJson(a, gridS, bits))
  const headerPad = (4 - ((PREFIX_BYTES + headerBytes.length) & 3)) & 3
  const headerLength = headerBytes.length + headerPad
  const nodeBytes = (bits === 16 ? 2 : 1) * N * N
  const buffer = new ArrayBuffer(PREFIX_BYTES + headerLength + 4 * sectorCount * 2 + nodeBytes)
  const view = new DataView(buffer)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, headerLength, true)
  const bytes = new Uint8Array(buffer)
  bytes.set(headerBytes, PREFIX_BYTES)
  bytes.fill(JSON_PAD_BYTE, PREFIX_BYTES + headerBytes.length, PREFIX_BYTES + headerLength)
  let offset = PREFIX_BYTES + headerLength
  writeFloats(buffer, offset, sectorCount, a.sectorMin)
  offset += 4 * sectorCount
  writeFloats(buffer, offset, sectorCount, a.sectorMax)
  offset += 4 * sectorCount
  if (bits === 16) {
    const codes = new Uint16Array(buffer, offset, N * N)
    for (let i = 0; i < N * N; i++) codes[i] = a.q[i]
  } else {
    const codes = new Uint8Array(buffer, offset, N * N)
    for (let i = 0; i < N * N; i++) codes[i] = a.q[i]
  }
  return buffer
}

export function decodeHeightfield(buffer) {
  if (!buffer || buffer.byteLength < PREFIX_BYTES) return null
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== MAGIC) return null
  const headerLength = view.getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, PREFIX_BYTES, headerLength)))
  const { N, sectors } = header
  const gridS = sectors.gridS
  const bits = assertBits(sectors.bits || 8)
  const sectorCount = gridS * gridS
  let offset = PREFIX_BYTES + headerLength
  const sectorMin = new Float32Array(buffer, offset, sectorCount)
  offset += 4 * sectorCount
  const sectorMax = new Float32Array(buffer, offset, sectorCount)
  offset += 4 * sectorCount
  const q = bits === 16 ? new Uint16Array(buffer, offset, N * N) : new Uint8Array(buffer, offset, N * N)
  return {
    ...header,
    sectors: { gridS, nodesPerSector: sectors.nodesPerSector, qmax: (1 << bits) - 1, bits },
    sectorMin,
    sectorMax,
    q,
  }
}
