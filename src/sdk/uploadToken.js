import { timingSafeTokenEqual } from '../sandbox/authCompare.js'

const BEARER = /^Bearer (.+)$/i

const presentedToken = (header) => {
  const match = typeof header === 'string' ? BEARER.exec(header) : null
  return match === null ? null : match[1]
}

export function uploadTokenVerdict(env, authorization) {
  const token = env.UPLOAD_TOKEN
  if (typeof token !== 'string' || token.length === 0) return 'unset'
  const presented = presentedToken(authorization)
  return presented !== null && timingSafeTokenEqual(presented, token) ? 'ok' : 'wrong'
}
