import { uuidToHex } from './ids.js'

export const parseResolve = (text) => {
  const body = JSON.parse(text)
  if (body.ok !== true || body.result === null || typeof body.result !== 'object') throw new RangeError('resolve response is not ok')
  const { result } = body
  if (result.type === 'not_found') return { type: 'not_found' }
  if (result.type === 'redirect') return parseRenamed(result)
  if (result.type === 'gone') return parseGone(result)
  if (result.type !== 'found') throw new RangeError('unsupported resolve result type ' + result.type)
  const worldHex = uuidToHex(result.worldId)
  return { type: 'found', appId: result.appId, worldId: result.worldId, worldHex }
}

const requireStrings = (result, fields) => {
  for (const field of fields) {
    if (typeof result[field] !== 'string') throw new RangeError('resolve ' + result.type + ' result has no ' + field)
  }
}

const parseRenamed = (result) => {
  requireStrings(result, ['username', 'newAdventureName'])
  return { type: 'renamed', username: result.username, newAdventureName: result.newAdventureName }
}

const parseGone = (result) => {
  requireStrings(result, ['appName', 'username', 'adventureName', 'deletedAt'])
  return { type: 'gone', appName: result.appName, username: result.username, adventureName: result.adventureName, deletedAt: result.deletedAt }
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
  if (status === 410) throw new RangeError('resolve returned status 410, which the upstream spec does not document for this route; a deleted world is result.type gone under 200')
  throw new RangeError('unexpected resolve status ' + status)
}
