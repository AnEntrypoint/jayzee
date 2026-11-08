const mulberry32 = (seed) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const encode = (v) => {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v)
  if (typeof v === 'string') return 'string:' + v
  if (typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'object') return 'object'
  return typeof v
}

const callsAt = (api, client, t, n) => {
  let calls = ''
  for (let i = 0; i < n; i++) calls += api.rateLimited(client, t) ? '1' : '0'
  return calls
}

const rateSection = (api, out) => {
  const next = mulberry32(11)
  const clients = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
  clients.forEach((client, k) => {
    api.clearRate(client)
    let t = 1000000 * (k + 1)
    out.push(JSON.stringify({ client, t, calls: callsAt(api, client, t, 121) }))
    for (let step = 0; step < 80; step++) {
      t += Math.floor(next() * 400)
      const n = 1 + Math.floor(next() * 12)
      out.push(JSON.stringify({ client, t, calls: callsAt(api, client, t, n) }))
    }
    api.clearRate(client)
  })
}

const FIELDS = ['yaw', 'pitch', 'analogForward', 'analogRight']

const sanitizeSection = (api, out) => {
  const values = [undefined, null, 0, -0, 1, -1, 0.5, 999999, 1000000, -1000000, 1000001, -1000001, NaN, Infinity, -Infinity, '1', true, {}, []]
  for (const field of FIELDS) {
    for (const value of values) {
      const input = { yaw: 1, pitch: 2, analogForward: 0.25, analogRight: -0.25, [field]: value }
      const result = api.sanitize(input)
      out.push(JSON.stringify({ field, value: encode(value), out: FIELDS.map((f) => encode(input[f])), same: result === input }))
    }
  }
  for (const input of [null, 5, 'x', undefined, [1]]) {
    out.push(JSON.stringify({ nonObject: encode(input), out: encode(api.sanitize(input)) }))
  }
}

const MOVEMENTS = [undefined, null, {}, { maxSpeed: 10 }, { maxSpeed: 0 }, { maxSpeed: -5 }, { maxSpeed: NaN }, { maxSpeed: '9' }, { maxSpeed: Infinity }, { sprintSpeed: 12 }, { airSpeedCap: 50, maxSpeed: 4 }, { slideMinSpeed: 3 }, { maxSpeed: 1, sprintSpeed: 2, airSpeedCap: 3, slideMinSpeed: 4 }]

const envelopeSection = (api, out) => {
  const next = mulberry32(17)
  const velocities = [[0, 0, 0], [10, 0, 0], [0, 300, 0], [3, 4, 12], [NaN, 0, 0], [0, Infinity, 0], [-30, 40, 0], [1, 2], [undefined, 0, 0], null, 'string']
  for (let i = 0; i < 40; i++) velocities.push([next() * 400 - 200, next() * 400 - 200, next() * 400 - 200])
  for (const movement of MOVEMENTS) {
    for (const velocity of velocities) {
      const state = { velocity: Array.isArray(velocity) ? velocity.slice() : velocity }
      const cap = api.envelopeCap(movement)
      const clamped = api.enforce(state, movement)
      out.push(JSON.stringify({ cap: encode(cap), clamped: encode(clamped), velocity: Array.isArray(state.velocity) ? state.velocity.map(encode) : encode(state.velocity) }))
    }
  }
}

const runShooter = (api, id, hits, out) => {
  api.clearShooter(id)
  const log = []
  const eventLog = { record: (type, data, meta) => log.push({ type, data, meta }) }
  for (const hit of hits) api.recordHit(eventLog, id, hit.headshot, hit.ts, hit.target)
  out.push(JSON.stringify({ id, flags: log }))
  api.clearShooter(id)
}

const outlierSection = (api, out) => {
  const next = mulberry32(29)
  const hitsAt = (pattern) => pattern.map(([headshot, ts, target]) => ({ headshot, ts, target: target ?? null }))
  const explicit = [
    hitsAt(Array.from({ length: 20 }, (_, i) => [i < 15, 10000 + i * 1000])),
    hitsAt(Array.from({ length: 20 }, (_, i) => [i < 14, 10000 + i * 1000])),
    hitsAt(Array.from({ length: 16 }, (_, i) => [true, 1000 * (i + 1)])),
    hitsAt(Array.from({ length: 10 }, (_, i) => [true, 1000 * (i + 1)]).concat([[true, 15000], [true, 15001], [true, 15002]])),
    hitsAt([[true, 10000], [true, 10099], [true, 10198], [true, 10297]]),
    hitsAt([[true, 10000], [true, 10100], [true, 10200], [true, 10300]]),
    hitsAt([[true, 10000], [true, 10050], [false, 10060], [true, 10070], [true, 10080], [true, 10090]]),
  ]
  explicit.forEach((hits, i) => runShooter(api, 'explicit-' + i, hits, out))
  const steps = [0, 20, 50, 99, 100, 101, 500, 1000, 3000, 5000, 5001, 6000]
  const probabilities = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1]
  for (let s = 0; s < 40; s++) {
    const count = 1 + Math.floor(next() * 30)
    const p = probabilities[Math.floor(next() * probabilities.length)]
    let ts = 10000
    const hits = []
    for (let i = 0; i < count; i++) {
      ts += steps[Math.floor(next() * steps.length)]
      hits.push({ headshot: next() < p, ts, target: next() < 0.5 ? 'ghost' : null })
    }
    runShooter(api, 'random-' + s, hits, out)
  }
  runShooter(api, null, hitsAt([[true, 10000], [true, 10010], [true, 10020], [true, 10030], [true, 10040]]), out)
}

export const runAnticheat = (api) => {
  const sections = { rate: [], sanitize: [], envelope: [], outlier: [] }
  rateSection(api, sections.rate)
  sanitizeSection(api, sections.sanitize)
  envelopeSection(api, sections.envelope)
  outlierSection(api, sections.outlier)
  return sections
}

export const jayzeeApi = (mods) => ({
  rateLimited: (client, t) => mods.isInputRateLimited(client, t),
  clearRate: (client) => mods.clearInputBucket(client),
  sanitize: (input) => mods.sanitizeInputPayload(input),
  envelopeCap: (movement) => mods.envelopeSpeedCap(movement),
  enforce: (state, movement) => mods.enforceMovementEnvelope(state, movement),
  recordHit: (eventLog, shooter, headshot, ts, target) => mods.recordHit(eventLog, shooter, { headshot, timestampMs: ts, targetId: target }),
  clearShooter: (shooter) => mods.clearOutlierWindow(shooter),
})

export const spointApi = (mods, clock) => ({
  rateLimited: (client, t) => {
    clock.set(t)
    return mods.isInputRateLimited(client)
  },
  clearRate: (client) => mods.clearInputBucket(client),
  sanitize: (input) => mods.sanitizeInputPayload(input),
  envelopeCap: (movement) => mods.envelopeSpeedCap(movement),
  enforce: (state, movement) => mods.enforceMovementEnvelope(state, movement),
  recordHit: (eventLog, shooter, headshot, ts, target) => mods.recordHit(eventLog, shooter, { headshot, timestampMs: ts, targetId: target }),
  clearShooter: (shooter) => mods.clearOutlierWindow(shooter),
})
