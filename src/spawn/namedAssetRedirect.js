import { decodeName } from './cdnName.js'

export const GLTF_CONTENT_TYPE = 'model/gltf-binary'
export const GLTF_MAGIC = 'glTF'
export const REDIRECT_CODES = Object.freeze([301, 302, 303, 307, 308])
export const CDN_PREFIX = '/cdn/'
const YAML_SUFFIX = '.yaml'

export const servedCandidates = (fileKey) => {
  const name = fileKey.startsWith('/') ? fileKey : decodeName(fileKey)
  if (!name.startsWith(CDN_PREFIX)) throw new RangeError('not a /cdn/ key: ' + name)
  const rest = name.slice(CDN_PREFIX.length)
  if (rest.startsWith('value.')) return { kind: 'value', candidates: [name] }
  if (!rest.endsWith(YAML_SUFFIX)) throw new RangeError('named key must end in ' + YAML_SUFFIX + ': ' + name)
  return { kind: 'named', candidates: [name.slice(0, -YAML_SUFFIX.length)] }
}

const hostOf = (url) => {
  const match = /^https:\/\/([^/?#]+)/.exec(url)
  return match ? match[1] : null
}

const typeOf = (headers) => {
  const raw = headers && (headers['content-type'] || headers['Content-Type'])
  return raw ? raw.split(';')[0].trim() : null
}

export const resolveServedAsset = async (path, { origin, fetchHead, fetchRange = null, allowedHosts, retries = 1 }) => {
  if (!path.startsWith(CDN_PREFIX)) throw new RangeError('path must start with ' + CDN_PREFIX)
  if (!/^https:[/]{2}/.test(origin)) throw new RangeError('origin must be https')
  if (!Number.isInteger(retries) || retries < 0) throw new RangeError('retries must be a non-negative integer')
  let attempts = 0

  const head = async (url) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      attempts += 1
      try {
        return { status: await fetchHead(url) }
      } catch (error) {
        const timedOut = error && error.name === 'TimeoutError'
        if (!timedOut) return { error: 'network' }
        if (attempt === retries) return { error: 'timeout' }
      }
    }
    return { error: 'timeout' }
  }

  const refuse = (reason, url) => ({ ok: false, reason, url, attempts })

  const first = await head(origin + path)
  if (first.error) return refuse(first.error, origin + path)
  const firstUrl = origin + path
  let response = first.status
  let finalUrl = firstUrl
  let redirected = false

  if (response.status === 401) return refuse('refused-auth', firstUrl)

  if (REDIRECT_CODES.includes(response.status)) {
    const location = response.headers && response.headers.location
    if (!location) return refuse('redirect-without-location', firstUrl)
    const host = hostOf(location)
    if (host === null || !allowedHosts.includes(host)) return refuse('redirect-host-not-allowed', location)
    redirected = true
    finalUrl = location
    const second = await head(location)
    if (second.error) return refuse(second.error, location)
    response = second.status
    if (REDIRECT_CODES.includes(response.status)) return refuse('too-many-redirects', location)
  }

  if (response.status !== 200) return refuse('status-' + response.status, finalUrl)
  const contentType = typeOf(response.headers)
  if (contentType !== GLTF_CONTENT_TYPE) return refuse('content-type ' + contentType, finalUrl)

  let magicChecked = false
  if (fetchRange !== null) {
    const bytes = await fetchRange(finalUrl, 0, 3)
    if (bytes !== GLTF_MAGIC) return refuse('magic-mismatch', finalUrl)
    magicChecked = true
  }

  return { ok: true, url: finalUrl, contentType, redirected, magicChecked, attempts }
}
