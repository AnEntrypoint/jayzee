import { uuidToHex } from './ids.js'

export const parseResolve = (text) => {
  const body = JSON.parse(text)
  if (body.ok !== true || body.result === null || typeof body.result !== 'object') throw new RangeError('resolve response is not ok')
  const { result } = body
  if (result.type !== 'found') throw new RangeError('unsupported resolve result type ' + result.type)
  const worldHex = uuidToHex(result.worldId)
  return { type: 'found', appId: result.appId, worldId: result.worldId, worldHex }
}
