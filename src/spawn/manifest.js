import { gunzipSync } from 'node:zlib'
import { readFrames } from './frames.js'
import { sha256Hex } from './content.js'

export const parseManifest = (bytes, head = null) => {
  const frames = readFrames(bytes)
  if (frames.length < 2) throw new RangeError('manifest needs an index frame and a sheet frame, found ' + frames.length)
  const index = JSON.parse(frames[0].toString('utf8'))
  if (index.v !== 1) throw new RangeError('unsupported manifest index version ' + index.v)
  const sheetBytes = frames[1]
  const sheet = JSON.parse(sheetBytes.toString('utf8'))
  if (sheet.v !== 1) throw new RangeError('unsupported manifest sheet version ' + sheet.v)
  const sheetHash = sha256Hex(sheetBytes)
  if (head && head.sheet !== sheetHash) throw new RangeError('manifest sheet hash ' + sheetHash + ' does not match head.sheet ' + head.sheet)
  return { index, sheet, sheetHash, frames: frames.slice(2) }
}

export const bindFrames = (bytes) => {
  const frames = readFrames(bytes)
  if (frames.length < 2) throw new RangeError('manifest needs an index frame and a sheet frame, found ' + frames.length)
  const hashes = Object.values(JSON.parse(frames[0].toString('utf8')).hashes)
  const after = frames.slice(1)
  const mismatches = []
  after.forEach((frame, position) => {
    if (sha256Hex(frame) !== hashes[position]) mismatches.push({ position, frame: position + 1, json: isJson(frame) })
  })
  const boundHashes = new Set(after.map((frame) => sha256Hex(frame)))
  const hashesWithoutFrame = hashes.filter((hash) => !boundHashes.has(hash))
  return { framesAfterIndex: after.length, hashCount: hashes.length, mismatches, hashesWithoutFrame }
}

const isJson = (frame) => {
  try {
    JSON.parse(frame.toString('utf8'))
    return true
  } catch {
    return false
  }
}

const HEX64 = /^[0-9a-f]{64}$/
const GZIP_MAGIC = [0x1f, 0x8b]

const parseJson = (bytes) => {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    return undefined
  }
}

const isFileEntry = (value) => value !== null && typeof value === 'object' && typeof value.hash === 'string' && HEX64.test(value.hash) && Number.isInteger(value.size) && value.size >= 0
const isHashMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((hash) => typeof hash === 'string' && HEX64.test(hash))

const kindOfBody = (body) => {
  const json = parseJson(body)
  if (json === undefined || json === null || typeof json !== 'object' || Array.isArray(json)) return 'other'
  const entries = Object.values(json)
  if (entries.length > 0 && entries.every(isFileEntry)) return 'file-map'
  if (Number.isInteger(json.bytes) && Number.isInteger(json.values) && isHashMap(json.leaves)) return 'summary'
  if (entries.length > 0 && isHashMap(json)) return 'leaf-map'
  return 'other'
}

export const decodeFrame = (bytes) => {
  const gzipped = bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]
  const body = gzipped ? gunzipSync(bytes) : bytes
  return { encoding: gzipped ? 'gzip' : 'identity', body, kind: kindOfBody(body) }
}

export const parseFileMap = (bytes) => {
  const frame = decodeFrame(bytes)
  if (frame.kind !== 'file-map') throw new RangeError('frame is not a file map')
  return Object.entries(parseJson(frame.body)).map(([path, value]) => ({
    path,
    hash: value.hash,
    size: value.size,
    imports: Array.isArray(value.imports) ? value.imports : [],
  }))
}

export const parseSummary = (bytes) => {
  const frame = decodeFrame(bytes)
  if (frame.kind !== 'summary') throw new RangeError('frame is not a summary')
  const json = parseJson(frame.body)
  return { bytes: json.bytes, values: json.values, leaves: Object.entries(json.leaves).map(([path, hash]) => ({ path, hash })) }
}

export const parseLeafMap = (bytes) => {
  const frame = decodeFrame(bytes)
  if (frame.kind !== 'leaf-map') throw new RangeError('frame is not a leaf map')
  return Object.entries(parseJson(frame.body)).map(([path, hash]) => ({ path, hash }))
}
