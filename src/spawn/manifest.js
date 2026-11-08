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
