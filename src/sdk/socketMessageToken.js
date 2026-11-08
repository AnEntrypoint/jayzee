import { timingSafeTokenEqual } from '../sandbox/authCompare.js'
import { MSG } from '../protocol/messages.js'

export const EDITOR_ONLY_TYPES = Object.freeze(new Set([MSG.EDITOR_UPDATE, MSG.EDITOR_SELECT, MSG.GET_EDITOR_PROPS]))

export function authEditorVerdict(env, payload) {
  const token = env.EDITOR_TOKEN
  if (typeof token !== 'string' || token.length === 0) return 'unset'
  const presented = payload !== null && typeof payload === 'object' ? payload.token : undefined
  return timingSafeTokenEqual(presented, token) ? 'ok' : 'wrong'
}

export function messageRefusal(connection, type) {
  if (!EDITOR_ONLY_TYPES.has(type)) return null
  return connection.isEditor === true ? null : 'editor-auth-required'
}
