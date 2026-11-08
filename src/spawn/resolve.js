import { uuidToHex } from './ids.js'

export const parseResolve = (text) => {
  const body = JSON.parse(text)
  if (body.ok !== true || body.result === null || typeof body.result !== 'object') throw new RangeError('resolve response is not ok')
  const { result } = body
  if (result.type === 'not_found') return { type: 'not_found' }
  if (result.type !== 'found') throw new RangeError('unsupported resolve result type ' + result.type)
  const worldHex = uuidToHex(result.worldId)
  return { type: 'found', appId: result.appId, worldId: result.worldId, worldHex }
}

const REDIRECT_BODY = 'Redirecting...'
const REDIRECT_STATUSES = [307, 308]

export const classifyResolve = ({ status, location = null, text }) => {
  if (status === 200) return parseResolve(text)
  if (REDIRECT_STATUSES.includes(status)) {
    if (text.trim() !== REDIRECT_BODY) throw new RangeError('resolve redirect ' + status + ' has an unexpected body: ' + JSON.stringify(text))
    if (typeof location !== 'string' || location === '') throw new RangeError('resolve redirect ' + status + ' has no location')
    return { type: 'redirect', status, location }
  }
  if (status === 410) throw new RangeError('resolve returned 410 gone; no body has been captured, so it is not classified')
  throw new RangeError('unexpected resolve status ' + status)
}
