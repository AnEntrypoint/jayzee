import { createHash } from 'node:crypto'

const HEX32 = /^[0-9a-f]{32}$/
const HEX40 = /^[0-9a-f]{40}$/
const HEX64 = /^[0-9a-f]{64}$/

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex')

export const verifyContent = (hash, bytes) => {
  if (typeof hash !== 'string' || !HEX64.test(hash)) throw new RangeError('content hash must be 64 lowercase hex characters')
  return sha256Hex(bytes) === hash
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
