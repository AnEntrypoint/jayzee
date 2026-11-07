import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import {
  WORLD_SNAPSHOT_FORMAT_VERSION,
  WORLD_SNAPSHOT_KEY,
  worldDefFingerprint,
  resolveWorldName,
  buildWorldSnapshot,
  saveWorldSnapshot,
  restoreWorldSnapshot,
} from '../src/persistence-pure/worldPersistence.js'
import { snapshotChart } from '../src/persistence-pure/chartSnapshot.js'
import { canonicalJSON } from '../src/rollback-pure/canonicalJSON.js'
import { createChecksumFold } from '../src/anticheat/LockstepChecksum.js'
import { createChartTransfer } from '../src/client/chartTransfer.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSource = (rel) => readFileSync(join(root, rel), 'utf8')
const PERSISTENCE_SOURCES = ['src/persistence-pure/worldPersistence.js', 'src/persistence-pure/chartSnapshot.js']

const NOW = 1700000000000
const clock = () => NOW

const defA = { name: 'arena', gravity: -9.8, spawns: [{ x: 1, y: 0, z: -2 }], terrain: { seed: 7, scale: 0.5 } }
const defAReordered = { terrain: { scale: 0.5, seed: 7 }, spawns: [{ z: -2, y: 0, x: 1 }], gravity: -9.8, name: 'arena' }
const defB = { ...defA, gravity: -1.6 }

const captureLogger = () => {
  const lines = []
  const sink = (level) => (...args) => {
    lines.push({ level, text: args.map(String).join(' ') })
  }
  return { lines, log: sink('log'), warn: sink('warn'), error: sink('error') }
}
const logText = (logger, level) => logger.lines.filter((l) => l.level === level).map((l) => l.text).join('\n')

const liveEntities = () => new Map([
  [7, { _physicsBodyId: 3, bodyType: 'dynamic' }],
  [8, { bodyType: 'static' }],
])

const runtimeWith = ({ tick = 42, elapsed = 3.5, live = liveEntities() } = {}) => {
  const restored = []
  return {
    entities: live,
    restored,
    snapshotGameState: () => ({
      tick,
      elapsed,
      entities: new Map([
        [7, { hp: 80, position: [1, 2, 3], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] }],
        [8, { hp: 1, position: [9, 0, 9], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] }],
      ]),
      respawnTimers: new Map([[8, 12.5]]),
      timers: new Map([[7, [{ remaining: 1.25, repeat: true, interval: 0.5, callback: () => {} }]]]),
      interactCooldowns: new Map([[7, 0.25]]),
    }),
    restoreGameState: (state) => {
      restored.push(state)
    },
  }
}

const physicsWith = ({ planetFrame, restoreCalls = [] } = {}) => ({
  _planetFrame: planetFrame,
  getBodyPosition: (id) => [id, 5, 6],
  getBodyRotation: () => [0, 0, 0, 1],
  getBodyVelocity: (id) => [id, 0.5, -id],
  getBodyAngularVelocity: () => [0, 0.5, 0],
  restoreBodies: (map) => {
    restoreCalls.push(map)
  },
})

const memoryStorage = (entries = []) => {
  const data = new Map(entries)
  return {
    data,
    get: async (key) => (data.has(key) ? structuredClone(data.get(key)) : undefined),
    set: async (key, value) => {
      data.set(key, structuredClone(value))
    },
  }
}

const ctxFor = ({
  runtime,
  physics = physicsWith(),
  storage = memoryStorage(),
  worldName = 'arena',
  currentWorldDef,
  config,
  env,
  logger = captureLogger(),
  now = clock,
} = {}) => ({ appRuntime: runtime, physics, storage, worldName, currentWorldDef, config, env, logger, now })

const foldOf = (text) => {
  const fold = createChecksumFold()
  for (let i = 0; i < text.length; i++) fold.pushInt(text.charCodeAt(i))
  return fold.digest()
}

const assertDef = (value, what) => assert.match(value, /^def-[0-9a-f]{16}$/, what)
const SHAPE_CHECK = (value) => assert.match(value, /^def-[0-9a-f]{16}$/, 'shape')
const hasComment = (text) => /\/\/|\/\*/.test(text)
const importsSharedCodecs = (text) =>
  text.includes("from '../rollback-pure/canonicalJSON.js'") &&
  text.includes("from '../anticheat/LockstepChecksum.js'") &&
  !/sortedKeysReplacer|FNV1A_32|function fnv1a/.test(text)
const readsAmbient = (text) => /Date\.now|process\.|globalThis|node:fs|fetch\(|__spointHmr/.test(text)
const jsonRoundTrip = (value) => JSON.parse(JSON.stringify(value))
const near = (actual, expected, what) => {
  assert.equal(actual.length, expected.length, what + ' length')
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${what}[${i}] ${v} vs ${expected[i]}`))
}

const fpA = worldDefFingerprint(defA)
const fpReordered = worldDefFingerprint(defAReordered)
const fpB = worldDefFingerprint(defB)

const saveLogger = captureLogger()
const saveStore = memoryStorage()
const saveOk = await saveWorldSnapshot(ctxFor({ runtime: runtimeWith(), storage: saveStore, logger: saveLogger }))
const stored = saveStore.data.get(WORLD_SNAPSHOT_KEY)

const restoreLogger = captureLogger()
const restoreRuntime = runtimeWith({ tick: 0, elapsed: 0 })
const restoreCalls = []
const restoreResult = await restoreWorldSnapshot(ctxFor({
  runtime: restoreRuntime,
  physics: physicsWith({ restoreCalls }),
  storage: saveStore,
  logger: restoreLogger,
}))

const noBodyRestoreCalls = []
const noBodyResult = await restoreWorldSnapshot(ctxFor({
  runtime: runtimeWith({ tick: 0, elapsed: 0, live: new Map([[7, { bodyType: 'dynamic' }], [8, { bodyType: 'static' }]]) }),
  physics: physicsWith({ restoreCalls: noBodyRestoreCalls }),
  storage: saveStore,
}))

const nonFiniteStore = memoryStorage()
await saveWorldSnapshot(ctxFor({ runtime: runtimeWith({ elapsed: Number.NaN }), storage: nonFiniteStore }))
const nonFiniteRuntime = runtimeWith({ tick: 0, elapsed: 0 })
const nonFiniteResult = await restoreWorldSnapshot(ctxFor({ runtime: nonFiniteRuntime, storage: nonFiniteStore }))

const v2Logger = captureLogger()
const v2Runtime = runtimeWith()
const v2Result = await restoreWorldSnapshot(ctxFor({
  runtime: v2Runtime,
  storage: memoryStorage([[WORLD_SNAPSHOT_KEY, { ...stored, version: 2 }]]),
  logger: v2Logger,
}))

const unversionedRuntime = runtimeWith()
const unversionedResult = await restoreWorldSnapshot(ctxFor({
  runtime: unversionedRuntime,
  storage: memoryStorage([[WORLD_SNAPSHOT_KEY, { ...stored, version: undefined }]]),
}))

const fpStore = memoryStorage()
await saveWorldSnapshot(ctxFor({ runtime: runtimeWith(), storage: fpStore, worldName: fpA }))
const fpSameResult = await restoreWorldSnapshot(ctxFor({ runtime: runtimeWith(), storage: fpStore, worldName: fpReordered }))
const fpOtherResult = await restoreWorldSnapshot(ctxFor({ runtime: runtimeWith(), storage: fpStore, worldName: fpB }))

const harbourLogger = captureLogger()
const harbourRuntime = runtimeWith()
const harbourResult = await restoreWorldSnapshot(ctxFor({
  runtime: harbourRuntime,
  storage: saveStore,
  worldName: 'harbour',
  logger: harbourLogger,
}))

const unnamedStore = memoryStorage()
await saveWorldSnapshot(ctxFor({ runtime: runtimeWith(), storage: unnamedStore, worldName: null }))
const legacyUnnamedStored = unnamedStore.data.get(WORLD_SNAPSHOT_KEY)
const legacyAccepted = await restoreWorldSnapshot(ctxFor({
  runtime: runtimeWith(),
  storage: unnamedStore,
  config: { worldLocatedByDefault: true },
}))
const legacyRefused = await restoreWorldSnapshot(ctxFor({
  runtime: runtimeWith(),
  storage: unnamedStore,
  config: { worldLocatedByDefault: false },
}))

const snapFrame = { radius: 100, offsetY: 0, anchorHeight: 0, chartEpoch: 1, east: [1, 0, 0], up: [0, 1, 0], north: [0, 0, 1] }
const liveFrame = { radius: 100, offsetY: 0, anchorHeight: 0, chartEpoch: 2, east: [0, 1, 0], up: [-1, 0, 0], north: [0, 0, 1] }
const chartStore = memoryStorage()
await saveWorldSnapshot(ctxFor({ runtime: runtimeWith(), physics: physicsWith({ planetFrame: snapFrame }), storage: chartStore }))
const chartedStored = chartStore.data.get(WORLD_SNAPSHOT_KEY)
const chartCalls = []
const chartRuntime = runtimeWith({ tick: 0, elapsed: 0 })
const chartResult = await restoreWorldSnapshot(ctxFor({
  runtime: chartRuntime,
  physics: physicsWith({ planetFrame: liveFrame, restoreCalls: chartCalls }),
  storage: chartStore,
}))
const sameChartRuntime = runtimeWith({ tick: 0, elapsed: 0 })
const sameChartResult = await restoreWorldSnapshot(ctxFor({
  runtime: sameChartRuntime,
  physics: physicsWith({ planetFrame: snapFrame }),
  storage: chartStore,
}))
const expectedTransfer = createChartTransfer(snapshotChart(snapFrame), snapshotChart(liveFrame))

const versionLogText = logText(v2Logger, 'warn')
const worldLogText = logText(harbourLogger, 'warn')

const saveNoRuntimeStore = memoryStorage()
const saveNoRuntime = await saveWorldSnapshot(ctxFor({ runtime: null, storage: saveNoRuntimeStore }))
const restoreNoRuntime = await restoreWorldSnapshot(ctxFor({ runtime: null, storage: saveStore }))
const restoreNoStorage = await restoreWorldSnapshot(ctxFor({ runtime: runtimeWith(), storage: null }))

const loadErrorLogger = captureLogger()
const loadError = await restoreWorldSnapshot(ctxFor({
  runtime: runtimeWith(),
  storage: { get: async () => { throw new Error('disk gone') }, set: async () => {} },
  logger: loadErrorLogger,
}))
const emptyResult = await restoreWorldSnapshot(ctxFor({ runtime: runtimeWith(), storage: memoryStorage() }))

const setErrorLogger = captureLogger()
const setError = await saveWorldSnapshot(ctxFor({
  runtime: runtimeWith(),
  storage: { get: async () => undefined, set: async () => { throw new Error('quota exceeded') } },
  logger: setErrorLogger,
}))

const noClockOutcome = await saveWorldSnapshot(ctxFor({ runtime: runtimeWith(), storage: memoryStorage(), now: null })).then(
  () => 'resolved',
  (e) => e,
)
const withClockOutcome = await saveWorldSnapshot(ctxFor({ runtime: runtimeWith(), storage: memoryStorage() }))

const frame = { ...snapFrame, up: [0, 1, 0] }
const frameSnapshot = snapshotChart(frame)
frame.up[1] = 99

gate('worldDefFingerprint has the def- prefix and 16 lowercase hex digits', () => {
  assertDef(fpA, 'fingerprint')
  assertDef(fpB, 'fingerprint of changed def')
})

gate('negative control: a value without the def- prefix or with non-hex digits fails the fingerprint shape', () => {
  assert.throws(() => SHAPE_CHECK('def-xyz'))
  assert.throws(() => SHAPE_CHECK('abc-0123456789abcdef'))
})

gate('worldDefFingerprint ignores key order because it folds canonical JSON', () => {
  assert.equal(fpReordered, fpA)
})

gate('negative control: a raw JSON.stringify fold of the reordered def differs, so the canonical sort is what keeps the fingerprint stable', () => {
  assert.notEqual('def-' + foldOf(JSON.stringify(defAReordered)), fpReordered)
})

gate('worldDefFingerprint is the same for equal content in a new object', () => {
  assert.equal(worldDefFingerprint({ ...defA, terrain: { ...defA.terrain } }), fpA)
})

gate('negative control: worldDefFingerprint changes when one value changes', () => {
  assert.notEqual(fpB, fpA)
})

gate('worldDefFingerprint equals a direct checksum fold over canonicalJSON text', () => {
  assert.equal(fpA, 'def-' + foldOf(canonicalJSON(defA)))
})

gate('the format version is 1 and the storage key is world-snapshot', () => {
  assert.equal(WORLD_SNAPSHOT_FORMAT_VERSION, 1)
  assert.equal(WORLD_SNAPSHOT_KEY, 'world-snapshot')
})

gate('a saved snapshot carries format version 1', () => {
  assert.equal(stored.version, 1)
})

gate('a version 2 snapshot is refused with version-mismatch and the runtime is untouched', () => {
  assert.deepEqual(v2Result, { restored: false, reason: 'version-mismatch' })
  assert.equal(v2Runtime.restored.length, 0)
})

gate('a snapshot with no version is refused with version-mismatch', () => {
  assert.deepEqual(unversionedResult, { restored: false, reason: 'version-mismatch' })
  assert.equal(unversionedRuntime.restored.length, 0)
})

gate('negative control: a version 1 snapshot restores', () => {
  assert.equal(restoreResult.restored, true)
})

gate('a version mismatch warns with the saved and current versions', () => {
  assert.ok(versionLogText.includes('saved=2 current=1'), versionLogText)
})

gate('a snapshot saved under the fingerprint of a def restores under the fingerprint of the same content in another key order', () => {
  assert.equal(fpSameResult.restored, true)
})

gate('negative control: a snapshot saved under one def fingerprint is refused under the fingerprint of a changed def', () => {
  assert.deepEqual(fpOtherResult, { restored: false, reason: 'world-mismatch' })
})

gate('a snapshot named arena is refused under harbour with world-mismatch and the runtime is untouched', () => {
  assert.deepEqual(harbourResult, { restored: false, reason: 'world-mismatch' })
  assert.equal(harbourRuntime.restored.length, 0)
  assert.ok(worldLogText.includes('saved="arena" current="harbour"'), worldLogText)
})

gate('negative control: a snapshot restores under its own world name', () => {
  assert.equal(restoreResult.restored, true)
})

gate('an unnamed legacy snapshot is accepted when worldLocatedByDefault is set', () => {
  assert.equal(legacyUnnamedStored.world, null)
  assert.equal(legacyAccepted.restored, true)
})

gate('negative control: an unnamed snapshot is refused under a named world when worldLocatedByDefault is false', () => {
  assert.deepEqual(legacyRefused, { restored: false, reason: 'world-mismatch' })
})

gate('resolveWorldName prefers currentWorldDef.name, then worldName, then env WORLD, then null', () => {
  assert.equal(resolveWorldName({ currentWorldDef: { name: 'x' }, worldName: 'y', env: { WORLD: 'z' } }), 'x')
  assert.equal(resolveWorldName({ worldName: 'y', env: { WORLD: 'z' } }), 'y')
  assert.equal(resolveWorldName({ env: { WORLD: 'z' } }), 'z')
  assert.equal(resolveWorldName({}), null)
})

gate('negative control: env WORLD does not override an explicit worldName', () => {
  assert.notEqual(resolveWorldName({ worldName: 'y', env: { WORLD: 'z' } }), 'z')
})

gate('a save writes the snapshot under world-snapshot with the tick, the clock value and two entities', () => {
  assert.equal(saveOk, true)
  assert.equal(stored.world, 'arena')
  assert.equal(stored.tick, 42)
  assert.equal(stored.savedAt, NOW)
  assert.equal(stored.entities.length, 2)
  assert.ok(logText(saveLogger, 'log').includes('saved snapshot: tick=42 entities=2'))
})

gate('negative control: a save with no runtime writes nothing and resolves false', () => {
  assert.equal(saveNoRuntime, false)
  assert.equal(saveNoRuntimeStore.data.size, 0)
})

gate('the snapshot keeps its key order and survives a JSON round trip unchanged', () => {
  assert.deepEqual(Object.keys(stored), ['version', 'world', 'chart', 'tick', 'elapsed', 'savedAt', 'entities', 'respawnTimers', 'timers', 'interactCooldowns'])
  assert.deepEqual(jsonRoundTrip(stored), stored)
})

gate('negative control: a Map value does not survive a JSON round trip', () => {
  const withMap = { m: new Map([[1, 2]]) }
  assert.throws(() => assert.deepEqual(jsonRoundTrip(withMap), withMap))
})

gate('a restore returns the tick, entity count and body counts', () => {
  assert.deepEqual(restoreResult, { restored: true, tick: 42, entityCount: 2, bodiesRestored: 1, bodiesSkippedNotFound: 0 })
})

gate('the restored game state carries tick, elapsed, cooldowns and respawn timers, with timers reset', () => {
  const state = restoreRuntime.restored[0]
  assert.equal(state.tick, 42)
  assert.equal(state.elapsed, 3.5)
  assert.equal(state.timers.size, 0)
  assert.deepEqual([...state.respawnTimers], [[8, 12.5]])
  assert.equal(state.interactCooldowns.get(7), 0.25)
})

gate('a non-finite elapsed drops respawn timers and passes elapsed as undefined', () => {
  const state = nonFiniteRuntime.restored[0]
  assert.equal(nonFiniteResult.restored, true)
  assert.equal(state.elapsed, undefined)
  assert.equal(state.respawnTimers.size, 0)
})

gate('negative control: a finite elapsed keeps the respawn timers', () => {
  assert.equal(restoreRuntime.restored[0].respawnTimers.size, 1)
})

gate('the restored entities carry their state without a body field', () => {
  const entity = restoreRuntime.restored[0].entities.get(7)
  assert.equal(entity.hp, 80)
  assert.equal('body' in entity, false)
})

gate('bodies are restored keyed by live body id, with the saved values, and static bodies are excluded', () => {
  assert.equal(restoreCalls.length, 1)
  assert.deepEqual([...restoreCalls[0].keys()], [3])
  assert.deepEqual(restoreCalls[0].get(3), {
    position: [3, 5, 6],
    rotation: [0, 0, 0, 1],
    velocity: [3, 0.5, -3],
    angularVelocity: [0, 0.5, 0],
  })
})

gate('negative control: a body with no live body id is skipped and counted, and restoreBodies is not called', () => {
  assert.deepEqual(noBodyResult, { restored: true, tick: 42, entityCount: 2, bodiesRestored: 0, bodiesSkippedNotFound: 1 })
  assert.equal(noBodyRestoreCalls.length, 0)
})

gate('snapshotChart copies the frame into seven keys in order', () => {
  assert.deepEqual(Object.keys(frameSnapshot), ['radius', 'offsetY', 'anchorHeight', 'chartEpoch', 'east', 'up', 'north'])
  assert.deepEqual(frameSnapshot.up, [0, 1, 0])
})

gate('negative control: the snapshot does not share arrays with the frame it was taken from', () => {
  assert.notEqual(frameSnapshot.up, frame.up)
  assert.equal(frameSnapshot.up[1], 1)
})

gate('a restore re-expresses entity and body positions when the saved chart differs from the live chart', () => {
  assert.equal(chartResult.restored, true)
  near(chartRuntime.restored[0].entities.get(7).position, expectedTransfer.point([1, 2, 3], [0, 0, 0]), 'entity position')
  near(chartCalls[0].get(3).position, expectedTransfer.point([3, 5, 6], [0, 0, 0]), 'body position')
  assert.ok(Math.abs(chartRuntime.restored[0].entities.get(7).position[0] - 1) > 1)
})

gate('negative control: with the same chart, restored positions are left unchanged', () => {
  assert.equal(sameChartResult.restored, true)
  assert.deepEqual(sameChartRuntime.restored[0].entities.get(7).position, [1, 2, 3])
  assert.equal(chartedStored.chart.chartEpoch, 1)
})

gate('a restore with no runtime or no storage reports no-runtime', () => {
  assert.deepEqual(restoreNoRuntime, { restored: false, reason: 'no-runtime' })
  assert.deepEqual(restoreNoStorage, { restored: false, reason: 'no-runtime' })
})

gate('a storage read error is reported as load-error and logged, not thrown', () => {
  assert.deepEqual(loadError, { restored: false, reason: 'load-error' })
  assert.ok(logText(loadErrorLogger, 'error').includes('load error: disk gone'))
})

gate('a missing snapshot is reported as no-snapshot', () => {
  assert.deepEqual(emptyResult, { restored: false, reason: 'no-snapshot' })
})

gate('a storage write error resolves false and is logged, not thrown', () => {
  assert.equal(setError, false)
  assert.ok(logText(setErrorLogger, 'error').includes('save error: quota exceeded'))
})

gate('negative control: a save with a clock and storage resolves true', () => {
  assert.equal(withClockOutcome, true)
})

gate('saveWorldSnapshot without ctx.now throws a TypeError', () => {
  assert.ok(noClockOutcome instanceof TypeError, String(noClockOutcome))
})

gate('negative control: the same save with ctx.now resolves rather than throws', () => {
  assert.equal(withClockOutcome, true)
})

gate('the persistence sources carry no comments', () => {
  for (const rel of PERSISTENCE_SOURCES) assert.equal(hasComment(readSource(rel)), false, rel)
})

gate('negative control: a line with a trailing // comment is flagged', () => {
  assert.equal(hasComment('const a = 1 // note'), true)
})

gate('the persistence module imports canonicalJSON and the checksum fold rather than copying them', () => {
  assert.equal(importsSharedCodecs(readSource('src/persistence-pure/worldPersistence.js')), true)
})

gate('negative control: a module that defines sortedKeysReplacer itself is flagged as a copy', () => {
  const copied = "import { createChecksumFold } from '../anticheat/LockstepChecksum.js'\nimport { canonicalJSON } from '../rollback-pure/canonicalJSON.js'\nfunction sortedKeysReplacer() {}\n"
  assert.equal(importsSharedCodecs(copied), false)
})

gate('the persistence module reads no ambient clock, env, fs, network or HMR global', () => {
  assert.equal(readsAmbient(readSource('src/persistence-pure/worldPersistence.js')), false)
  assert.equal(readsAmbient(readSource('src/persistence-pure/chartSnapshot.js')), false)
})

gate('negative control: a module that calls Date.now is flagged', () => {
  assert.equal(readsAmbient('const savedAt = Date.now()'), true)
})

finish()
