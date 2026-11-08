import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { RoomLog, RoomLogError } from '../src/sdk/RoomLog.js'
import { createServerTimeOfDay } from '../src/sdk/ServerTimeOfDay.js'
import { createEventIds, emitEnvelope, validateEnvelope } from '../src/sdk/SharedEventEnvelope.js'
import { stampSender, senderOf } from '../src/sdk/appEventSender.js'
import { ScatterSpecError, parseScatterSpec, hashUnit, sampleScatter } from '../src/sdk/scatterSpec.js'
import { AtlasSpecError, atlasLayout } from '../src/sdk/TextureAtlas.js'
import { collectBenchmark } from '../src/sdk/PublicBenchmark.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/sdk-misc.json', import.meta.url), 'utf8'))
const NOW = fixture.now

const outcome = (fn) => {
  try {
    return JSON.parse(JSON.stringify({ ok: true, value: fn() }))
  } catch (error) {
    return { ok: false, name: error.name, reasonCode: error.reasonCode ?? null, message: error.message }
  }
}

const plainScatter = (parsed) => ({ ...parsed, overrides: [...parsed.overrides.entries()] })

for (const c of fixture.scatter) {
  gate(`scatter parse matches spoint: ${c.name}`, () => {
    assert.deepStrictEqual(outcome(() => plainScatter(parseScatterSpec(c.spec))), c.parsed)
  })
  gate(`scatter sample matches spoint: ${c.name}`, () => {
    assert.deepStrictEqual(outcome(() => sampleScatter(parseScatterSpec(c.spec))), c.samples)
  })
}

gate('scatter parse refuses each spoint refusal with the same reason code', () => {
  const refused = fixture.scatter.filter((c) => !c.parsed.ok)
  assert.equal(refused.length, 17)
  for (const c of refused) {
    assert.equal(c.parsed.name, 'ScatterSpecError', c.name)
    assert.ok(c.parsed.reasonCode, c.name)
  }
  assert.throws(() => parseScatterSpec(null), ScatterSpecError)
  assert.throws(() => parseScatterSpec({ bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, count: 1.5 }), (e) => e instanceof ScatterSpecError && e.reasonCode === 'bad-count')
})

gate('hashUnit matches spoint for every fixture seed, salt and index', () => {
  assert.equal(fixture.hash.length, 144)
  for (const h of fixture.hash) {
    assert.equal(hashUnit(h.seed, h.salt, h.i), h.value, `seed ${h.seed} salt ${h.salt} i ${h.i}`)
  }
})

gate('hashUnit is zero at the origin and stays in [0, 1) over a grid', () => {
  assert.equal(hashUnit(0, 0, 0), 0)
  for (let i = 0; i < 5000; i++) {
    const v = hashUnit(12345, 0x9e3779b1, i)
    assert.ok(v >= 0 && v < 1, `index ${i} gave ${v}`)
  }
})

gate('scatter grid positions follow the cell centres, by hand from the source', () => {
  const spec = parseScatterSpec({ bounds: { minX: -10, maxX: 10, minZ: -5, maxZ: 5 }, count: 10, sampling: 'grid', model: 'tree.glb' })
  const samples = sampleScatter(spec)
  assert.ok(Math.abs(samples[0].x - -7.5) < 1e-12)
  assert.ok(Math.abs(samples[0].z - -3.3333333333333335) < 1e-12)
  assert.ok(Math.abs(samples[1].x - -2.5) < 1e-12)
})

gate('scatter overrides apply only to their index and keep the spec model otherwise', () => {
  const spec = parseScatterSpec({
    bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
    count: 5,
    model: 'tree.glb',
    overrides: [{ index: 2, scale: 3 }, { index: 4, model: 'rock.glb', yaw: 1 }],
  })
  const samples = sampleScatter(spec)
  assert.equal(samples[2].scale, 3)
  assert.equal(samples[2].model, 'tree.glb')
  assert.equal(samples[4].model, 'rock.glb')
  assert.equal(samples[4].yaw, 1)
  assert.equal(samples[0].model, 'tree.glb')
  assert.equal(samples[3].index, 3)
})

gate('scatter samples stay inside bounds and ranges over 2000 points', () => {
  const spec = parseScatterSpec({ bounds: { minX: -10, maxX: 10, minZ: -5, maxZ: 5 }, count: 2000, seed: 3, scale: { min: 0.5, max: 2 }, yaw: { min: 0, max: 6.28 } })
  for (const s of sampleScatter(spec)) {
    assert.ok(s.x >= -10 && s.x <= 10 && s.z >= -5 && s.z <= 5, `point ${s.index}`)
    assert.ok(s.scale >= 0.5 && s.scale <= 2, `scale ${s.index}`)
    assert.ok(s.yaw >= 0 && s.yaw <= 6.28, `yaw ${s.index}`)
  }
})

gate('scatter sampling is deterministic per seed and a changed seed moves the points', () => {
  const base = { bounds: { minX: -10, maxX: 10, minZ: -5, maxZ: 5 }, count: 20, model: 'm' }
  const a = sampleScatter(parseScatterSpec({ ...base, seed: 4 }))
  const b = sampleScatter(parseScatterSpec({ ...base, seed: 4 }))
  const c = sampleScatter(parseScatterSpec({ ...base, seed: 5 }))
  assert.deepStrictEqual(a, b)
  assert.notEqual(a[0].x, c[0].x)
})

gate('scatter override scale of zero is refused and an index outside count is refused', () => {
  assert.throws(() => parseScatterSpec({ bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, count: 5, overrides: [{ index: 1, scale: 0 }] }), (e) => e instanceof ScatterSpecError && e.reasonCode === 'bad-override')
  assert.throws(() => parseScatterSpec({ bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, count: 5, overrides: [{ index: 5 }] }), (e) => e instanceof ScatterSpecError && e.reasonCode === 'bad-override')
})

for (const c of fixture.atlas) {
  gate(`atlas layout matches spoint for ${JSON.stringify(c.spec)}`, () => {
    assert.deepStrictEqual(outcome(() => atlasLayout(c.spec)), c.result)
  })
}

gate('atlas layout places cells row by row, by hand from the source', () => {
  const single = atlasLayout({ frameSize: [32, 32], animations: { idle: 4, run: 6 } })
  assert.equal(single.width, 320)
  assert.equal(single.height, 32)
  assert.equal(single.clips.run.start, 4)
  assert.deepStrictEqual(single.clips.run.cells[0], [128, 0])
  assert.deepStrictEqual(single.clips.run.cells[5], [288, 0])
  const wrapped = atlasLayout({ frameSize: [16, 8], animations: { idle: 4, run: 6, jump: 3 }, columns: 4 })
  assert.equal(wrapped.rows, 4)
  assert.equal(wrapped.height, 32)
  assert.equal(wrapped.width, 64)
  assert.equal(wrapped.clips.jump.start, 10)
  assert.deepStrictEqual(wrapped.clips.jump.cells[0], [32, 16])
})

gate('atlas refuses a bad frame size with the detail the source gives', () => {
  assert.throws(() => atlasLayout({ frameSize: [0, 4], animations: { a: 1 } }), (e) => e instanceof AtlasSpecError && e.message === '[atlas] frame-size-invalid [0,4]')
})

const roomLogRun = (c) => {
  const options = c.input.ctor ?? { capacity: c.input.capacity }
  const ctor = outcome(() => new RoomLog(options))
  if (!ctor.ok) return { ctor, steps: [] }
  const log = new RoomLog(options)
  const steps = c.input.steps.map((step) => {
    if ('append' in step) return outcome(() => log.append(...step.append))
    return outcome(() => (step.read === null ? log.read() : log.read(step.read)))
  })
  return { ctor, steps }
}

for (const c of fixture.roomLog) {
  gate(`room log replay matches spoint: case ${JSON.stringify(c.input.ctor ?? c.input.capacity)}`, () => {
    assert.deepStrictEqual(roomLogRun(c), c.result)
  })
}

gate('room log assigns sequence numbers and evicts past capacity, by hand', () => {
  const log = new RoomLog({ capacity: 2 })
  assert.equal(log.append('info', 'a', 'x', null), 1)
  assert.equal(log.append('info', 'a', 'y', null), 2)
  assert.equal(log.append('info', 'a', 'z', null), 3)
  const page = log.read({})
  assert.deepStrictEqual(page.entries.map((e) => e.seq), [2, 3])
  assert.equal(page.dropped, 1)
  assert.equal(page.nextCursor, 3)
  assert.equal(page.more, false)
})

gate('room log refuses an error with no path with reason missing-path', () => {
  const log = new RoomLog()
  assert.throws(() => log.append('error', 'db', 'boom', ''), (e) => e instanceof RoomLogError && e.reasonCode === 'missing-path')
  assert.throws(() => log.append('loud', 'db', 'boom', null), (e) => e instanceof RoomLogError && e.reasonCode === 'bad-level')
})

gate('control: a log with a larger capacity reports no drops where a small one does', () => {
  const small = new RoomLog({ capacity: 2 })
  const large = new RoomLog({ capacity: 1000 })
  for (const log of [small, large]) {
    log.append('info', 'a', 'x', null)
    log.append('info', 'a', 'y', null)
    log.append('info', 'a', 'z', null)
  }
  assert.equal(small.read({}).dropped, 1)
  assert.equal(large.read({}).dropped, 0)
  assert.notDeepEqual(small.read({}), large.read({}))
})

const timeOfDayRun = (c) => {
  let index = 0
  const getConfig = () => c.config[Math.min(index, c.config.length - 1)]
  const tod = createServerTimeOfDay(getConfig, () => NOW)
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

for (const c of fixture.timeOfDay) {
  gate(`time of day replay matches spoint: ${c.input.name}`, () => {
    assert.deepStrictEqual(timeOfDayRun(c.input), c.steps)
  })
}

gate('time of day continues a seeded day from its timestamp, by hand', () => {
  const tod = createServerTimeOfDay(() => ({ serverAuthoritative: true, seed: { t: 0.5, atMs: NOW - 30000, dayLengthSec: 600 } }), () => NOW + 6000)
  tod.isEnabled()
  assert.ok(Math.abs(tod.getFraction() - 0.56) < 1e-12)
})

gate('time of day takes its clock from the argument and refuses a missing one', () => {
  assert.throws(() => createServerTimeOfDay(() => null), TypeError)
  const seeded = { serverAuthoritative: true, seed: { t: 0.5, atMs: NOW - 30000, dayLengthSec: 600 } }
  const early = createServerTimeOfDay(() => seeded, () => NOW)
  const late = createServerTimeOfDay(() => seeded, () => NOW + 60000)
  early.isEnabled()
  late.isEnabled()
  assert.ok(Math.abs(early.getFraction() - 0.55) < 1e-12)
  assert.ok(Math.abs(late.getFraction() - 0.65) < 1e-12)
})

gate('time of day broadcasts once per interval, by hand, with the default five seconds', () => {
  const tod = createServerTimeOfDay(() => ({ serverAuthoritative: true }), () => NOW)
  tod.tick(3)
  assert.equal(tod.shouldBroadcast(), false)
  tod.tick(2)
  assert.equal(tod.shouldBroadcast(), true)
  assert.equal(tod.shouldBroadcast(), false)
})

const fakeBus = { emit: (channel, data, meta) => ({ channel, data, meta: { timestamp: 42 } }) }

for (const c of fixture.envelopeEmit) {
  gate(`envelope emit matches spoint: ${JSON.stringify(c.input.channel)} ${JSON.stringify(c.input.meta)}`, () => {
    const got = outcome(() => {
      const env = emitEnvelope(fakeBus, c.input.channel, c.input.data, c.input.meta, () => 'fixed-id')
      return { idType: typeof env.id, ts: env.ts, source: env.source, kind: env.kind, payload: env.payload }
    })
    assert.deepStrictEqual(got, c.result)
  })
}

gate('envelope emit uses the supplied id and refuses a missing id source', () => {
  const env = emitEnvelope(fakeBus, 'hit', { dmg: 3 }, {}, () => 'fixed-id')
  assert.equal(env.id, 'fixed-id')
  assert.equal(env.source, 'spoint:entity:unknown')
  assert.throws(() => emitEnvelope(fakeBus, 'hit', {}, {}), TypeError)
})

for (const c of fixture.envelopeValidate) {
  gate(`envelope validate matches spoint: case ${JSON.stringify(c.env)}`, () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(validateEnvelope(c.env))), c.result)
  })
}

gate('event ids use the injected clock and random source in spoint fallback form', () => {
  const next = createEventIds({ now: () => NOW, random: () => 0.5 })
  assert.equal(next(), `${NOW.toString(36)}-i`)
  const withUuid = createEventIds({ now: () => NOW, random: () => 0.5, uuid: () => 'u-1' })
  assert.equal(withUuid(), 'u-1')
  assert.throws(() => createEventIds({ random: () => 0.5 }), TypeError)
})

gate('control: the envelope comparison refuses a changed payload', () => {
  const c = fixture.envelopeEmit[1]
  const got = outcome(() => {
    const env = emitEnvelope(fakeBus, c.input.channel, { dmg: 4 }, c.input.meta, () => 'fixed-id')
    return { idType: typeof env.id, ts: env.ts, source: env.source, kind: env.kind, payload: env.payload }
  })
  assert.notDeepStrictEqual(got, c.result)
})

gate('benchmark shapes the spoint payload from the injected snapshot, by hand', () => {
  const ctx = {
    tickSystem: { getStats: () => ({ avgTickMs: 1.5, p50TickMs: 1.2, p99TickMs: 4 }), getTickRate: () => 20, dilationFactor: 1.25 },
    appRuntime: { getEntityCount: () => 42, getAppCount: () => 7 },
    players: { getPlayerCount: () => 3 },
    physics: { getBodyCount: () => 11 },
    worldDef: { name: 'alpha', terrain: { size: 1 } },
  }
  const host = { now: 1700000000000, uptimeSec: 12.3456, memory: { rss: 100 * 1024 * 1024, heapUsed: 25.5 * 1024 * 1024 }, git: { sha: 'abc', branch: 'main' }, nodeVersion: 'v24.0.0' }
  assert.deepStrictEqual(collectBenchmark(ctx, host), {
    server: { uptimeMs: 12345, tickRate: 20, tickAvgMs: 1.5, tickP50Ms: 1.2, tickP99Ms: 4, dilationFactor: 1.25, playerCount: 3, entityCount: 42, physicsBodyCount: 11, memoryRssMB: 100, memoryHeapMB: 26 },
    world: { name: 'alpha', entityCount: 42, appCount: 7, terrainEnabled: true },
    build: { sha: 'abc', branch: 'main', nodeVersion: 'v24.0.0' },
    timestamp: 1700000000000,
  })
})

gate('benchmark falls back to zeros and unknown names for a bare context, as spoint does', () => {
  const host = { now: NOW, uptimeSec: 0, memory: { rss: 0, heapUsed: 0 }, git: { sha: 'unknown', branch: 'unknown' }, nodeVersion: 'v24.0.0' }
  const out = collectBenchmark({}, host)
  assert.equal(out.server.tickRate, 0)
  assert.equal(out.server.dilationFactor, 1)
  assert.equal(out.server.playerCount, 0)
  assert.equal(out.world.name, 'unknown')
  assert.equal(out.world.terrainEnabled, false)
})

gate('control: a benchmark without a host snapshot is refused', () => {
  assert.throws(() => collectBenchmark({}), TypeError)
})

gate('sender stamp is readable, frozen, hidden from keys and JSON and cannot be restamped', () => {
  const message = { kind: 'move' }
  assert.equal(stampSender(message, { id: 'p1', fromClient: true }), message)
  assert.deepStrictEqual(senderOf(message), { id: 'p1', fromClient: true })
  assert.equal(Object.isFrozen(senderOf(message)), true)
  assert.deepStrictEqual(Object.keys(message), ['kind'])
  assert.equal(JSON.stringify(message), '{"kind":"move"}')
  assert.throws(() => { senderOf(message).id = 'p2' }, TypeError)
  assert.throws(() => stampSender(message, { id: 'p2', fromClient: false }), TypeError)
})

gate('sender stamp refuses bad ids, a non-boolean fromClient and a non-object message', () => {
  assert.throws(() => stampSender({}, { id: '', fromClient: true }), TypeError)
  assert.throws(() => stampSender({}, { id: NaN, fromClient: true }), TypeError)
  assert.throws(() => stampSender({}, { id: true, fromClient: true }), TypeError)
  assert.throws(() => stampSender({}, { id: 1, fromClient: 'yes' }), TypeError)
  assert.throws(() => stampSender(null, { id: 1, fromClient: true }), TypeError)
  assert.equal(senderOf({ n: 1 }), null)
  assert.equal(senderOf(null), null)
  assert.equal(senderOf('text'), null)
  assert.deepStrictEqual(senderOf(stampSender({}, { id: 0, fromClient: false })), { id: 0, fromClient: false })
})

finish()
