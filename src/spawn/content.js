import { createHash } from 'node:crypto'

const HEX32 = /^[0-9a-f]{32}$/
const HEX40 = /^[0-9a-f]{40}$/
const HEX64 = /^[0-9a-f]{64}$/

export const WORLD_STORE_SCOPE = Object.freeze({
  head_not_found: 'absent world head; 3 of the 256 spawn-reported worlds were sampled, and the count was not re-counted (learning record section 7)',
  value_not_found: 'absent 64-hex hash on /values and /manifests; two absent hashes were tested on two paths (learning record section 7), not a rule for every absent hash',
  unknown_world_store_key: 'misspelled resource under a known world, one request (head.jsn; head.json on the same world is 200). The drifted-head case, manifest 3fa9a434, is not reproduced (200 on repeat), so its condition is OPEN',
})

export class WorldStoreError extends Error {
  constructor(key, status, context, bytes) {
    super(key + (context.path === undefined ? '' : ' at ' + context.path))
    this.name = 'WorldStoreError'
    this.key = key
    this.status = status
    this.bytes = bytes
    this.context = Object.freeze({ ...context })
    this.scope = WORLD_STORE_SCOPE[key]
  }
}

export class HeadNotFoundError extends WorldStoreError {
  constructor(status, context, bytes) {
    super('head_not_found', status, context, bytes)
    this.name = 'HeadNotFoundError'
  }
}

export class UnknownWorldStoreKeyError extends WorldStoreError {
  constructor(status, context, bytes) {
    super('unknown_world_store_key', status, context, bytes)
    this.name = 'UnknownWorldStoreKeyError'
  }
}

export class ValueNotFoundError extends WorldStoreError {
  constructor(status, context, bytes) {
    super('value_not_found', status, context, bytes)
    this.name = 'ValueNotFoundError'
  }
}

const NAMED_ERRORS = Object.freeze({
  head_not_found: HeadNotFoundError,
  unknown_world_store_key: UnknownWorldStoreKeyError,
  value_not_found: ValueNotFoundError,
})

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex')

export const verifyContent = (hash, bytes) => {
  if (typeof hash !== 'string' || !HEX64.test(hash)) throw new RangeError('content hash must be 64 lowercase hex characters')
  return sha256Hex(bytes) === hash
}

export const worldStoreError = (status, text, context = {}) => {
  if (status !== 404) throw new RangeError('world-store request returned status ' + status)
  const body = JSON.parse(text)
  const named = body !== null && typeof body === 'object' && Object.hasOwn(NAMED_ERRORS, body.error) ? NAMED_ERRORS[body.error] : null
  if (named === null) throw new RangeError('unexpected 404 body: ' + text)
  return new named(status, context, new TextEncoder().encode(text).length)
}

export const parseHeadResponse = (status, text, context = {}) => {
  if (status === 404) {
    const error = worldStoreError(status, text, context)
    if (error instanceof HeadNotFoundError) return { present: false, error }
    throw error
  }
  if (status !== 200) throw new RangeError('head request returned status ' + status)
  return { present: true, head: parseHead(text) }
}

export const parseHead = (text) => {
  const head = JSON.parse(text)
  if (head.v !== 1) throw new RangeError('unsupported head version ' + head.v)
  if (!HEX32.test(head.worldHex)) throw new RangeError('head worldHex must be 32 lowercase hex characters')
  if (!HEX40.test(head.commit) || !HEX40.test(head.tree)) throw new RangeError('head commit and tree must be 40 lowercase hex characters')
  if (!HEX64.test(head.manifest) || !HEX64.test(head.sheet)) throw new RangeError('head manifest and sheet must be 64 lowercase hex characters')
  if (!Number.isInteger(head.seq) || head.seq < 0) throw new RangeError('head seq must be a non-negative integer')
  return head
}
