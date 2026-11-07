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
