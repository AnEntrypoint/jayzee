import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const KTX2_IDENTIFIER = Uint8Array.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])
export const KTX2_HEADER_BYTES = 80
export const GLB_MAGIC = 0x46546c67
export const GLB_VERSION = 2
export const CHUNK_JSON = 0x4e4f534a
export const CHUNK_BIN = 0x004e4942
export const MESHOPT = 'EXT_meshopt_compression'
export const KTX2_MIME = 'image/ktx2'
export const MESHOPT_MODES = ['ATTRIBUTES', 'TRIANGLES', 'INDICES']

const GLB_HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8

const isObject = (value) => value !== null && typeof value === 'object'

export const isKtx2 = (bytes) => bytes.length >= KTX2_HEADER_BYTES && KTX2_IDENTIFIER.every((byte, i) => bytes[i] === byte)

export const isGlb = (bytes) => bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === GLB_MAGIC

export const parseGlb = (bytes) => {
  if (bytes.length < GLB_HEADER_BYTES + CHUNK_HEADER_BYTES) throw new RangeError('GLB is shorter than its header and first chunk header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new TypeError('not a GLB file')
  if (view.getUint32(4, true) !== GLB_VERSION) throw new TypeError('GLB version is not 2')
  if (view.getUint32(8, true) !== bytes.length) throw new RangeError('GLB length field does not match the file size')
  let json = null
  let bin = null
  let at = GLB_HEADER_BYTES
  while (at < bytes.length) {
    if (at + CHUNK_HEADER_BYTES > bytes.length) throw new RangeError('GLB chunk header runs past the end of the file')
    const length = view.getUint32(at, true)
    const type = view.getUint32(at + 4, true)
    const start = at + CHUNK_HEADER_BYTES
    if (length % 4 !== 0 || start + length > bytes.length) throw new RangeError('GLB chunk length is not a multiple of 4 or runs past the end')
    const body = bytes.subarray(start, start + length)
    if (type === CHUNK_JSON && json === null) json = JSON.parse(Buffer.from(body).toString('utf8'))
    else if (type === CHUNK_BIN && bin === null) bin = body
    else throw new TypeError('GLB has an unknown or repeated chunk type')
    at = start + length
  }
  if (!isObject(json)) throw new TypeError('GLB has no JSON object chunk')
  return { json, bin: bin ?? new Uint8Array(0) }
}

const meshoptOf = (view) => (isObject(view.extensions) ? view.extensions[MESHOPT] : undefined)

const checkMeshoptView = (view, index, buffers, reasons) => {
  const ext = meshoptOf(view)
  if (ext === undefined) {
    reasons.push('bufferView ' + index + ' holds mesh geometry and is not meshopt-compressed')
    return
  }
  if (!Number.isInteger(ext.buffer) || ext.buffer < 0 || ext.buffer >= buffers.length) {
    reasons.push('bufferView ' + index + ' is meshopt-compressed from a buffer that does not exist')
  } else if (buffers[ext.buffer].uri !== undefined) {
    reasons.push('bufferView ' + index + ' is meshopt-compressed from an external buffer')
  }
  for (const key of ['byteLength', 'byteStride', 'count']) {
    if (!Number.isInteger(ext[key]) || ext[key] < 1) reasons.push('bufferView ' + index + ' meshopt ' + key + ' is not a positive whole number')
  }
  if (!MESHOPT_MODES.includes(ext.mode)) reasons.push('bufferView ' + index + ' meshopt mode is not one of ' + MESHOPT_MODES.join(', '))
}

export const validateKtx2 = (bytes) => (isKtx2(bytes) ? [] : ['not a KTX2 file: the identifier or the 80-byte header is missing'])

export const validateGlb = (bytes) => {
  let parsed
  try {
    parsed = parseGlb(bytes)
  } catch (error) {
    return [error.message]
  }
  const { json, bin } = parsed
  const reasons = []
  const buffers = Array.isArray(json.buffers) ? json.buffers : []
  const views = Array.isArray(json.bufferViews) ? json.bufferViews : []
  const accessors = Array.isArray(json.accessors) ? json.accessors : []
  const images = Array.isArray(json.images) ? json.images : []
  const meshes = Array.isArray(json.meshes) ? json.meshes : []
  const used = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []
  buffers.forEach((buffer, i) => {
    if (buffer.uri !== undefined) reasons.push('buffer ' + i + ' is external (uri); pack it into the GLB')
    const fallback = isObject(buffer.extensions) && isObject(buffer.extensions[MESHOPT]) && buffer.extensions[MESHOPT].fallback === true
    if (i > 0 && buffer.uri === undefined && !fallback) reasons.push('buffer ' + i + ' has no data')
  })
  const accessorsUsed = new Set()
  meshes.forEach((mesh) => {
    const primitives = Array.isArray(mesh.primitives) ? mesh.primitives : []
    primitives.forEach((primitive) => {
      const attributes = isObject(primitive.attributes) ? Object.values(primitive.attributes) : []
      const indices = primitive.indices === undefined ? [] : [primitive.indices]
      for (const accessor of [...attributes, ...indices]) accessorsUsed.add(accessor)
    })
  })
  const viewsUsed = new Set()
  for (const accessorIndex of accessorsUsed) {
    const accessor = accessors[accessorIndex]
    if (accessor === undefined) reasons.push('a primitive uses accessor ' + accessorIndex + ' which does not exist')
    else if (accessor.bufferView === undefined) reasons.push('accessor ' + accessorIndex + ' has no bufferView')
    else viewsUsed.add(accessor.bufferView)
  }
  for (const viewIndex of viewsUsed) {
    const view = views[viewIndex]
    if (view === undefined) reasons.push('bufferView ' + viewIndex + ' does not exist')
    else checkMeshoptView(view, viewIndex, buffers, reasons)
  }
  if (viewsUsed.size > 0 && !used.includes(MESHOPT)) reasons.push('extensionsUsed does not list ' + MESHOPT)
  images.forEach((image, i) => {
    if (image.uri !== undefined) {
      reasons.push('image ' + i + ' is external (uri); embed it as a KTX2 bufferView')
      return
    }
    if (image.bufferView === undefined) {
      reasons.push('image ' + i + ' has no bufferView')
      return
    }
    if (image.mimeType !== KTX2_MIME) {
      reasons.push('image ' + i + ' is ' + (image.mimeType ?? 'untyped') + ', not KTX2')
      return
    }
    const view = views[image.bufferView]
    if (view === undefined) {
      reasons.push('image ' + i + ' names bufferView ' + image.bufferView + ' which does not exist')
      return
    }
    if (view.buffer !== 0) {
      reasons.push('image ' + i + ' is not in the GLB binary chunk')
      return
    }
    const start = view.byteOffset ?? 0
    const length = view.byteLength
    if (!Number.isInteger(length) || start + length > bin.length || !isKtx2(bin.subarray(start, start + length))) reasons.push('image ' + i + ' is not a KTX2 file')
  })
  return reasons
}

const expectedKind = (name) => (name.endsWith('.ktx2') ? 'ktx2' : name.endsWith('.glb') ? 'glb' : null)

export const validateAsset = (name, bytes) => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const kind = isKtx2(data) ? 'ktx2' : isGlb(data) ? 'glb' : null
  let reasons
  if (kind === null) reasons = ['not a KTX2 texture or a GLB model; JSON glTF and other image formats are refused']
  else if (expectedKind(name) !== null && expectedKind(name) !== kind) reasons = ['the file name says ' + expectedKind(name) + ' but the bytes are ' + kind]
  else reasons = kind === 'ktx2' ? validateKtx2(data) : validateGlb(data)
  return { name, ok: reasons.length === 0, reasons }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    console.error('usage: node tools/asset-pipeline/validate.mjs <file...>')
    process.exitCode = 2
  } else {
    let rejected = 0
    for (const path of paths) {
      const result = validateAsset(path, readFileSync(path))
      if (!result.ok) rejected += 1
      console.log((result.ok ? 'ACCEPT ' : 'REJECT ') + path + (result.ok ? '' : ': ' + result.reasons.join('; ')))
    }
    if (rejected > 0) process.exitCode = 1
  }
}
