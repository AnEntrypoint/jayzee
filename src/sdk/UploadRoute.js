import { timingSafeTokenEqual } from '../sandbox/authCompare.js'
import { createUploadHandler } from './UploadHandler.js'

export const UPLOAD_PATH = '/upload-model'

const BEARER = /^Bearer (.+)$/i

const presentedToken = (header) => {
  const match = typeof header === 'string' ? BEARER.exec(header) : null
  return match === null ? null : match[1]
}

const refuse = (res, status, message, headers = {}) => {
  res.writeHead(status, { Connection: 'close', ...headers })
  res.end(message)
}

export function createUploadRoute({ modelsDir, env = process.env }) {
  const handleUpload = createUploadHandler({ modelsDir })
  return function handleUploadRoute(req, res) {
    if (req.method !== 'POST') {
      refuse(res, 405, 'method not allowed', { Allow: 'POST' })
      return
    }
    const token = env.UPLOAD_TOKEN
    if (typeof token !== 'string' || token.length === 0) {
      refuse(res, 503, 'uploads are disabled: UPLOAD_TOKEN is unset or empty')
      return
    }
    const presented = presentedToken(req.headers.authorization)
    if (presented === null || !timingSafeTokenEqual(presented, token)) {
      refuse(res, 401, 'unauthorized: send Authorization: Bearer with the UPLOAD_TOKEN', { 'WWW-Authenticate': 'Bearer' })
      return
    }
    handleUpload(req, res)
  }
}
