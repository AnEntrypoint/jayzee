import { gridDecimate } from './grid-decimate.js'
import { PROGRESSIVE_LOD_KEY } from './model-pool.js'

export const PROGRESSIVE_BAKE_VERSION = 1
export const LOD_PAYLOAD_MAGIC = 0x444f4c50
export const DEFAULT_BAKE_RATIOS = Object.freeze([0.05, 0.25, 1])
export const BAKE_REFUSAL = Object.freeze({
  OPTION: 'progressive-bake-option',
  NAME: 'progressive-bake-name',
  PATH: 'progressive-bake-path-outside-root',
  MESH: 'progressive-bake-mesh',
  RATIOS: 'progressive-bake-ratios',
  PAYLOAD: 'progressive-bake-payload',
})

const PAYLOAD_HEADER_BYTES = 16
const QUANT_MAX = 65535
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const COMPONENT_FLOAT = 5126
const COMPONENT_UINT32 = 5125
const TARGET_ARRAY_BUFFER = 34962
const TARGET_ELEMENT_ARRAY_BUFFER = 34963

export class ProgressiveBakeError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'ProgressiveBakeError'
    this.code = code
  }
}

const refuse = (code, message) => {
  throw new ProgressiveBakeError(code, message)
}

const positionAttribute = (positions) => ({
  count: positions.length / 3,
  itemSize: 3,
  getX: (i) => positions[i * 3],
  getY: (i) => positions[i * 3 + 1],
  getZ: (i) => positions[i * 3 + 2],
})

function compacted(positions, indices) {
  const remap = new Int32Array(positions.length / 3).fill(-1)
  const outIndex = new Uint32Array(indices.length)
  let count = 0
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    if (remap[v] === -1) remap[v] = count++
    outIndex[i] = remap[v]
  }
  const outPositions = new Float32Array(count * 3)
  for (let v = 0; v < remap.length; v++) {
    const to = remap[v]
    if (to === -1) continue
    outPositions[to * 3] = positions[v * 3]
    outPositions[to * 3 + 1] = positions[v * 3 + 1]
    outPositions[to * 3 + 2] = positions[v * 3 + 2]
  }
  return { positions: outPositions, indices: outIndex }
}

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  return { min, max }
}

export function decimateToRatio(positions, indices, ratio) {
  const source = compacted(positions, indices)
  if (ratio >= 1) return source
  const triCap = Math.max(1, Math.floor((indices.length / 3) * ratio))
  const decimated = gridDecimate({ position: positionAttribute(source.positions) }, source.indices, triCap)
  if (decimated === null) return source
  return compacted(decimated.attributes.position.array, decimated.index)
}

export function encodeLodPayload(positions, indices, aabb) {
  const vertexCount = positions.length / 3
  const wide = vertexCount > 65536
  const indexBytes = indices.length * (wide ? 4 : 2)
  const positionBytes = vertexCount * 6
  const padded = (positionBytes + 3) & ~3
  const bytes = new Uint8Array(PAYLOAD_HEADER_BYTES + padded + indexBytes)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, LOD_PAYLOAD_MAGIC, true)
  view.setUint32(4, PROGRESSIVE_BAKE_VERSION | (wide ? 0x10000 : 0), true)
  view.setUint32(8, vertexCount, true)
  view.setUint32(12, indices.length, true)
  let offset = PAYLOAD_HEADER_BYTES
  for (let i = 0; i < vertexCount; i++) {
    for (let k = 0; k < 3; k++) {
      const span = aabb.max[k] - aabb.min[k]
      const t = span > 0 ? (positions[i * 3 + k] - aabb.min[k]) / span : 0
      view.setUint16(offset, Math.max(0, Math.min(QUANT_MAX, Math.round(t * QUANT_MAX))), true)
      offset += 2
    }
  }
  offset = PAYLOAD_HEADER_BYTES + padded
  for (let i = 0; i < indices.length; i++) {
    if (wide) view.setUint32(offset + i * 4, indices[i], true)
    else view.setUint16(offset + i * 2, indices[i], true)
  }
  return bytes
}

export function decodeLodPayload(bytes, aabb) {
  if (!(bytes instanceof Uint8Array) || bytes.length < PAYLOAD_HEADER_BYTES) refuse(BAKE_REFUSAL.PAYLOAD, 'a LOD payload is at least its 16 byte header')
  if (!aabb || !Array.isArray(aabb.min) || !Array.isArray(aabb.max)) refuse(BAKE_REFUSAL.PAYLOAD, 'a LOD payload decodes against the decodeAABB of its record')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== LOD_PAYLOAD_MAGIC) refuse(BAKE_REFUSAL.PAYLOAD, 'the bytes do not start with the LOD payload magic')
  const flags = view.getUint32(4, true)
  if ((flags & 0xffff) !== PROGRESSIVE_BAKE_VERSION) refuse(BAKE_REFUSAL.PAYLOAD, 'payload version ' + (flags & 0xffff) + ' is not ' + PROGRESSIVE_BAKE_VERSION)
  const wide = (flags & 0x10000) !== 0
  const vertexCount = view.getUint32(8, true)
  const indexCount = view.getUint32(12, true)
  const padded = (vertexCount * 6 + 3) & ~3
  const expected = PAYLOAD_HEADER_BYTES + padded + indexCount * (wide ? 4 : 2)
  if (bytes.length !== expected) refuse(BAKE_REFUSAL.PAYLOAD, 'the payload is ' + bytes.length + ' bytes, its header declares ' + expected)
  const positions = new Float32Array(vertexCount * 3)
  let offset = PAYLOAD_HEADER_BYTES
  for (let i = 0; i < vertexCount; i++) {
    for (let k = 0; k < 3; k++) {
      positions[i * 3 + k] = aabb.min[k] + (view.getUint16(offset, true) / QUANT_MAX) * (aabb.max[k] - aabb.min[k])
      offset += 2
    }
  }
  offset = PAYLOAD_HEADER_BYTES + padded
  const indices = new Uint32Array(indexCount)
  for (let i = 0; i < indexCount; i++) {
    indices[i] = wide ? view.getUint32(offset + i * 4, true) : view.getUint16(offset + i * 2, true)
    if (indices[i] >= vertexCount) refuse(BAKE_REFUSAL.PAYLOAD, 'index ' + indices[i] + ' is past the ' + vertexCount + ' vertices')
  }
  return { positions, indices }
}

function encodeGlb(json, bin) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonPadded = (jsonBytes.length + 3) & ~3
  const binPadded = (bin.length + 3) & ~3
  const total = 12 + 8 + jsonPadded + 8 + binPadded
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, GLB_VERSION, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonPadded, true)
  view.setUint32(16, CHUNK_JSON, true)
  bytes.fill(0x20, 20, 20 + jsonPadded)
  bytes.set(jsonBytes, 20)
  view.setUint32(20 + jsonPadded, binPadded, true)
  view.setUint32(24 + jsonPadded, CHUNK_BIN, true)
  bytes.set(bin, 28 + jsonPadded)
  return bytes
}

function checkedMesh(mesh, m) {
  if (!mesh || !(mesh.positions instanceof Float32Array) || mesh.positions.length === 0 || mesh.positions.length % 3 !== 0) refuse(BAKE_REFUSAL.MESH, 'meshes[' + m + '] needs a Float32Array of xyz positions')
  const vertexCount = mesh.positions.length / 3
  for (let i = 0; i < mesh.positions.length; i++) if (!Number.isFinite(mesh.positions[i])) refuse(BAKE_REFUSAL.MESH, 'meshes[' + m + '] position ' + i + ' is not finite')
  let indices = mesh.indices
  if (indices === undefined || indices === null) {
    indices = new Uint32Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) indices[i] = i
  }
  if (indices.length === 0 || indices.length % 3 !== 0) refuse(BAKE_REFUSAL.MESH, 'meshes[' + m + '] index count ' + indices.length + ' is not a positive multiple of three')
  for (let i = 0; i < indices.length; i++) if (!(indices[i] < vertexCount)) refuse(BAKE_REFUSAL.MESH, 'meshes[' + m + '] index ' + indices[i] + ' is past its ' + vertexCount + ' vertices')
  return { positions: mesh.positions, indices }
}

function checkedRatios(ratios) {
  if (!Array.isArray(ratios) || ratios.length === 0) refuse(BAKE_REFUSAL.RATIOS, 'ratios must be a non-empty list')
  for (let i = 0; i < ratios.length; i++) {
    if (!(ratios[i] > 0 && ratios[i] <= 1)) refuse(BAKE_REFUSAL.RATIOS, 'ratio ' + ratios[i] + ' is outside (0, 1]')
    if (i > 0 && !(ratios[i] > ratios[i - 1])) refuse(BAKE_REFUSAL.RATIOS, 'ratios must rise from coarse to fine')
  }
  return ratios
}

export function planProgressiveBake({ name, meshes, ratios = DEFAULT_BAKE_RATIOS }) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) refuse(BAKE_REFUSAL.NAME, 'the asset name ' + JSON.stringify(name ?? null) + ' must be letters, digits, dot, dash and underscore')
  if (!Array.isArray(meshes) || meshes.length === 0) refuse(BAKE_REFUSAL.MESH, 'a bake needs at least one mesh')
  checkedRatios(ratios)
  const files = []
  const gltfMeshes = []
  const accessors = []
  const bufferViews = []
  const binParts = []
  const records = []
  let binLength = 0
  const pushView = (bytes, target) => {
    const padded = (bytes.length + 3) & ~3
    const part = new Uint8Array(padded)
    part.set(bytes)
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.length, target })
    binParts.push(part)
    binLength += padded
    return bufferViews.length - 1
  }
  meshes.forEach((raw, m) => {
    const mesh = checkedMesh(raw, m)
    const lods = []
    let previousTriangles = -1
    ratios.forEach((ratio, level) => {
      const lod = decimateToRatio(mesh.positions, mesh.indices, ratio)
      const triangles = lod.indices.length / 3
      if (level > 0 && triangles === previousTriangles) return
      previousTriangles = triangles
      const aabb = boundsOf(lod.positions)
      if (lods.length === 0) {
        const positionView = pushView(new Uint8Array(lod.positions.buffer, lod.positions.byteOffset, lod.positions.byteLength), TARGET_ARRAY_BUFFER)
        const indexView = pushView(new Uint8Array(lod.indices.buffer, lod.indices.byteOffset, lod.indices.byteLength), TARGET_ELEMENT_ARRAY_BUFFER)
        accessors.push({ bufferView: positionView, componentType: COMPONENT_FLOAT, count: lod.positions.length / 3, type: 'VEC3', min: aabb.min, max: aabb.max })
        accessors.push({ bufferView: indexView, componentType: COMPONENT_UINT32, count: lod.indices.length, type: 'SCALAR' })
        gltfMeshes.push({ name: name + '-mesh-' + m, primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, mode: 4 }] })
        lods.push({ ratio, kind: 'unskinned', inline: true, indexCount: lod.indices.length, vertexCount: lod.positions.length / 3, bytes: lod.positions.byteLength + lod.indices.byteLength })
        return
      }
      const payload = encodeLodPayload(lod.positions, lod.indices, aabb)
      const path = name + '.m' + m + '.lod' + lods.length + '.bin'
      files.push({ path, bytes: payload })
      lods.push({ ratio, kind: 'unskinned', path, indexCount: lod.indices.length, vertexCount: lod.positions.length / 3, bytes: payload.length, decodeAABB: aabb })
    })
    records.push({ meshIndex: m, primIndex: 0, lods })
  })
  const bin = new Uint8Array(binLength)
  let offset = 0
  for (const part of binParts) {
    bin.set(part, offset)
    offset += part.length
  }
  const record = { version: PROGRESSIVE_BAKE_VERSION, storage: 'sibling-file', meshes: records }
  const json = {
    asset: { version: '2.0', generator: 'jayzee progressive bake ' + PROGRESSIVE_BAKE_VERSION },
    extensionsUsed: [PROGRESSIVE_LOD_KEY],
    extensions: { [PROGRESSIVE_LOD_KEY]: record },
    scene: 0,
    scenes: [{ nodes: gltfMeshes.map((_, i) => i) }],
    nodes: gltfMeshes.map((_, i) => ({ mesh: i })),
    meshes: gltfMeshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  }
  const root = { path: name + '.glb', bytes: encodeGlb(json, bin) }
  return { root, files: [root, ...files], record, json }
}

export function writeProgressiveBake(opts) {
  const { outDir, io, containedPath } = opts ?? {}
  if (typeof outDir !== 'string' || outDir === '') refuse(BAKE_REFUSAL.OPTION, 'a bake needs an output directory')
  if (!io || typeof io.writeFile !== 'function' || typeof io.mkdir !== 'function') refuse(BAKE_REFUSAL.OPTION, 'a bake needs io with writeFile(path, bytes) and mkdir(path)')
  if (typeof containedPath !== 'function') refuse(BAKE_REFUSAL.OPTION, 'a bake needs containedPath(root, candidate), the contained-path check')
  const plan = planProgressiveBake(opts)
  const targets = plan.files.map((file) => {
    const full = containedPath(outDir, file.path)
    if (full === null || full === undefined) refuse(BAKE_REFUSAL.PATH, 'output ' + JSON.stringify(file.path) + ' leaves ' + outDir)
    return { path: file.path, full, bytes: file.bytes }
  })
  io.mkdir(outDir)
  for (const target of targets) if (target.path !== plan.root.path) io.writeFile(target.full, target.bytes)
  const rootTarget = targets.find((t) => t.path === plan.root.path)
  io.writeFile(rootTarget.full, rootTarget.bytes)
  return { root: rootTarget.full, written: targets.map((t) => ({ path: t.path, full: t.full, bytes: t.bytes.length })), record: plan.record }
}
