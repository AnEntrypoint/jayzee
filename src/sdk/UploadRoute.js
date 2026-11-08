import { uploadTokenVerdict } from './uploadToken.js'
import { createUploadHandler } from './UploadHandler.js'

export const UPLOAD_PATH = '/upload-model'

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
    const verdict = uploadTokenVerdict(env, req.headers.authorization)
    if (verdict === 'unset') {
      refuse(res, 503, 'uploads are disabled: UPLOAD_TOKEN is unset or empty')
      return
    }
    if (verdict === 'wrong') {
      refuse(res, 401, 'unauthorized: send Authorization: Bearer with the UPLOAD_TOKEN', { 'WWW-Authenticate': 'Bearer' })
      return
    }
    handleUpload(req, res)
  }
}
