import { decodeName, encodeName } from './cdnName.js'

const LEDGER_KEY = /^world\.assets\/([0-9a-f]{2})\/([^/]+)\.yaml$/
const CDN_VALUE = /^\/cdn\/value\.([0-9a-f]{64})\.([a-z0-9]+)$/
const FNV_OFFSET = 2166136261 | 0
const FNV_PRIME = 16777619
const KEY_NAME_LIMIT = 255

export const ledgerBucket = (name) => {
  if (typeof name !== 'string') throw new TypeError('ledger name must be a string')
  let hash = FNV_OFFSET
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), FNV_PRIME)
  return (hash >>> 24).toString(16).padStart(2, '0')
}

export const ledgerKey = (asset) => {
  const encoded = encodeName(asset) + '.yaml'
  if (encoded.length > KEY_NAME_LIMIT) throw new RangeError('ledger name is longer than 255 characters once encoded: ' + asset)
  return 'world.assets/' + ledgerBucket(asset) + '/' + encoded
}

export const parseLedgerKey = (key) => {
  const match = LEDGER_KEY.exec(key)
  if (!match) throw new RangeError('not a world.assets ledger key: ' + key)
  const asset = decodeName(match[2])
  if (ledgerKey(asset) !== key) throw new RangeError('ledger key ' + key + ' is not the key derived for ' + asset)
  return { bucket: match[1], asset }
}

export const cdnValue = (asset) => {
  const match = CDN_VALUE.exec(asset)
  if (!match) throw new RangeError('not a cdn value path: ' + asset)
  return { sha: match[1], ext: match[2] }
}
