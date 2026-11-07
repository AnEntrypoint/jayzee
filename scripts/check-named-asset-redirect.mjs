import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { resolveServedAsset, servedCandidates, GLTF_CONTENT_TYPE } from '../src/spawn/namedAssetRedirect.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const ORIGIN = 'https://play.spawn.co'
const SHA = 'a'.repeat(64)
const VALUE_HOST = 'play.spawn.co'
const LOCATION = 'https://play.spawn.co/value-origin/dev/magic-assets/v5/values/' + SHA + '.glb?_av=raw1'
const NAMED_KEY = '~2fcdn~2fhero.glb.yaml'
const SERVED = '/cdn/hero.glb'
const GLTF_200 = { status: 200, headers: { 'content-type': GLTF_CONTENT_TYPE } }
const REDIRECT = { status: 302, headers: { location: LOCATION } }
const TIMEOUT = 'timeout'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}

const scripted = (routes) => {
  const calls = []
  const queues = new Map(Object.entries(routes).map(([url, value]) => [url, Array.isArray(value) ? [...value] : [value]]))
  const fetchHead = async (url) => {
    calls.push(url)
    const queue = queues.get(url)
    if (!queue || queue.length === 0) throw new TypeError('unrouted ' + url)
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (next === TIMEOUT) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    if (next instanceof Error) throw next
    return next
  }
  return { calls, fetchHead }
}

const cases = {}
const probe = async (label, fn) => {
  try {
    await fn()
    cases[label] = null
  } catch (error) {
    cases[label] = error
  }
}
const check = (label) => gate(label, () => {
  if (cases[label]) throw cases[label]
})

await probe('named', async () => {
  const served = servedCandidates(NAMED_KEY)
  same(served.kind, 'named', 'kind')
  sameJson(served.candidates, [SERVED], 'candidates')
  assert(!served.candidates.some((c) => c.endsWith('.yaml')), 'yaml form offered')
  mustReject(() => sameJson(served.candidates, [SERVED + '.yaml'], 'candidates'))
})

await probe('value', async () => {
  const served = servedCandidates('/cdn/value.' + SHA + '.glb')
  same(served.kind, 'value', 'kind')
  sameJson(served.candidates, ['/cdn/value.' + SHA + '.glb'], 'candidates')
})

await probe('redirect-ok', async () => {
  const net = scripted({ [ORIGIN + SERVED]: REDIRECT, [LOCATION]: GLTF_200 })
  const result = await resolveServedAsset(SERVED, { origin: ORIGIN, fetchHead: net.fetchHead, fetchRange: async () => 'glTF', allowedHosts: [VALUE_HOST] })
  same(result.ok, true, 'ok')
  same(result.url, LOCATION, 'final url')
  same(result.redirected, true, 'redirected')
  same(result.magicChecked, true, 'magic checked')
  same(result.attempts, 2, 'attempts')
  mustReject(() => same(result.redirected, false, 'redirected'))
})

await probe('timeout-retry', async () => {
  const net = scripted({ [ORIGIN + SERVED]: [TIMEOUT, REDIRECT], [LOCATION]: GLTF_200 })
  const result = await resolveServedAsset(SERVED, { origin: ORIGIN, fetchHead: net.fetchHead, allowedHosts: [VALUE_HOST], retries: 1 })
  same(result.ok, true, 'ok after one timeout')
  same(result.attempts, 3, 'attempts with a retry')
})

await probe('timeout-exhausted', async () => {
  const net = scripted({ [ORIGIN + SERVED]: [TIMEOUT, TIMEOUT, TIMEOUT] })
  const result = await resolveServedAsset(SERVED, { origin: ORIGIN, fetchHead: net.fetchHead, allowedHosts: [VALUE_HOST], retries: 1 })
  same(result.ok, false, 'ok')
  same(result.reason, 'timeout', 'reason')
  same(result.attempts, 2, 'attempts bounded by retries')
  same(net.calls.length, 2, 'calls')
})

await probe('yaml-kept-refused', async () => {
  const net = scripted({ [ORIGIN + '/cdn/hero.glb.yaml']: { status: 401, headers: { 'content-type': 'application/json' } } })
  const result = await resolveServedAsset('/cdn/hero.glb.yaml', { origin: ORIGIN, fetchHead: net.fetchHead, allowedHosts: [VALUE_HOST] })
  same(result.ok, false, 'ok')
  same(result.reason, 'refused-auth', 'reason')
  same(net.calls.length, 1, 'no retry or bypass after a 401')
})

await probe('redirect-host-refused', async () => {
  const offHost = 'https://evil.example/values/' + SHA + '.glb'
  const net = scripted({ [ORIGIN + SERVED]: { status: 302, headers: { location: offHost } } })
  const result = await resolveServedAsset(SERVED, { origin: ORIGIN, fetchHead: net.fetchHead, allowedHosts: [VALUE_HOST] })
  same(result.reason, 'redirect-host-not-allowed', 'reason')
  sameJson(net.calls, [ORIGIN + SERVED], 'off-host location never requested')
})

await probe('second-redirect-refused', async () => {
  const net = scripted({ [ORIGIN + SERVED]: REDIRECT, [LOCATION]: REDIRECT })
  const result = await resolveServedAsset(SERVED, { origin: ORIGIN, fetchHead: net.fetchHead, allowedHosts: [VALUE_HOST] })
  same(result.reason, 'too-many-redirects', 'reason')
})

await probe('wrong-content-type-refused', async () => {
  const net = scripted({ [ORIGIN + SERVED]: { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } } })
  const result = await resolveServedAsset(SERVED, { origin: ORIGIN, fetchHead: net.fetchHead, allowedHosts: [VALUE_HOST] })
  same(result.reason, 'content-type text/html', 'reason')
  mustReject(() => same(result.ok, true, 'ok'))
})

await probe('magic-mismatch-refused', async () => {
  const net = scripted({ [ORIGIN + SERVED]: GLTF_200 })
  const result = await resolveServedAsset(SERVED, { origin: ORIGIN, fetchHead: net.fetchHead, fetchRange: async () => '{"as', allowedHosts: [VALUE_HOST] })
  same(result.reason, 'magic-mismatch', 'reason')
})

await probe('value-direct', async () => {
  const path = '/cdn/value.' + SHA + '.glb'
  const net = scripted({ [ORIGIN + path]: GLTF_200 })
  const result = await resolveServedAsset(path, { origin: ORIGIN, fetchHead: net.fetchHead, allowedHosts: [VALUE_HOST] })
  same(result.ok, true, 'ok')
  same(result.redirected, false, 'redirected')
})

await probe('status-and-network', async () => {
  const notFound = scripted({ [ORIGIN + SERVED]: { status: 404, headers: {} } })
  same((await resolveServedAsset(SERVED, { origin: ORIGIN, fetchHead: notFound.fetchHead, allowedHosts: [VALUE_HOST] })).reason, 'status-404', 'status reason')
  const broken = scripted({ [ORIGIN + SERVED]: [new TypeError('socket reset')] })
  const result = await resolveServedAsset(SERVED, { origin: ORIGIN, fetchHead: broken.fetchHead, allowedHosts: [VALUE_HOST], retries: 1 })
  same(result.reason, 'network', 'network reason')
  same(result.attempts, 1, 'network errors are not retried')
})

check('named key: the served form strips .yaml, and the .yaml form is never offered')
check('a value-sha key is served directly from /cdn/')
check('a 302 to an allowed value-origin host is followed once, content type and glTF magic checked')
check('a timeout is retried once, and a second timeout is refused, not looped')
check('a .yaml-kept request that gets 401 is refused, with no retry or bypass')
check('a redirect to a host outside the allowlist is refused before it is requested')
check('a second redirect is refused')
check('a 200 that is not model/gltf-binary is refused')
check('a body whose first bytes are not glTF is refused')
check('a value-sha 200 resolves without a redirect')
check('a 404 is refused by status, and a non-timeout network error is refused without retry')

finish()
