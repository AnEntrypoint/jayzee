import { parseGlb, readStandardPrimitive } from '../physics-extras/glb.js'
import { resolveWithinRoot } from '../sandbox/paths.js'

export const PROGRESSIVE_LOD_KEY = 'EP_progressive_lod'
export const PROGRESSIVE_BAKE_VERSION = 1
export const DEFAULT_LOD_RATIOS = Object.freeze([1, 0.5, 0.25, 0.125])
export const LOD_FILE_MAGIC = 0x444f4c4a
export const LOD_FILE_VERSION = 1
export const LOD_HEADER_BYTES = 20
export const BAKE_REFUSAL = Object.freeze({
  INPUT: 'progressive-bake-input',
  RATIOS: 'progressive-bake-ratios',
  NAME: 'progressive-bake-name',
  DRACO: 'progressive-bake-draco',
  SIMPLIFY: 'progressive-bake-simplify',
  LOD_FILE: 'progressive-bake-lod-file',
  PATH: 'progressive-bake-path',
})

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const TRIANGLES = 4
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

const refuse = (code, message) => {
  const error = new Error(code + ': ' + message)
  error.code = code
  throw error
}

export function encodeLodFile({ positions, indices }) {
  if (!(positions instanceof Float32Array) || positions.length % 3 !== 0) refuse(BAKE_REFUSAL.LOD_FILE, 'positions must be a Float32Array of xyz triples')
  if (!(indices instanceof Uint32Array) || indices.length % 3 !== 0) refuse(BAKE_REFUSAL.LOD_FILE, 'indices must be a Uint32Array of triangle triples')
  const vertexCount = positions.length / 3
  const indexWidth = vertexCount <= 0x10000 ? 2 : 4
  const indexBytes = indices.length * indexWidth
  const padded = (indexBytes + 3) & ~3
  const bytes = new Uint8Array(LOD_HEADER_BYTES + positions.byteLength + padded)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, LOD_FILE_MAGIC, true)
  view.setUint32(4, LOD_FILE_VERSION, true)
  view.setUint32(8, vertexCount, true)
  view.setUint32(12, indices.length, true)
  view.setUint32(16, indexWidth, true)
  let at = LOD_HEADER_BYTES
  for (let i = 0; i < positions.length; i++, at += 4) view.setFloat32(at, positions[i], true)
  for (let i = 0; i < indices.length; i++, at += indexWidth) {
    if (indices[i] >= vertexCount) refuse(BAKE_REFUSAL.LOD_FILE, 'index ' + i + ' names vertex ' + indices[i] + ' of ' + vertexCount)
    if (indexWidth === 2) view.setUint16(at, indices[i], true)
    else view.setUint32(at, indices[i], true)
  }
  return bytes
}

export function decodeLodFile(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < LOD_HEADER_BYTES) refuse(BAKE_REFUSAL.LOD_FILE, 'a LOD file is at least ' + LOD_HEADER_BYTES + ' bytes')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== LOD_FILE_MAGIC) refuse(BAKE_REFUSAL.LOD_FILE, 'the LOD file magic is wrong')
  if (view.getUint32(4, true) !== LOD_FILE_VERSION) refuse(BAKE_REFUSAL.LOD_FILE, 'LOD file version ' + view.getUint32(4, true) + ' is not ' + LOD_FILE_VERSION)
  const vertexCount = view.getUint32(8, true)
  const indexCount = view.getUint32(12, true)
  const indexWidth = view.getUint32(16, true)
  if (indexWidth !== 2 && indexWidth !== 4) refuse(BAKE_REFUSAL.LOD_FILE, 'index width ' + indexWidth + ' is not 2 or 4')
  const need = LOD_HEADER_BYTES + vertexCount * 12 + ((indexCount * indexWidth + 3) & ~3)
  if (bytes.length !== need) refuse(BAKE_REFUSAL.LOD_FILE, 'the LOD file is ' + bytes.length + ' bytes, its header gives ' + need)
  const positions = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(indexCount)
  let at = LOD_HEADER_BYTES
  for (let i = 0; i < positions.length; i++, at += 4) positions[i] = view.getFloat32(at, true)
  for (let i = 0; i < indexCount; i++, at += indexWidth) {
    indices[i] = indexWidth === 2 ? view.getUint16(at, true) : view.getUint32(at, true)
    if (indices[i] >= vertexCount) refuse(BAKE_REFUSAL.LOD_FILE, 'index ' + i + ' names vertex ' + indices[i] + ' of ' + vertexCount)
  }
  return { positions, indices, vertexCount, indexCount }
}

export function compactMesh(positions, indices) {
  const remap = new Int32Array(positions.length / 3).fill(-1)
  const outIndices = new Uint32Array(indices.length)
  let used = 0
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    if (remap[v] === -1) remap[v] = used++
    outIndices[i] = remap[v]
  }
  const outPositions = new Float32Array(used * 3)
  for (let v = 0; v < remap.length; v++) {
    const to = remap[v]
    if (to === -1) continue
    outPositions[to * 3] = positions[v * 3]
    outPositions[to * 3 + 1] = positions[v * 3 + 1]
    outPositions[to * 3 + 2] = positions[v * 3 + 2]
  }
  return { positions: outPositions, indices: outIndices }
}

export function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = positions[i + k]
      if (value < min[k]) min[k] = value
      if (value > max[k]) max[k] = value
    }
  }
  return { min, max }
}

const checkRatios = (ratios) => {
  if (!Array.isArray(ratios) || ratios.length === 0) refuse(BAKE_REFUSAL.RATIOS, 'ratios must be a non-empty list')
  const seen = new Set()
  for (const ratio of ratios) {
    if (!(typeof ratio === 'number' && ratio > 0 && ratio <= 1)) refuse(BAKE_REFUSAL.RATIOS, 'ratio ' + String(ratio) + ' is not above 0 and at most 1')
    if (seen.has(ratio)) refuse(BAKE_REFUSAL.RATIOS, 'ratio ' + ratio + ' is listed twice')
    seen.add(ratio)
  }
  if (!seen.has(1)) refuse(BAKE_REFUSAL.RATIOS, 'ratios must include 1, the source mesh')
  return [...ratios].sort((a, b) => b - a)
}

export function injectExtension(glb, extension) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  if (glb.length < 20 || view.getUint32(0, true) !== GLB_MAGIC) refuse(BAKE_REFUSAL.INPUT, 'the source is not a GLB file')
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)))
  json.extensions = { ...(json.extensions || {}), [PROGRESSIVE_LOD_KEY]: extension }
  const used = new Set(json.extensionsUsed || [])
  used.add(PROGRESSIVE_LOD_KEY)
  json.extensionsUsed = [...used]
  const text = new TextEncoder().encode(JSON.stringify(json))
  const padded = (text.length + 3) & ~3
  const rest = glb.subarray(20 + jsonLength)
  const out = new Uint8Array(20 + padded + rest.length)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, GLB_MAGIC, true)
  outView.setUint32(4, view.getUint32(4, true), true)
  outView.setUint32(8, out.length, true)
  outView.setUint32(12, padded, true)
  outView.setUint32(16, JSON_CHUNK, true)
  out.fill(0x20, 20, 20 + padded)
  out.set(text, 20)
  out.set(rest, 20 + padded)
  return out
}

export function bakeProgressiveLod({ glb, baseName, ratios = DEFAULT_LOD_RATIOS, simplify }) {
  if (!(glb instanceof Uint8Array)) refuse(BAKE_REFUSAL.INPUT, 'the source must be a Uint8Array holding a GLB file')
  if (typeof baseName !== 'string' || !NAME_PATTERN.test(baseName)) refuse(BAKE_REFUSAL.NAME, 'baseName must be lower-case letters, digits, dot, dash or underscore, got ' + JSON.stringify(baseName))
  if (typeof simplify !== 'function') refuse(BAKE_REFUSAL.SIMPLIFY, 'bakeProgressiveLod needs a simplify function')
  const ordered = checkRatios(ratios)
  let container
  try {
    container = parseGlb(glb)
  } catch (error) {
    refuse(BAKE_REFUSAL.INPUT, error.message)
  }
  const { json, binOffset } = container
  const files = new Map()
  const meshes = []
  const skipped = []
  const cache = new Map()
  const sourceMeshes = json.meshes || []
  for (let meshIndex = 0; meshIndex < sourceMeshes.length; meshIndex++) {
    const primitives = sourceMeshes[meshIndex].primitives || []
    for (let primIndex = 0; primIndex < primitives.length; primIndex++) {
      const primitive = primitives[primIndex]
      if (primitive.extensions?.KHR_draco_mesh_compression) refuse(BAKE_REFUSAL.DRACO, 'mesh ' + meshIndex + ' primitive ' + primIndex + ' is Draco-compressed and needs the decoder first')
      if ((primitive.mode ?? TRIANGLES) !== TRIANGLES || primitive.attributes?.POSITION === undefined) {
        skipped.push({ meshIndex, primIndex, reason: 'not-a-triangle-list' })
        continue
      }
      const source = readStandardPrimitive(glb, json, primitive, binOffset, sourceMeshes[meshIndex].name, cache)
      let indices = source.indices
      if (indices === null) {
        indices = new Uint32Array(source.vertexCount - (source.vertexCount % 3))
        for (let i = 0; i < indices.length; i++) indices[i] = i
      }
      if (indices.length < 3) {
        skipped.push({ meshIndex, primIndex, reason: 'no-triangles' })
        continue
      }
      const kind = primitive.attributes.TEXCOORD_0 !== undefined ? 'textured' : primitive.attributes.COLOR_0 !== undefined ? 'vertcolor' : 'unskinned'
      const lods = []
      let previousCount = indices.length
      for (let level = 0; level < ordered.length; level++) {
        const ratio = ordered[level]
        if (ratio === 1) {
          const full = boundsOf(source.vertices)
          lods.push({ ratio: 1, kind, inline: true, indexCount: indices.length, vertexCount: source.vertexCount, bytes: 0, decodeAABB: full })
          continue
        }
        const target = Math.max(3, Math.floor((indices.length / 3) * ratio) * 3)
        const reduced = simplify(indices, source.vertices, target)
        if (!(reduced instanceof Uint32Array) || reduced.length % 3 !== 0) refuse(BAKE_REFUSAL.SIMPLIFY, 'simplify must return a Uint32Array of triangle triples')
        if (reduced.length === 0 || reduced.length >= previousCount) continue
        previousCount = reduced.length
        const compact = compactMesh(source.vertices, reduced)
        const bytes = encodeLodFile(compact)
        const path = baseName + '.m' + meshIndex + 'p' + primIndex + '.r' + String(Math.round(ratio * 1000)).padStart(4, '0') + '.lod'
        files.set(path, bytes)
        lods.push({ ratio, kind, inline: false, path, indexCount: compact.indices.length, vertexCount: compact.positions.length / 3, bytes: bytes.length, decodeAABB: boundsOf(compact.positions) })
      }
      meshes.push({ meshIndex, primIndex, lods })
    }
  }
  const extension = { version: PROGRESSIVE_BAKE_VERSION, storage: 'sibling-file', meshes }
  return { extension, files, skipped, glb: injectExtension(glb, extension) }
}

export function createMeshoptSimplify(simplifier, { targetError = 1, lockBorder = false } = {}) {
  if (typeof simplifier?.simplify !== 'function') refuse(BAKE_REFUSAL.SIMPLIFY, 'createMeshoptSimplify needs the meshoptimizer simplifier')
  const flags = lockBorder ? ['LockBorder'] : []
  return (indices, positions, targetIndexCount) => simplifier.simplify(indices, positions, 3, targetIndexCount, targetError, flags)[0]
}

export const isContainedPath = (root, candidate) => resolveWithinRoot(root, candidate) !== null

export async function resolveBakedFile(root, relPath, { realpath }) {
  if (typeof realpath !== 'function') throw new TypeError('resolveBakedFile needs a realpath function')
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.includes('\0')) return null
  const target = resolveWithinRoot(root, relPath)
  if (target === null) return null
  let realRoot
  let realTarget
  try {
    realRoot = await realpath(root)
    realTarget = await realpath(target)
  } catch {
    return null
  }
  return resolveWithinRoot(realRoot, realTarget) === null ? null : realTarget
}

export async function writeBake({ root, dir = '.', result, fs }) {
  for (const method of ['mkdir', 'writeFile']) {
    if (typeof fs?.[method] !== 'function') throw new TypeError('writeBake needs fs.' + method)
  }
  const base = resolveWithinRoot(root, dir)
  if (base === null) refuse(BAKE_REFUSAL.PATH, 'bake directory ' + JSON.stringify(dir) + ' leaves the served root')
  await fs.mkdir(base, { recursive: true })
  const written = []
  for (const [path, bytes] of result.files) {
    const target = resolveWithinRoot(base, path)
    if (target === null || target === base) refuse(BAKE_REFUSAL.PATH, 'bake file ' + JSON.stringify(path) + ' leaves the bake directory')
    await fs.writeFile(target, bytes)
    written.push(target)
  }
  return written
}
