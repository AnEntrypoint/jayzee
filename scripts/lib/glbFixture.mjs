const pad4 = (bytes, fill) => {
  const length = Math.ceil(bytes.length / 4) * 4
  const out = new Uint8Array(length).fill(fill)
  out.set(bytes)
  return out
}

const CUBE = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]
const CUBE_INDEX = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]

export const buildBoxGlb = (parts) => {
  const positions = new Uint8Array(new Float32Array(CUBE).buffer)
  const indices = new Uint8Array(new Uint16Array(CUBE_INDEX).buffer)
  const bin = new Uint8Array(positions.length + indices.length)
  bin.set(positions)
  bin.set(indices, positions.length)
  const materials = [...new Set(parts.map((part) => part.material).filter((name) => name !== undefined))]
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: indices.length }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    materials: materials.map((name) => ({ name })),
    meshes: parts.map((part, index) => ({ name: 'part' + index, primitives: [{ attributes: { POSITION: 0 }, indices: 1, ...(part.material === undefined ? {} : { material: materials.indexOf(part.material) }) }] })),
    nodes: parts.map((part, index) => ({ mesh: index, translation: part.translation, scale: part.scale })),
    scenes: [{ nodes: parts.map((part, index) => index) }],
    scene: 0,
  }
  const jsonBytes = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20)
  const binBytes = pad4(bin, 0)
  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonBytes.length, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  view.setUint32(20 + jsonBytes.length, binBytes.length, true)
  view.setUint32(24 + jsonBytes.length, 0x004e4942, true)
  out.set(binBytes, 28 + jsonBytes.length)
  return out
}
