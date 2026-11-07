import { decodeName } from './cdnName.js'

const LEDGER_KEY = /^world\.assets\/([0-9a-f]{2})\/([^/]+)\.yaml$/
const CDN_VALUE = /^\/cdn\/value\.([0-9a-f]{64})\.([a-z0-9]+)$/

export const parseLedgerKey = (key) => {
  const match = LEDGER_KEY.exec(key)
  if (!match) throw new RangeError('not a world.assets ledger key: ' + key)
  return { bucket: match[1], asset: decodeName(match[2]) }
}

export const cdnValue = (asset) => {
  const match = CDN_VALUE.exec(asset)
  if (!match) throw new RangeError('not a cdn value path: ' + asset)
  return { sha: match[1], ext: match[2] }
}
