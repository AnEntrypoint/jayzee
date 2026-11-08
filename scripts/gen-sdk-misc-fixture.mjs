import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const spointRoot = process.argv[2]
if (!spointRoot) throw new Error('usage: node scripts/gen-sdk-misc-fixture.mjs <spoint root>')

const NOW = 1_700_000_000_000
Date.now = () => NOW

const sdk = (name) => import(pathToFileURL(join(spointRoot, 'src/sdk', name)).href)
const outcome = (fn) => {
  try {
    return { ok: true, value: fn() }
  } catch (error) {
    return { ok: false, name: error.name, reasonCode: error.reasonCode ?? null, message: error.message }
  }
}
const plainScatter = (parsed) => ({ ...parsed, overrides: [...parsed.overrides.entries()] })

const scatter = await sdk('scatterSpec.js')
const atlas = await sdk('TextureAtlas.js')
const roomLog = await sdk('RoomLog.js')
const timeOfDay = await sdk('ServerTimeOfDay.js')
const envelope = await sdk('SharedEventEnvelope.js')

const goodScatter = {
  bounds: { minX: -10, maxX: 10, minZ: -5, maxZ: 5 },
  count: 5,
  seed: 7,
  scale: { min: 0.5, max: 2 },
  yaw: { min: 0, max: 6.28 },
  model: 'tree.glb',
  overrides: [{ index: 2, scale: 3 }, { index: 4, model: 'rock.glb', yaw: 1 }],
}
const scatterSpecs = [
  { name: 'uniform with overrides', spec: goodScatter },
  { name: 'grid sampling', spec: { ...goodScatter, count: 10, sampling: 'grid', seed: 0, overrides: [] } },
  { name: 'empty count', spec: { ...goodScatter, count: 0, overrides: [] } },
  { name: 'negative integer seed is accepted', spec: { ...goodScatter, seed: -1, overrides: [] } },
  { name: 'null spec', spec: null },
  { name: 'null bounds', spec: { ...goodScatter, bounds: null } },
  { name: 'inverted bounds', spec: { ...goodScatter, bounds: { minX: 1, maxX: 0, minZ: 0, maxZ: 1 } } },
  { name: 'fraction count', spec: { ...goodScatter, count: 1.5 } },
  { name: 'count over a million', spec: { ...goodScatter, count: 1e6 + 1 } },
  { name: 'unknown sampling', spec: { ...goodScatter, sampling: 'hex' } },
  { name: 'fraction seed', spec: { ...goodScatter, seed: 1.5 } },
  { name: 'zero scale minimum', spec: { ...goodScatter, scale: { min: 0, max: 1 } } },
  { name: 'inverted yaw range', spec: { ...goodScatter, yaw: { min: 2, max: 1 } } },
  { name: 'model not a string', spec: { ...goodScatter, model: 5 } },
  { name: 'overrides not an array', spec: { ...goodScatter, overrides: {} } },
  { name: 'override index out of count', spec: { ...goodScatter, overrides: [{ index: 5, scale: 1 }] } },
  { name: 'duplicate override', spec: { ...goodScatter, overrides: [{ index: 1 }, { index: 1 }] } },
  { name: 'unknown override key', spec: { ...goodScatter, overrides: [{ index: 1, tint: 'red' }] } },
  { name: 'override scale zero', spec: { ...goodScatter, overrides: [{ index: 1, scale: 0 }] } },
  { name: 'override yaw not finite', spec: { ...goodScatter, overrides: [{ index: 1, yaw: 'x' }] } },
  { name: 'override model not a string', spec: { ...goodScatter, overrides: [{ index: 1, model: 3 }] } },
]

const scatterCases = scatterSpecs.map(({ name, spec }) => {
  const parsed = outcome(() => plainScatter(scatter.parseScatterSpec(spec)))
  const samples = outcome(() => scatter.sampleScatter(scatter.parseScatterSpec(spec)))
  return { name, spec, parsed, samples }
})

const hashCases = []
for (const seed of [0, 1, 7, -1, 2147483647, 1234567]) {
  for (const salt of [0x9e3779b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f]) {
    for (const i of [0, 1, 2, 3, 100, 1000000]) {
      hashCases.push({ seed, salt, i, value: scatter.hashUnit(seed, salt, i) })
    }
  }
}

const atlasSpecs = [
  { frameSize: [32, 32], animations: { idle: 4, run: 6 } },
  { frameSize: [16, 8], animations: { idle: 4, run: 6, jump: 3 }, columns: 4 },
  { frameSize: [1, 1], animations: { only: 1 } },
  { frameSize: [0, 4], animations: { a: 1 } },
  { frameSize: [2.5, 4], animations: { a: 1 } },
  { frameSize: [2, 4, 1], animations: { a: 1 } },
  { frameSize: [2, 4], animations: null },
  { frameSize: [2, 4], animations: {} },
  { frameSize: [2, 4], animations: { a: 0 } },
  { frameSize: [2, 4], animations: { a: 2 }, columns: 0 },
  { frameSize: [2, 4], animations: { a: 2 }, columns: 1.5 },
  null,
]
const atlasCases = atlasSpecs.map((spec) => ({ spec, result: outcome(() => atlas.atlasLayout(spec)) }))

const logCases = [
  {
    capacity: 3,
    steps: [
      { append: ['info', 'boot', 'started', null] },
      { append: ['warn', 'net', 'slow', null] },
      { append: ['error', 'db', 'failed', '/rooms/a'] },
      { append: ['info', 'tick', 'ok', null] },
      { read: null },
      { read: { after: 2, limit: 1 } },
      { read: { level: 'error' } },
      { read: { after: 3 } },
      { read: { after: 99 } },
    ],
  },
  {
    capacity: 2,
    steps: [
      { append: ['info', 'a', 'x', null] },
      { append: ['info', 'b', 'y', null] },
      { append: ['info', 'c', 'z', null] },
      { read: { limit: 1 } },
      { read: { after: 0, limit: 2 } },
      { read: { after: 1, limit: 1000 } },
    ],
  },
  {
    capacity: 5,
    steps: [
      { append: ['debug', 'a', 'x', null] },
      { append: ['error', 'a', 'x', null] },
      { append: ['error', 'a', 'x', ''] },
      { append: ['error', 'a', 'x', '/ok'] },
      { read: { after: -1 } },
      { read: { after: 0.5 } },
      { read: { limit: 0 } },
      { read: { limit: 1001 } },
      { read: { limit: 2.5 } },
      { read: { level: 'warn' } },
    ],
  },
  { ctor: {}, steps: [{ read: null }] },
  { ctor: { capacity: 0 }, steps: [] },
  { ctor: { capacity: 1.5 }, steps: [] },
  { ctor: { capacity: '3' }, steps: [] },
]

const runLog = (c) => {
  const options = c.ctor ?? { capacity: c.capacity }
  const ctor = outcome(() => new roomLog.RoomLog(options))
  if (!ctor.ok) return { ctor, steps: [] }
  const log = new roomLog.RoomLog(options)
  const steps = c.steps.map((step) => {
    if ('append' in step) return outcome(() => log.append(...step.append))
    return outcome(() => (step.read === null ? log.read() : log.read(step.read)))
  })
  return { ctor, steps }
}
const logResults = logCases.map((c) => ({ input: c, result: runLog(c) }))

const todCases = [
  {
    name: 'disabled stays at start fraction',
    config: [null],
    steps: [{ tick: 1 }, { enabled: true }, { payload: true }, { should: true }],
  },
  {
    name: 'enabled defaults',
    config: [{ serverAuthoritative: true }],
    steps: [{ tick: 60 }, { payload: true }, { should: true }, { tick: 2 }, { should: true }, { fraction: true }],
  },
  {
    name: 'start fraction above one wraps and custom day',
    config: [{ serverAuthoritative: true, startFraction: 1.25, dayLengthSec: 100, broadcastIntervalSec: 2 }],
    steps: [{ payload: true }, { tick: 50 }, { payload: true }, { should: true }, { tick: 1.9 }, { should: true }, { tick: 0.1 }, { should: true }],
  },
  {
    name: 'seed continues from its timestamp',
    config: [{ serverAuthoritative: true, seed: { t: 0.5, atMs: NOW - 30000, dayLengthSec: 600 } }],
    steps: [{ enabled: true }, { payload: true }],
  },
  {
    name: 'seed from the future wraps',
    config: [{ serverAuthoritative: true, seed: { t: 0.5, atMs: NOW + 60000, dayLengthSec: 600 } }],
    steps: [{ enabled: true }, { payload: true }],
  },
  {
    name: 'seed with a different day length falls back',
    config: [{ serverAuthoritative: true, dayLengthSec: 600, startFraction: 0.7, seed: { t: 0.5, atMs: NOW - 30000, dayLengthSec: 300 } }],
    steps: [{ enabled: true }, { payload: true }],
  },
  {
    name: 'late enable keeps the first resolved config',
    config: [null, { serverAuthoritative: true, dayLengthSec: 50, broadcastIntervalSec: 1 }, { serverAuthoritative: true, dayLengthSec: 999 }],
    steps: [{ tick: 5 }, { enabled: true }, { config: 2 }, { tick: 5 }, { payload: true }, { should: true }, { config: 3 }, { tick: 5 }, { payload: true }],
  },
  {
    name: 'bad numeric config falls back to defaults',
    config: [{ serverAuthoritative: true, dayLengthSec: -4, broadcastIntervalSec: 'x', startFraction: 'x' }],
    steps: [{ enabled: true }, { payload: true }, { tick: 1 }, { payload: true }, { should: true }],
  },
  {
    name: 'nonfinite and nonpositive ticks are ignored',
    config: [{ serverAuthoritative: true }],
    steps: [{ tick: 'x' }, { tick: -1 }, { tick: 0 }, { payload: true }, { should: true }],
  },
]

const runTod = (c) => {
  let index = 0
  const getConfig = () => c.config[Math.min(index, c.config.length - 1)]
  const tod = timeOfDay.createServerTimeOfDay(getConfig)
  return c.steps.map((step) => {
    if ('config' in step) {
      index = step.config - 1
      return { ok: true, value: null }
    }
    if ('tick' in step) return outcome(() => tod.tick(step.tick))
    if ('enabled' in step) return outcome(() => tod.isEnabled())
    if ('payload' in step) return outcome(() => tod.getSyncPayload())
    if ('should' in step) return outcome(() => tod.shouldBroadcast())
    return outcome(() => tod.getFraction())
  })
}
const todResults = todCases.map((c) => ({ input: c, steps: runTod(c) }))

const fakeBus = { emit: (channel, data, meta) => ({ channel, data, meta: { timestamp: 42 } }) }
const emitCases = [
  { channel: '', data: {}, meta: {} },
  { channel: 'hit', data: { dmg: 3 }, meta: { source: 'combat' } },
  { channel: 'hit', data: { dmg: 3 }, meta: { sourceEntity: 'e1' } },
  { channel: 'hit', data: null, meta: {} },
]
const emitResults = emitCases.map((c) => ({
  input: c,
  result: outcome(() => {
    const env = envelope.emitEnvelope(fakeBus, c.channel, c.data, c.meta)
    return { idType: typeof env.id, ts: env.ts, source: env.source, kind: env.kind, payload: env.payload }
  }),
}))

const validEnvelope = { id: 'a', ts: 1, source: 's', kind: 'k', payload: 1 }
const validateCases = [
  null,
  'x',
  {},
  validEnvelope,
  { ...validEnvelope, payload: null },
  { ...validEnvelope, id: '' },
  { ...validEnvelope, ts: '1' },
  { ...validEnvelope, source: '' },
  { ...validEnvelope, kind: '' },
  { id: 'a', ts: 1, source: 's', kind: 'k' },
  { ...validEnvelope, id: 1, ts: 'x' },
]
const validateResults = validateCases.map((env) => ({ env, result: envelope.validateEnvelope(env) }))

const fixture = {
  now: NOW,
  scatter: scatterCases,
  hash: hashCases,
  atlas: atlasCases,
  roomLog: logResults,
  timeOfDay: todResults,
  envelopeEmit: emitResults,
  envelopeValidate: validateResults,
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/spoint/sdk-misc.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out)
