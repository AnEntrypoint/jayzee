import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as Gov from '../src/client-pure/qualityGovernor.js'
import * as Tier from '../src/client-pure/qualityTierChoice.js'
import * as Presets from '../src/client-pure/qualityPresets.js'
import * as PostFx from '../src/client-pure/postFxSelection.js'
import * as Frame from '../src/client-pure/frameMetrics.js'
import * as Budget from '../src/client-pure/budgetControllers.js'
import * as Cascade from '../src/client-pure/cascadeShadow.js'
import * as ShadowCost from '../src/client-pure/shadowCostStats.js'
import * as Lod from '../src/client-pure/lodBandPolicy.js'
import * as Impostor from '../src/client-pure/impostorTier.js'
import * as Stream from '../src/client-pure/streamingScheduler.js'
import * as Culling from '../src/client-pure/cullingHub.js'
import * as Bands from '../src/client-pure/drawBands.js'
import * as TouchSpec from '../src/client-pure/touchSurfaceSpec.js'
import * as TouchDraft from '../src/client-pure/touchDraft.js'
import * as Replay from '../src/client-pure/replayBuffer.js'
import * as Grid from '../src/client-pure/groundNodeGrid.js'
import * as Ready from '../src/client-pure/programReadiness.js'
import * as Placement from '../src/client-pure/placementTickGate.js'
import * as Edit from '../src/client-pure/editHistory.js'
import * as Layers from '../src/client-pure/layerRegistry.js'
import * as Hud from '../src/client-pure/hudStats.js'

const here = dirname(fileURLToPath(import.meta.url))
const pureDir = join(here, '..', 'src', 'client-pure')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
const near = (actual, expected, label, eps = 1e-9) => assert(Math.abs(actual - expected) <= eps, `${label}: ${actual} != ${expected}`)
const thrownMessage = fn => {
  try {
    fn()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  return null
}
const throwsReason = (fn, reasonCode) => {
  const error = thrownMessage(fn)
  return error !== null && error.reasonCode === reasonCode
}
const throwsMatching = (fn, pattern) => {
  const error = thrownMessage(fn)
  return error !== null && pattern.test(error.message)
}

const LCG = seed => {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}

const governorRig = (overrides = {}, tiers) => {
  const store = new Map(Object.entries({ maxLevel: 11, splitFactor: 0.25, vegLeafOff: 0, ssao: false, bloom: false, ssr: false, qualityGovernor: true, qualityGovernorOff: false, ...overrides }))
  const writes = []
  const rig = { t: 1000, store, writes }
  rig.gov = Gov.createQualityGovernor({
    read: k => store.get(k),
    write: (k, v) => {
      store.set(k, v)
      writes.push([k, v])
    },
    now: () => rig.t,
    tiers,
  })
  rig.frame = ms => {
    rig.t += ms
    return rig.gov.tick(ms)
  }
  return rig
}

gate('governor holds tier 0 on an in-budget stream and climbs on a sustained overrun', () => {
  const calm = governorRig()
  for (let i = 0; i < 600; i++) calm.frame(12)
  same(calm.gov.tier, 0, 'calm tier')
  const hot = governorRig()
  for (let i = 0; i < 600; i++) hot.frame(25)
  assert(hot.gov.tier > 0, 'sustained 25 ms did not raise the tier')
  assert(hot.gov.tier <= Gov.MAX_TIER, 'tier above MAX_TIER')
})

gate('one hitch above twice the budget sheds one tier at once, cause hitch', () => {
  const rig = governorRig()
  rig.frame(20)
  same(rig.gov.tier, 0, 'a 20 ms frame must not step')
  rig.frame(40)
  same(rig.gov.tier, 1, 'hitch tier')
  same(rig.gov.state().shedCause, 'hitch', 'shed cause')
})

gate('shedding a tier disables the effects and recovery restores them', () => {
  const rig = governorRig({ ssao: true, bloom: true, ssr: true })
  rig.frame(40)
  same(rig.store.get('ssao'), false, 'ssao after hitch')
  same(rig.store.get('bloom'), false, 'bloom after hitch')
  same(rig.store.get('ssr'), false, 'ssr after hitch')
  for (let i = 0; i < 400; i++) rig.frame(5)
  same(rig.gov.tier, 0, 'tier after recovery')
  same(rig.store.get('ssao'), true, 'ssao restored')
  same(rig.store.get('ssr'), true, 'ssr restored')
})

gate('the band between raise and lower never moves the tier', () => {
  const rig = governorRig()
  for (let i = 0; i < 900; i++) rig.frame(15)
  same(rig.gov.tier, 0, 'in-band tier')
  const shedding = governorRig()
  for (let i = 0; i < 900; i++) shedding.frame(25)
  assert(shedding.gov.tier > 0, 'negative control: out-of-band frames must move the tier')
})

gate('the tier stays inside [0, MAX_TIER] and setTier clamps both ways', () => {
  const rig = governorRig()
  for (let i = 0; i < 1500; i++) rig.frame(60)
  same(rig.gov.tier, Gov.MAX_TIER, 'ceiling of shedding')
  same(rig.gov.setTier(99), Gov.MAX_TIER, 'setTier high clamp')
  same(rig.gov.setTier(-3), 0, 'setTier low clamp')
  same(rig.gov.setTier(2), 2, 'setTier in range')
})

gate('setTier before the first tick is ignored, and effectBudget follows the tier scale', () => {
  const rig = governorRig()
  same(rig.gov.setTier(3), 0, 'setTier before any tick must not apply')
  same(rig.gov.effectBudget(37), 37, 'tier 0 effect budget')
  rig.frame(5)
  same(rig.gov.setTier(3), 3, 'setTier after the base is captured applies')
  same(rig.gov.effectBudget(37), 18, 'tier 3 effect budget floors 37 * 0.5')
  assert(rig.gov.effectBudget(37) !== 37, 'negative control: a shed tier must reduce the effect budget')
})

gate('effectCountBudget floors and refuses a base count or scale out of range', () => {
  same(Gov.effectCountBudget(37, 0.5), 18, 'floor of 37 * 0.5')
  same(Gov.effectCountBudget(37, 1), 37, 'unit scale keeps the count')
  assert(throwsMatching(() => Gov.effectCountBudget(-1, 0.5), /non-negative/), 'negative base not refused')
  assert(throwsMatching(() => Gov.effectCountBudget(37, 0), /\(0, 1\]/), 'zero scale not refused')
  assert(throwsMatching(() => Gov.effectCountBudget(37, 1.5), /\(0, 1\]/), 'scale above one not refused')
})

gate('leaf cutoff and gate arithmetic keeps unlimited at zero and floors the gate at the mid band', () => {
  same(Gov.leafCutoffM(NaN), 0, 'NaN cutoff is unlimited')
  same(Gov.leafCutoffM(40), 40, 'finite cutoff kept')
  same(Gov.leafGateM(10), Gov.LEAF_OFF_MID_BAND_EDGE_M, 'gate floored at mid band')
  same(Gov.leafGateM(60), 60, 'gate above mid band kept')
  same(Gov.leafGateM(0), 0, 'zero gate is unlimited')
  same(Gov.leafGateM(10, 50), 50, 'custom mid band')
  assert(Gov.leafGateM(10) !== 10, 'negative control: a 10 m cutoff must not gate at 10 m')
})

gate('the tier table refuses a resolution key and accepts effect-only tables', () => {
  assert(throwsMatching(() => Gov.createQualityGovernor({ tiers: [{ maxLevel: 9 }, { dpr: 0.5 }] }), /dpr/), 'resolution key in tier table not refused')
  assert(throwsMatching(() => Gov.createQualityGovernor({ tiers: [{ maxLevel: 9 }, { bloomResolutionScale: 1 }] }), /bloomResolutionScale/), 'resolution key not refused')
  Gov.createQualityGovernor({ tiers: [{ maxLevel: 9 }, { ssao: false }] })
})

gate('the governed knobs are the six spoint names and none is a resolution key', () => {
  same(Gov.GOVERNED_KNOBS.map(k => k.key), ['ssao', 'bloom', 'ssr', 'vegLeafOff', 'maxLevel', 'splitFactor'], 'governed knob names')
  assert(Gov.GOVERNED_KNOBS.every(k => !Gov.RESOLUTION_KEYS.has(k.key)), 'a governed knob is a resolution key')
  assert(Gov.RESOLUTION_KEYS.has('dpr'), 'negative control: dpr must be a resolution key')
})

gate('the governor writes only governed keys and its state mirror', () => {
  const rig = governorRig({ ssao: true, bloom: true, ssr: true })
  for (let i = 0; i < 900; i++) rig.frame(i < 200 ? 30 : 6)
  const allowed = new Set(['maxLevel', 'splitFactor', 'vegLeafOff', 'ssao', 'bloom', 'ssr', 'qualityGovernorState'])
  assert(rig.writes.every(([k]) => allowed.has(k)), 'a write outside the governed set')
  assert(rig.writes.some(([k]) => k === 'ssao'), 'negative control: the run must shed ssao')
  assert(!rig.writes.some(([k]) => Gov.RESOLUTION_KEYS.has(k)), 'a resolution key was written')
})

const runPinnedTrace = seed => {
  const rand = LCG(seed)
  const script = []
  for (let i = 0; i < 1500; i++) {
    const phase = Math.floor(i / 150) % 4
    const base = phase === 0 ? 8 : phase === 1 ? 19 : phase === 2 ? 26 : 12
    script.push(rand() < 0.03 ? 45 + rand() * 30 : base + (rand() - 0.5) * 6)
  }
  const store = new Map([['maxLevel', 11], ['splitFactor', 0.25], ['vegLeafOff', 0], ['ssao', true], ['bloom', true], ['ssr', true], ['qualityGovernor', true], ['qualityGovernorOff', false]])
  let writes = 0
  let t = 1000
  const gov = Gov.createQualityGovernor({ read: k => store.get(k), write: (k, v) => { store.set(k, v); writes++ }, now: () => t })
  let peak = 0
  for (const ms of script) {
    t += ms
    peak = Math.max(peak, gov.tick(ms))
  }
  const state = gov.state()
  return { tier: state.tier, steps: state.steps, writes, shedCause: state.shedCause, excursions: state.excursions, leafOffM: state.leafOffM, peak, avgMs: state.avgMs }
}

gate('the 1500-frame governor run reproduces the outcome checked against spoint, and a new seed does not', () => {
  const pinned = runPinnedTrace(7)
  same([pinned.tier, pinned.steps, pinned.writes, pinned.shedCause, pinned.excursions, pinned.leafOffM, pinned.peak], [5, 7, 99, 'hitch', 8, 40, 5], 'pinned trace outcome')
  near(pinned.avgMs, 21.63, 'final avg', 1e-9)
  const other = runPinnedTrace(8)
  assert(JSON.stringify(other) !== JSON.stringify(pinned), 'negative control: a different frame script must change the outcome')
})

gate('tier choice accepts null and in-range integers and refuses each reason code', () => {
  same(Tier.resolveQualityTier(null, 3), null, 'null request')
  same(Tier.resolveQualityTier(3, 3), 3, 'request at ceiling')
  assert(throwsReason(() => Tier.resolveQualityTier(4, 3), 'out-of-range'), 'above ceiling not refused')
  assert(throwsReason(() => Tier.resolveQualityTier(-1, 3), 'out-of-range'), 'below zero not refused')
  assert(throwsReason(() => Tier.resolveQualityTier(1.5, 3), 'bad-request'), 'fraction not refused')
  assert(throwsReason(() => Tier.resolveQualityTier('1', 3), 'bad-request'), 'string not refused')
  assert(throwsReason(() => Tier.resolveQualityTier(2, 2.5), 'bad-ceiling'), 'fractional ceiling not refused')
  assert(throwsReason(() => Tier.resolveQualityTier(2, -1), 'bad-ceiling'), 'negative ceiling not refused')
  assert(Tier.QualityTierError.prototype instanceof Error, 'QualityTierError is not an Error')
})

gate('the preset table keeps Low without shadows and Ultra with ssr', () => {
  same(Presets.PRESETS.Low.shadowsEnabled, false, 'Low shadows')
  same(Presets.PRESETS.Low.toneMappingExposure, 0.8, 'Low exposure')
  same(Presets.PRESETS.Ultra.ssr, true, 'Ultra ssr')
  same(Presets.PRESETS.Medium.ssr, false, 'Medium ssr is off')
  assert(Presets.PRESETS.Low.shadowsEnabled !== Presets.PRESETS.High.shadowsEnabled, 'negative control: Low and High must differ on shadows')
  same(Presets.PRESET_NAMES, ['Low', 'Medium', 'High', 'Ultra'], 'preset order')
})

gate('choosePreset picks Low for mobile and low tiers and Medium with no device', () => {
  same(Presets.choosePreset({ isMobile: true, gpuTier: 'high', hardwareConcurrency: 16, memoryMB: 16384 }, 2), 'Low', 'mobile')
  same(Presets.choosePreset({ gpuTier: 'low' }, 1), 'Low', 'low gpu tier')
  same(Presets.choosePreset({ memoryMB: 1024, hardwareConcurrency: 16 }, 1), 'Low', 'small memory')
  same(Presets.choosePreset(undefined, 1), 'Medium', 'no device info stays deterministic')
  assert(Presets.choosePreset(undefined, 1) !== 'Low', 'negative control: no device must not read as low end')
})

gate('choosePreset picks Ultra for medium high-end at 1.5x DPR and High for 6 cores', () => {
  const highEnd = { gpuTier: 'medium', isMobile: false, hardwareConcurrency: 8, memoryMB: 16384 }
  same(Presets.choosePreset(highEnd, 2), 'Ultra', 'high end at dpr 2')
  same(Presets.choosePreset(highEnd, 1), 'High', 'high end at dpr 1 falls to High')
  same(Presets.choosePreset({ gpuTier: 'medium', hardwareConcurrency: 6 }, 1), 'High', 'six cores')
  same(Presets.choosePreset({ gpuTier: 'medium', hardwareConcurrency: 8, memoryMB: 16384, isMobile: true }, 2), 'Low', 'mobile beats high end')
})

gate('clampDpr keeps a value within [0.5, device cap] and treats null as the cap', () => {
  same(Presets.clampDpr(null, 2), 2, 'null is the cap')
  same(Presets.clampDpr(9, 2), 2, 'above cap clamps')
  same(Presets.clampDpr(0.1, 2), 0.5, 'below floor clamps')
  same(Presets.clampDpr(undefined, 0), 1, 'missing dpr falls back to 1')
  assert(Presets.clampDpr(0.1, 2) !== 0.1, 'negative control: 0.1 must not pass through')
})

gate('applying a preset writes its controls in order and drives the renderer', () => {
  const sets = []
  const presets = Presets.createQualityPresets({ set: (k, v) => sets.push([k, v]), storage: null, devicePixelRatio: 1, warn: () => {} })
  const renderer = { shadowMap: { enabled: null }, pix: null, setPixelRatio(v) { this.pix = v } }
  assert(presets.apply('High', { renderer }) === true, 'High did not apply')
  same(renderer.shadowMap.enabled, true, 'High shadows')
  same(renderer.pix, 1, 'High pixel ratio clamped to cap')
  same(presets.current, 'High', 'current preset')
  same(sets.map(([k]) => k).slice(0, 4), ['dprAuto', 'fogFar', 'vegWind', 'vegAllOff'], 'write order')
  same(presets.controls().fogFar, 300, 'fogFar mirrored')
  const lowRenderer = { shadowMap: { enabled: null }, setPixelRatio() {} }
  presets.apply('Low', { renderer: lowRenderer })
  same(lowRenderer.shadowMap.enabled, false, 'Low disables shadows')
})

gate('an unknown or prototype preset name is refused with a warning', () => {
  const warnings = []
  const presets = Presets.createQualityPresets({ set: () => {}, warn: m => warnings.push(m) })
  same(presets.apply('Nope'), false, 'unknown preset')
  same(presets.apply('toString'), false, 'prototype key refused')
  same(presets.apply('constructor'), false, 'constructor refused')
  same(warnings.length, 3, 'one warning per refusal')
  same(presets.current, null, 'current unchanged after refusals')
  assert(presets.apply('Ultra') === true, 'negative control: a valid name must apply')
})

gate('persisted presets round trip, reject a foreign value, and report wasPersisted', () => {
  const kept = new Map()
  const storage = { getItem: k => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, v) }
  const presets = Presets.createQualityPresets({ set: () => {}, storage, warn: () => {} })
  assert(presets.setPreset('Ultra') === true, 'setPreset refused a valid name')
  same(kept.get(Presets.STORAGE_KEY), 'Ultra', 'stored value')
  same(presets.getPersisted(), 'Ultra', 'read back')
  same(presets.autoApplyPersisted({}), { name: 'Ultra', wasPersisted: true }, 'auto apply persisted')
  kept.set(Presets.STORAGE_KEY, 'constructor')
  same(presets.getPersisted(), null, 'prototype value rejected from storage')
  const bare = Presets.createQualityPresets({ set: () => {}, storage: null })
  same(bare.getPersisted(), null, 'no storage yields no persisted preset')
  same(bare.autoApplyPersisted({ deviceInfo: { gpuTier: 'low' } }), { name: 'Low', wasPersisted: false }, 'auto apply without storage')
})

gate('the post-fx passes follow their spoint shouldRun predicates', () => {
  const controls = { ssao: true, bloom: false, ssr: true, fsr1: false, dpr: null }
  const get = k => controls[k]
  const ctx = { ssao: {}, bloom: {}, ssr: {}, fsr1: {}, frameId: 9, res: { ssaoComputed: 9, bloomComputed: 0, ssrComputed: 0, fsr1Computed: 0 } }
  const on = PostFx.enabledPostFxPasses(get, ctx)
  same(on, ['ssao-compute', 'ssao-composite', 'ssr-compute'], 'enabled passes')
  controls.ssao = false
  assert(!PostFx.postFxPassEnabled('ssr-compute', get, ctx), 'ssr-compute must need ssao on')
  assert(PostFx.postFxPassEnabled('ssr-composite', get, ctx) === false, 'ssr-composite with no ssrComputed frame must be off')
  ctx.res.ssrComputed = 9
  assert(PostFx.postFxPassEnabled('ssr-composite', get, ctx) === true, 'ssr-composite did not follow ssrComputed')
  assert(PostFx.postFxPassEnabled('ssr-compute', get, ctx) === false, 'negative control: ssao off must disable ssr-compute')
})

gate('composite passes need the compute pass of the same frame', () => {
  const controls = { bloom: true, ssao: true }
  const get = k => controls[k]
  const ctx = { bloom: {}, ssao: {}, frameId: 12, res: { bloomComputed: 11, ssaoComputed: 12 } }
  assert(!PostFx.postFxPassEnabled('bloom-composite', get, ctx), 'stale bloom compute frame allowed composite')
  assert(PostFx.postFxPassEnabled('ssao-composite', get, ctx), 'current ssao compute frame refused composite')
  ctx.res.bloomComputed = 12
  assert(PostFx.postFxPassEnabled('bloom-composite', get, ctx), 'negative control: matching frame must enable composite')
})

gate('fsr1 compute runs only when the DPR is downscaled and a window exists', () => {
  const controls = { fsr1: true, dpr: null }
  const get = k => controls[k]
  const ctx = { fsr1: {}, res: { fsr1Computed: 0 }, frameId: 1 }
  assert(!PostFx.postFxPassEnabled('fsr1-compute', get, ctx), 'no dpr must not run fsr1')
  controls.dpr = 1.5
  assert(!PostFx.postFxPassEnabled('fsr1-compute', get, ctx, null), 'no window must not run fsr1')
  assert(PostFx.postFxPassEnabled('fsr1-compute', get, ctx, 2) === true, 'dpr 1.5 of 2 is downscaled and must run')
  controls.dpr = { scale: 0.8 }
  assert(PostFx.postFxPassEnabled('fsr1-compute', get, ctx, 2) === true, 'object dpr scale 0.8 must run')
  controls.dpr = { scale: 1 }
  assert(!PostFx.postFxPassEnabled('fsr1-compute', get, ctx, 2), 'negative control: scale 1 must not run fsr1')
  assert(PostFx.dprIsDownscaled(null, 2) === false, 'null dpr counted as downscaled')
  assert(throwsMatching(() => PostFx.postFxPassEnabled('bloom-blur', get, ctx), /unknown pass/), 'unknown pass not refused')
})

gate('the perf tracker reports nearest-rank percentiles, fps and session stats', () => {
  const tracker = Frame.createPerfTracker()
  for (let i = 1; i <= 100; i++) tracker.sample(i, { calls: i, triangles: i * 2 }, 1, 2)
  const s = tracker.stats()
  same([s.count, s.p50Ms, s.p95Ms, s.p99Ms, s.maxMs], [100, 51, 96, 100, 100], 'percentiles')
  near(s.avgMs, 50.5, 'average', 1e-9)
  same([s.drawCalls, s.triangles, s.players, s.entities], [100, 200, 1, 2], 'last sample fields')
  same(s.gc, undefined, 'no heap sampler, no gc block')
  const session = tracker.exportSession()
  same([session.samples, session.minMs, session.maxMs], [100, 1, 100], 'session bounds')
  tracker.reset()
  same(tracker.stats(), { count: 0 }, 'reset clears the ring')
  same(tracker.exportSession(), null, 'reset clears the session')
  assert(Frame.createPerfTracker().stats().count === 0, 'negative control: a fresh tracker is empty')
})

gate('the perf tracker adds a gc block only when a heap sampler is given', () => {
  let heap = 1000
  const tracker = Frame.createPerfTracker({ heapUsedBytes: () => (heap += 500) })
  for (let i = 0; i < 10; i++) tracker.sample(10, { calls: 0, triangles: 0 }, 0, 0)
  const s = tracker.stats()
  assert(s.gc && s.gc.avgBytesPerFrame === 500, 'gc block missing or wrong')
  assert(s.gc.avgBytesPerSec > 0, 'gc per second missing')
  assert(Frame.createPerfTracker().stats().gc === undefined, 'negative control: no sampler must add no gc block')
})

gate('the vsync monitor flags a stall only when the JS side was short', () => {
  const monitor = Frame.createVsyncMonitor()
  let ts = 0
  for (let i = 0; i < 130; i++) {
    ts += 16.6667
    monitor.tick(ts, 5)
  }
  const stall = monitor.tick(ts + 40, 3)
  assert(stall.isMiss === true && stall.isCompositorStall === true, 'short JS on a 40 ms gap is not a compositor stall')
  ts += 40
  const jsHeavy = monitor.tick(ts + 16.6667, 15)
  assert(jsHeavy.isMiss === false, 'a normal frame after a stall was flagged as a miss')
  ts += 16.6667
  const slowJs = monitor.tick(ts + 40, 15)
  assert(slowJs.isMiss === true && slowJs.isCompositorStall === false, 'negative control: a long JS frame is a miss but not a stall')
})

gate('the vsync monitor counts missed frames and keeps the inferred interval through a huge gap', () => {
  const monitor = Frame.createVsyncMonitor()
  let ts = 0
  for (let i = 0; i < 130; i++) {
    ts += 16.6667
    monitor.tick(ts, 5)
  }
  const late = monitor.tick(ts + 50, 5)
  same(late.missedFrames, 2, 'missed frames for a 50 ms gap at 16.67 ms')
  ts += 50
  const normal = monitor.tick(ts + 16.6667, 5)
  same(normal.missedFrames, 0, 'negative control: a normal frame misses nothing')
  monitor.tick(ts + 16.6667 + 300, 5)
  near(monitor.state().refreshIntervalMs, 16.6667, 'interval after a 300 ms gap', 0.01)
  assert(monitor.state().missCount >= 2, 'miss count not counted')
})

gate('the dpr controller is inert without a window or without dprAuto', () => {
  const sets = []
  const renderer = { setPixelRatio: v => sets.push(v) }
  const noWindow = Budget.createDprController({ windowAvailable: false, read: () => true })
  for (let i = 0; i < 100; i++) noWindow.tick(renderer, 20)
  same(sets, [], 'no window must not set a ratio')
  const off = Budget.createDprController({ windowAvailable: true, devicePixelRatio: 2, read: () => false })
  for (let i = 0; i < 100; i++) off.tick(renderer, 20)
  same(sets, [], 'dprAuto off must not set a ratio')
  const on = Budget.createDprController({ windowAvailable: true, devicePixelRatio: 2, read: k => k === 'dprAuto' })
  for (let i = 0; i < 45; i++) on.tick(renderer, 20)
  same(sets, [1.84], 'negative control: a slow window must lower the ratio from 2 to 1.84')
})

gate('the dpr controller steps down on slow windows, floors at 0.4 and climbs back on fast ones', () => {
  const sets = []
  const renderer = { setPixelRatio: v => sets.push(v) }
  const controller = Budget.createDprController({ windowAvailable: true, devicePixelRatio: 2, read: k => k === 'dprAuto' })
  for (let i = 0; i < 45 * 20; i++) controller.tick(renderer, 12)
  near(controller.stats().scale, 0.4, 'floor of scale', 1e-9)
  for (let i = 0; i < 45 * 20; i++) controller.tick(renderer, 2)
  near(controller.stats().scale, 1, 'ceiling of scale', 1e-9)
  same(controller.stats().deviceMax, 2, 'device max capped at 2')
  same(controller.stats().applied, 2, 'applied ratio back to device max')
  const inBand = Budget.createDprController({ windowAvailable: true, devicePixelRatio: 2, read: k => k === 'dprAuto' })
  for (let i = 0; i < 45 * 4; i++) inBand.tick(renderer, 6.9)
  near(inBand.stats().scale, 1, 'in-band frames keep scale', 1e-9)
})

gate('the terrain vdrs controller steps its scale and reports on through its sink', () => {
  const calls = []
  const sink = { setVdrs: on => calls.push(['on', on]), setVdrsScale: v => calls.push(['scale', v]) }
  const controller = Budget.createTerrainVdrsController({ windowAvailable: true, read: k => k === 'vdrsAuto', sink })
  for (let i = 0; i < 45; i++) controller.tick(12)
  same(calls, [['on', true], ['scale', 0.9]], 'first slow window')
  const idle = Budget.createTerrainVdrsController({ windowAvailable: true, read: k => k === 'vdrsAuto', sink: { setVdrs: () => calls.push('bad') } })
  for (let i = 0; i < 45 * 4; i++) idle.tick(7)
  same(calls.length, 2, 'in-band frames must not call the sink')
  const off = Budget.createTerrainVdrsController({ windowAvailable: true, read: k => k === 'vdrsAuto' || k === 'vdrsOff', sink })
  for (let i = 0; i < 45; i++) off.tick(20)
  same(calls.length, 2, 'vdrsOff must stop the controller')
  near(controller.stats().scale, 0.9, 'stats scale after one slow window', 1e-9)
})

gate('the fog controller pulls far in after three slow windows and clamps to a ceiling multiplier', () => {
  const fog = { isFog: true, near: 10, far: 200 }
  const scene = { fog }
  const controller = Budget.createFogController({ windowAvailable: true, configuredFar: () => 200, report: () => {} })
  for (let i = 0; i < 120; i++) controller.tick(scene, 9)
  same(fog.far, 200, 'two slow windows keep far')
  for (let i = 0; i < 60; i++) controller.tick(scene, 9)
  same(fog.far, 192, 'three slow windows step far down by 8')
  near(fog.near, 192 * 0.05, 'near keeps the ratio', 1e-9)
  controller.setCeilMultiplier('weather', 0.5)
  controller.tick(scene, 9)
  same(fog.far, 120, 'ceiling multiplier clamps far to the floor of 120')
  controller.setCeilMultiplier('weather', 0)
  controller.tick(scene, 9)
  same(fog.far, 192, 'negative control: removing the multiplier restores far')
})

gate('the fog controller does nothing without a window or without a fog', () => {
  const fog = { isFog: true, near: 10, far: 200 }
  const idle = Budget.createFogController({ windowAvailable: false, configuredFar: () => 150 })
  for (let i = 0; i < 200; i++) idle.tick({ fog }, 30)
  same(fog.far, 200, 'no window must leave far alone')
  const windowed = Budget.createFogController({ windowAvailable: true, configuredFar: () => 150, report: () => {} })
  windowed.tick({ fog: { isFog: false, near: 1, far: 9 } }, 9)
  windowed.tick({}, 9)
  same(windowed.mirror().far, 0, 'a scene with no fog must not publish')
})

gate('an inverted fog band is reported and starts fog at the camera', () => {
  const messages = []
  const fog = { isFog: true, near: 300, far: 200 }
  const controller = Budget.createFogController({ windowAvailable: true, configuredFar: () => 200, report: (...args) => messages.push(args.join(' ')) })
  controller.tick({ fog }, 10)
  assert(messages.length === 1 && /is not below far/.test(messages[0]), 'inverted band not reported')
  same(fog.near, 0, 'inverted band starts fog at the camera')
  const healthy = Budget.createFogController({ windowAvailable: true, configuredFar: () => 200, report: () => messages.push('bad') })
  healthy.tick({ fog: { isFog: true, near: 20, far: 200 } }, 10)
  same(messages.length, 1, 'negative control: a valid band must not report')
})

gate('shader cascade count clamps to one through three and ignores invalid input', () => {
  same([1, 0, NaN, undefined].map(Cascade.shaderCascadeCount), [1, 1, 1, 1], 'non-cascading inputs')
  same(Cascade.shaderCascadeCount(2.4), 2, 'rounds down')
  same(Cascade.shaderCascadeCount(5), 3, 'clamps to three')
  assert(Cascade.shaderCascadeCount(5) !== 5, 'negative control: five cascades must not pass through')
})

gate('the shadow pipeline keeps cascade zero from rendering when the sun does not cast', () => {
  same(Cascade.pipelineCascadeCount(3, false), 1, 'sun with castShadow false')
  same(Cascade.pipelineCascadeCount(3, true), 3, 'casting sun keeps three')
  same(Cascade.pipelineCascadeCount(undefined, true), 1, 'missing request defaults to one')
  same(Cascade.pipelineCascadeCount(9, true), 3, 'clamped to MAX_CASCADES')
  assert(Cascade.pipelineCascadeCount(3, false) !== 3, 'negative control: a non-casting sun must not keep three cascades')
})

gate('cascade extents grow by the split ratio and the base extent defaults to 60 m', () => {
  const extents = Cascade.cascadeExtents(60, 3)
  near(extents[0], 60, 'first extent', 1e-9)
  near(extents[1], 192, 'second extent', 1e-9)
  near(extents[2], 614.4, 'third extent', 1e-6)
  same(Cascade.cascadeExtents(60, 1), [60], 'single cascade')
  same(Cascade.resolveBaseExtent(undefined), 60, 'default extent')
  same(Cascade.resolveBaseExtent(25), 25, 'explicit extent kept')
  assert(Cascade.cascadeExtents(60, 2)[1] !== 60, 'negative control: the second extent must not equal the base')
})

gate('the far redraw budget defaults to one, maps null to unlimited and floors below zero', () => {
  same(Cascade.resolveFarRedrawBudget(undefined), 1, 'default budget')
  same(Cascade.resolveFarRedrawBudget(null), Infinity, 'null is unlimited')
  same(Cascade.resolveFarRedrawBudget(-3), 0, 'negative floors to zero')
  same(Cascade.resolveFarRedrawBudget(2.6), 3, 'fraction rounds')
  assert(Cascade.resolveFarRedrawBudget(null) !== 1, 'negative control: null must not be the default')
})

gate('texel size and caster reach follow the shadow pipeline formulas', () => {
  near(Cascade.texelWorldM(60, 1024), 120 / 1024, 'texel size', 1e-12)
  near(Cascade.casterShadowReachM({ x: 40, y: 80, z: 30 }), 12.5, 'caster reach', 1e-12)
  assert(Cascade.casterShadowReachM({ x: 1, y: 0, z: 1 }) === Infinity, 'zero height reach must be infinite')
  assert(Cascade.casterShadowReachM({ x: 1, y: 1e-7, z: 1 }) === Infinity, 'near-zero height reach must be infinite')
})

gate('a cascade band reaches a caster only inside its blended range', () => {
  const extents = [60, 192, 614.4]
  assert(Cascade.cascadeBandReachesCaster(0, 3, 0, extents), 'near caster missed by cascade 0')
  assert(Cascade.cascadeBandReachesCaster(1, 70, 0, extents), 'caster at 70 m missed by cascade 1')
  assert(!Cascade.cascadeBandReachesCaster(1, 200, 0, extents), 'negative control: 200 m is outside cascade 1 with blend')
  assert(Cascade.cascadeBandReachesCaster(1, 200, 20, extents), 'reach must widen the band')
})

gate('the sun is rehomed only past the texel threshold and a zero vector is a right angle', () => {
  const current = { x: 0, y: 1, z: 0 }
  assert(!Cascade.sunDirectionMoved(current, { x: 0, y: 1, z: 0 }, 0.1171875), 'identical direction counted as moved')
  const tilted = { x: Math.sin(Math.PI / 180), y: Math.cos(Math.PI / 180), z: 0 }
  assert(Cascade.sunDirectionMoved(current, tilted, 0.1171875), 'a one degree move must rehome the sun')
  near(Cascade.angleBetween({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), Math.PI / 2, 'zero vector angle', 1e-12)
  assert(!Cascade.sunDirectionMoved(current, { x: 0, y: 1, z: 0 }, 0), 'negative control: a zero texel threshold still needs a real move')
})

gate('the cascade redraw budget defers far cascades and forces them after two frames', () => {
  const cascades = [0, 1, 2].map(index => ({ index, pendingFrames: 0 }))
  const moved = []
  const updateAll = c => { moved.push(c.index); return true }
  assert(Cascade.planCascadeUpdates(cascades, 1, updateAll) === true, 'no cascade moved')
  same(moved, [0, 1], 'budget 1 updates cascade 0 and one far cascade')
  same(cascades[2].pendingFrames, 1, 'third cascade deferred one frame')
  Cascade.planCascadeUpdates(cascades, 1, updateAll)
  same(cascades[2].pendingFrames, 2, 'deferred a second frame')
  Cascade.planCascadeUpdates(cascades, 1, updateAll)
  same(cascades[2].pendingFrames, 0, 'forced on the third frame')
  const unlimited = [0, 1, 2].map(index => ({ index, pendingFrames: 0 }))
  const all = []
  Cascade.planCascadeUpdates(unlimited, Infinity, c => { all.push(c.index); return true })
  same(all, [0, 1, 2], 'negative control: an unlimited budget updates every cascade')
})

gate('the splits literal and its patch match the shader chunk text', () => {
  same(Cascade.splitLiteral([60, 192, 614.4]), 'SPOINT_CASCADE_SPLITS[3] = float[3](60.00, 192.00, 614.40)', 'literal')
  same(Cascade.splitLiteral([]), 'SPOINT_CASCADE_SPLITS[3] = float[3](0.00, 0.00, 0.00)', 'missing extents become zero')
  const source = 'a\nSPOINT_CASCADE_SPLITS[3] = float[3](0.00, 0.00, 0.00)\nb'
  same(Cascade.patchCascadeSplits(source, [1, 2, 3]), 'a\nSPOINT_CASCADE_SPLITS[3] = float[3](1.00, 2.00, 3.00)\nb', 'patched chunk')
  same(Cascade.patchCascadeSplits(source, 'nope'), source, 'negative control: a non-array leaves the chunk unchanged')
})

gate('the cascade weights form a partition of unity across a boundary and cut off far from it', () => {
  const splits = [60, 192, 614.4]
  near(Cascade.cascadeWeight(0, 10, splits), 1, 'cascade 0 inside its band', 1e-12)
  near(Cascade.cascadeWeight(1, 10, splits), 0, 'cascade 1 far below its band', 1e-12)
  near(Cascade.cascadeWeight(0, 58, splits) + Cascade.cascadeWeight(1, 58, splits), 1, 'boundary partition', 1e-12)
  near(Cascade.cascadeWeight(0, 100, splits), 0, 'cascade 0 beyond its far edge', 1e-12)
  near(Cascade.cascadeWeight(1, 100, splits), 1, 'cascade 1 across its band', 1e-12)
  assert(Cascade.cascadeWeight(0, 10, splits) !== 0, 'negative control: cascade 0 must not vanish inside its band')
})

gate('the cascade constants keep the spoint values', () => {
  same([Cascade.CASCADE_BLEND_M, Cascade.SHADOW_CASTER_ONLY_LAYER, Cascade.MAX_CASCADES, Cascade.CASCADE_SPLIT], [4, 30, 3, 3.2], 'cascade constants')
  same([Cascade.SHADOW_REDRAW_CASTER_HEIGHT_M, Cascade.DEPTH_STEP_DIVISOR, Cascade.FAR_CASCADE_MAX_DEFER_FRAMES], [20, 16, 2], 'redraw constants')
  assert(Cascade.SHADOW_CASTER_ONLY_LAYER !== 0, 'negative control: the caster-only layer must not be layer zero')
})

gate('dynamic caster detection walks the parent chain and honours an explicit false', () => {
  const root = { userData: { isDynamicShadowCaster: true }, parent: null }
  const child = { userData: {}, parent: root }
  assert(ShadowCost.isDynamicShadowCaster(child) === true, 'inherited dynamic marker missed')
  const overridden = { userData: { isDynamicShadowCaster: false }, parent: root }
  assert(ShadowCost.isDynamicShadowCaster(overridden) === false, 'explicit false overridden by parent')
  assert(ShadowCost.isDynamicShadowCaster({ userData: {}, parent: null }) === false, 'negative control: no marker is static')
})

gate('shadow caster classification keeps only cast-shadow meshes and splits them static or dynamic', () => {
  const dyn = { isMesh: true, castShadow: true, userData: { isDynamicShadowCaster: true }, parent: null }
  const stat = { isMesh: true, castShadow: true, userData: {}, parent: null }
  const inst = { isInstancedMesh: true, castShadow: true, userData: {}, parent: null }
  const light = { castShadow: true, userData: {}, parent: null }
  const hidden = { isMesh: true, castShadow: false, userData: {}, parent: null }
  const result = ShadowCost.classifyShadowCasters([dyn, stat, inst, light, hidden])
  same([result.staticObjs.length, result.dynamicObjs.length], [2, 1], 'split counts')
  assert(!result.staticObjs.includes(light) && !result.dynamicObjs.includes(light), 'negative control: a light is not a caster')
  assert(!result.staticObjs.includes(hidden), 'a non-casting mesh was classified')
})

gate('pass sample summaries use the nearest-rank p95 and empty input gives nulls', () => {
  same(ShadowCost.summarizePassSamples([]), { avg: null, p95: null, max: null }, 'empty samples')
  const ten = ShadowCost.summarizePassSamples([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  same(ten, { avg: 5.5, p95: 10, max: 10 }, 'ten samples')
  const twenty = ShadowCost.summarizePassSamples(Array.from({ length: 20 }, (_, i) => i + 1))
  same(twenty.p95, 20, 'p95 index floor(0.95 * n)')
  assert(ShadowCost.summarizePassSamples([3, 1, 2]).max === 3, 'negative control: max must be the largest sample')
})

gate('the sample ring caps at its capacity and keeps the newest entries', () => {
  const ring = ShadowCost.createPassSampleRing(3)
  for (let i = 1; i <= 5; i++) ring.push(i)
  same(ring.list(), [3, 4, 5], 'newest three kept')
  const big = ShadowCost.createPassSampleRing()
  for (let i = 0; i < 300; i++) big.push(i)
  same(big.list().length, ShadowCost.SAMPLE_CAP, 'default cap')
  same(big.list()[0], 60, 'oldest retained is 60')
  ring.reset()
  same(ring.list(), [], 'reset empties the ring')
})

gate('split shares are a percentage of combined and null when combined is not positive', () => {
  same(ShadowCost.splitShares(3, 1, 4), { staticShareOfCombined: 75, dynamicShareOfCombined: 25 }, 'shares of 4 ms')
  same(ShadowCost.splitShares(3, 1, 0), { staticShareOfCombined: null, dynamicShareOfCombined: null }, 'zero combined')
  assert(ShadowCost.splitShares(3, 1, 0).staticShareOfCombined !== 0, 'negative control: zero combined is null not zero')
  const built = ShadowCost.buildSplitResult({ staticOnly: { ms: 3, calls: 2, triangles: 10 }, dynamicOnly: { ms: 1, calls: 1, triangles: 4 }, combined: { ms: 4, calls: 3, triangles: 14 }, staticObjs: [1, 2], dynamicObjs: [1], cascadeCount: 3, ts: 77 })
  same([built.staticMs, built.combinedMs, built.staticObjects, built.dynamicTriangles, built.cascadeCount, built.ts], [3, 4, 2, 4, 3, 77], 'split result fields')
})

gate('the lod tier maps squared distance to the highest threshold passed', () => {
  const policy = Lod.createLodBandPolicy({ levels: [{ distance: 0 }, { distance: 50 }, { distance: 100 }] })
  same([policy.lodTierFor(0), policy.lodTierFor(2600), policy.lodTierFor(9999), policy.lodTierFor(10000)], [0, 1, 1, 2], 'tiers at squared distances')
  assert(policy.lodTierFor(2499) === 0, 'negative control: below the 50 m threshold must stay at tier 0')
  assert(throwsMatching(() => Lod.createLodBandPolicy({ levels: [] }), /at least one LOD level/), 'empty levels not refused')
})

gate('lod hysteresis keeps a band until the leave distance and an unset band starts raw', () => {
  const policy = Lod.createLodBandPolicy({ levels: [{ distance: 0 }, { distance: 50 }, { distance: 100 }], hysteresis: 0.1 })
  same(policy.tierFor(2500, 1), 1, 'inside the leave hysteresis stays on band 1')
  same(policy.tierFor(2000, 1), 0, 'past the leave distance drops to band 0')
  same(policy.tierFor(2500, Lod.BAND_UNSET), 0, 'unset band uses the raw tier')
  assert(policy.tierFor(2000, 1) !== 1, 'negative control: a band must not be held past its leave distance')
})

gate('the mesh far edge culls with hysteresis and brings back below the re-enter distance', () => {
  const policy = Lod.createLodBandPolicy({ levels: [{ distance: 0 }, { distance: 50 }, { distance: 100 }], hysteresis: 0.1 })
  policy.setMeshFarEdges(200, undefined)
  same(policy.tierFor(40001, 2), Lod.NO_MESH_TIER, 'beyond mesh far is no mesh')
  same(policy.tierFor(30000, Lod.NO_MESH_TIER), Lod.NO_MESH_TIER, 'still culled between in and far')
  same(policy.tierFor(20000, Lod.NO_MESH_TIER), 2, 'comes back inside the in distance')
  near(policy.meshFarDist(), 200, 'mesh far distance', 1e-12)
  assert(policy.meshReentryDist() === undefined, 'an omitted re-entry distance is stored as given')
  assert(Number.isNaN(Lod.createLodBandPolicy({ levels: [{ distance: 1 }] }).meshReentryDist()), 'negative control: a fresh policy has no re-entry distance (NaN)')
  assert(policy.meshOutOfRange(40000) === true && policy.meshOutOfRange(39999) === false, 'meshOutOfRange boundary')
})

gate('the shadow switch turns on inside the on radius and off only past the off radius', () => {
  const policy = Lod.createLodBandPolicy({ levels: [{ distance: 10 }], hysteresis: 0.1, shadowDistance: 100 })
  assert(policy.shadowWantedOf(9000, false) === false, 'outside the on radius turned on')
  assert(policy.shadowWantedOf(8000, false) === true, 'inside the on radius did not turn on')
  assert(policy.shadowWantedOf(9000, true) === true, 'shadow held inside the off radius')
  assert(policy.shadowWantedOf(13000, true) === false, 'negative control: beyond the off radius the shadow must switch off')
  const noShadow = Lod.createLodBandPolicy({ levels: [{ distance: 10 }] })
  assert(noShadow.shadowWantedOf(0, true) === false, 'no shadow distance must never want a shadow')
})

gate('a cell takes the all, mixed or none shadow mode from its squared distance range', () => {
  const policy = Lod.createLodBandPolicy({ levels: [{ distance: 10 }], hysteresis: 0.1, shadowDistance: 100 })
  same(policy.cellShadowMode(0, 8000), Lod.SHADOW_ALL, 'cell fully inside the on radius')
  same(policy.cellShadowMode(9000, 13000), Lod.SHADOW_MIXED, 'cell straddling the off radius')
  same(policy.cellShadowMode(13000, 14000), Lod.SHADOW_NONE, 'cell fully beyond the off radius')
  assert(policy.cellShadowMode(0, 8000) !== Lod.SHADOW_NONE, 'negative control: a cell inside the on radius must cast')
  const unshadowed = Lod.createLodBandPolicy({ levels: [{ distance: 10 }] })
  same(unshadowed.cellShadowMode(0, 0), Lod.SHADOW_NONE, 'no shadow distance means no shadow mode')
})

gate('the leaf gate is hysteretic and each gated tier is no-mesh when past the cutoff', () => {
  const policy = Lod.createLodBandPolicy({ levels: [{ distance: 10 }] })
  policy.setLeafDrawDistance(40)
  near(policy.leafDrawDistance(), 40, 'leaf distance', 1e-12)
  assert(policy.gateAt(1500, true) === true, 'inside the release band a gated leaf stays gated')
  assert(policy.gateAt(1500, false) === false, 'inside the release band an ungated leaf stays ungated')
  assert(policy.gateAt(1700, false) === true, 'beyond the gate radius leaves are gated')
  assert(policy.gateAt(1000, true) === false, 'negative control: below the release band the gate lifts')
  same(policy.leafGatedTier(3, 2000, undefined), Lod.NO_MESH_TIER, 'ungated query past the cutoff')
  same(policy.leafGatedTier(3, 2000, false), 3, 'explicit false keeps the tier')
  same(policy.leafGatedTier(3, 2000, true), Lod.NO_MESH_TIER, 'explicit true drops the mesh')
  policy.setLeafDrawDistance(0)
  assert(policy.gateAt(1e9, false) === false, 'a zero leaf distance must be unlimited')
})

gate('a cell crosses a band only when its distance range overlaps the band', () => {
  const policy = Lod.createLodBandPolicy({ levels: [{ distance: 0 }, { distance: 50 }, { distance: 100 }] })
  policy.setMeshFarEdges(200, undefined)
  assert(policy.cellCrossesBand(10000, 50000) === true, 'overlapping cell missed the mesh band')
  assert(policy.cellCrossesBand(41000, 50000) === false, 'negative control: a cell fully past mesh far crossed a band')
  assert(policy.cellCrossesBand(2400, 2600) === true, 'cell straddling the 50 m threshold missed')
})

gate('the impostor handoff brackets the near cutoff by the fade band', () => {
  same(Impostor.impostorHandoffDistances(40), { impostorStart: 37, meshEnd: 43 }, 'handoff distances')
  assert(Impostor.impostorHandoffDistances(40).meshEnd !== 37, 'negative control: mesh end must not equal impostor start')
  assert(Impostor.hasNearLodCutoff(40) === true && Impostor.hasNearLodCutoff(0) === false && Impostor.hasNearLodCutoff(NaN) === false, 'near cutoff validity')
})

gate('the impostor dissolve keeps every fragment past the cutoff and discards some just inside it', () => {
  let kept = 0
  let total = 0
  for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) {
    total++
    if (Impostor.impostorDissolveKeeps(60, 40, x, y)) kept++
  }
  same(kept, total, 'fully faded-in keeps all fragments')
  let discarded = 0
  for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) if (!Impostor.impostorDissolveKeeps(37, 40, x, y)) discarded++
  assert(discarded > 0, 'fully dissolved fragments were never discarded')
  assert(discarded < total, 'negative control: at the fade start not every fragment is dropped')
})

gate('impostor capacity takes the smaller of max and init, and the webgpu path uses max alone', () => {
  same(Impostor.impostorInstanceCapacity({}), { capacity: 4096, webgpuCapacity: 4096 }, 'defaults')
  same(Impostor.impostorInstanceCapacity({ maxInstances: 100 }), { capacity: 100, webgpuCapacity: 100 }, 'small max')
  same(Impostor.impostorInstanceCapacity({ initCapacity: 8000 }), { capacity: 8000, webgpuCapacity: 8000 }, 'init below max')
  same(Impostor.impostorInstanceCapacity({ maxInstances: 20000, initCapacity: 512 }), { capacity: 512, webgpuCapacity: 20000 }, 'webgpu uses max')
})

gate('the impostor atlas lays species on a square grid with top-down rows on request', () => {
  const species = [0, 1, 2, 3, 4].map(() => ({ albedo: true, normal: null, imageWidth: 64 }))
  const layout = Impostor.planImpostorAtlas(species, { topDown: false })
  same([layout.gridSide, layout.mega, layout.tileScale, layout.hasNormal], [3, 192, 1 / 3, false], 'grid')
  same(layout.tiles[4], { species: 4, col: 1, row: 1, offset: [1 / 3, 1 / 3] }, 'tile four')
  same(layout.megaBytes, 192 * 192 * 4, 'albedo bytes')
  same(layout.copies[0].dst, [0, 0], 'bottom-up row zero')
  const flipped = Impostor.planImpostorAtlas(species, { topDown: true })
  same(flipped.copies[0].dst, [0, 128], 'top-down row zero is the last row')
  assert(flipped.copies[0].dst[1] !== layout.copies[0].dst[1], 'negative control: top-down must change the row offset')
})

gate('a normal atlas doubles the byte counts and an empty species list gives no atlas', () => {
  const species = [0, 1, 2, 3].map(() => ({ albedo: true, normal: true, imageWidth: 32 }))
  const layout = Impostor.planImpostorAtlas(species, {})
  same(layout.hasNormal, true, 'normal planes present')
  same([layout.megaBytes, layout.perSpeciesBytes], [64 * 64 * 4 * 2, 4 * 32 * 32 * 4 * 2], 'doubled bytes')
  same(layout.copies.every(c => c.copyNormal), true, 'every tile copies its normal')
  same(Impostor.planImpostorAtlas([], {}), null, 'empty atlas is null')
  same(Impostor.planImpostorAtlas([{ albedo: null }], {}), null, 'a species with no albedo is dropped')
  same(Impostor.planImpostorAtlas([{ albedo: true, imageWidth: 0 }], {}).atlasSize, 1024, 'missing width defaults to 1024')
})

gate('only a webgpu renderer with a webgpu backend uses top-down atlas storage', () => {
  assert(Impostor.usesTopDownAtlasStorage({ isWebGPURenderer: true, backend: { isWebGPUBackend: true } }) === true, 'webgpu backend not top-down')
  assert(Impostor.usesTopDownAtlasStorage({ isWebGPURenderer: true, backend: {} }) === false, 'negative control: no backend flag is bottom-up')
  assert(Impostor.usesTopDownAtlasStorage(null) === false, 'null renderer is bottom-up')
})

gate('the scheduler score favours near, large, in-frustum, boosted requests', () => {
  near(Stream.scoreRequest({ distance: 10, screenSize: 2 }), 5, 'distance over size', 1e-12)
  near(Stream.scoreRequest({ distance: 10, screenSize: 2, inFrustum: false }), 40, 'out of frustum penalty', 1e-12)
  near(Stream.scoreRequest({ distance: 10, screenSize: 2, gameplayBoost: 0.5 }), 2.5, 'boost halves', 1e-12)
  assert(Stream.scoreRequest({ distance: NaN }) === Infinity, 'missing distance must score infinite')
  assert(Stream.scoreRequest({ distance: 10, screenSize: 2, inFrustum: false }) !== 5, 'negative control: out of frustum must not score as in frustum')
})

gate('the scheduler drains the lowest score first and breaks ties in arrival order', () => {
  const order = []
  const hub = Stream.createStreamingScheduler({ budgetMs: 1000, now: () => 0 })
  hub.enqueue({ id: 'far', features: { distance: 10, screenSize: 1 }, run: () => order.push('far') })
  hub.enqueue({ id: 'near1', features: { distance: 1, screenSize: 1 }, run: () => order.push('near1') })
  hub.enqueue({ id: 'near2', features: { distance: 1, screenSize: 1 }, run: () => order.push('near2') })
  const dispatched = hub.drain()
  same(order, ['near1', 'near2', 'far'], 'drain order')
  same(dispatched.map(e => e.id), ['near1', 'near2', 'far'], 'dispatch log order')
  assert(order[0] !== 'far', 'negative control: the farthest request must not run first')
})

gate('the scheduler caps starts per drain and cancel runs the cancel hook and removes the id', () => {
  const hub = Stream.createStreamingScheduler({ budgetMs: 1000, maxStartsPerDrain: 2, now: () => 0 })
  for (let i = 0; i < 5; i++) hub.enqueue({ id: 'k' + i, features: { distance: i }, run: () => {} })
  same(hub.drain().length, 2, 'starts per drain')
  same(hub.size(), 3, 'remaining queue')
  let cancelled = false
  hub.enqueue({ id: 'gone', run: () => {}, cancel: () => { cancelled = true } })
  assert(hub.cancel('gone') === true, 'cancel of a queued id failed')
  assert(cancelled === true, 'cancel hook did not run')
  assert(hub.has('gone') === false, 'negative control: a cancelled id must not remain queued')
  assert(hub.enqueue({ id: 'k9', features: { distance: 0 }, run: () => {} }) === true, 'enqueue refused a valid request')
  assert(hub.enqueue({ id: 'bad' }) === false, 'enqueue accepted a request without run')
})

gate('re-enqueueing an id updates its score without growing the queue', () => {
  const hub = Stream.createStreamingScheduler({ budgetMs: 1000, now: () => 0 })
  hub.enqueue({ id: 'a', features: { distance: 100 }, run: () => {} })
  hub.enqueue({ id: 'b', features: { distance: 50 }, run: () => {} })
  hub.enqueue({ id: 'a', features: { distance: 1 }, run: () => {} })
  same(hub.size(), 2, 'queue size after re-enqueue')
  same(hub.drain().map(e => e.id), ['a', 'b'], 'the re-scored id runs first')
})

gate('the dispatch log keeps at most 256 entries', () => {
  const hub = Stream.createStreamingScheduler({ budgetMs: 1000, maxStartsPerDrain: 1000, now: () => 0 })
  for (let i = 0; i < 300; i++) hub.enqueue({ id: 'd' + i, run: () => {} })
  hub.drain()
  same(hub.getDispatchLog().length, 256, 'dispatch log cap')
  same(hub.getStats().queued, 0, 'queue empty after drain')
})

gate('the culling hub sums counts, takes the max of pending frames and reports failures', () => {
  const hub = Culling.createCullingHub()
  hub.register('a', () => ({ candidates: 3, oldestPendingFrames: 7, resolved: 2 }))
  hub.register('b', () => ({ candidates: NaN, oldestPendingFrames: 9 }))
  hub.register('c', () => { throw new Error('boom') })
  hub.register('d', () => null)
  const result = hub.aggregate()
  same(result.totals.candidates, 3, 'NaN candidates ignored')
  same(result.totals.resolved, 2, 'resolved summed')
  same(result.totals.oldestPendingFrames, 9, 'max of pending frames')
  same(result.systems.c, { error: 'boom' }, 'failure reported')
  same(result.systems.d, null, 'null stats reported as null')
  hub.unregister('a')
  same(hub.aggregate().totals.candidates, 0, 'negative control: an unregistered system no longer counts')
})

gate('the draw bands keep the spoint ordering and the shared decal band', () => {
  same([Bands.WATER_TRANSPARENT_DRAW_BAND, Bands.ROCKS_OPAQUE_DRAW_BAND, Bands.GRASS_TRANSPARENT_DRAW_BAND, Bands.FOLIAGE_OPAQUE_DRAW_BAND, Bands.FOLIAGE_IMPOSTOR_DRAW_BAND, Bands.WEATHER_DRAWS_OVER_FOLIAGE_BAND], [-1, 1, 2, 3, 4, 5], 'band order')
  same([Bands.TERRAIN_OPAQUE_DRAW_BAND, Bands.DECAL_OPAQUE_DRAW_BAND, Bands.DECAL_BLEND_DRAW_BAND], [10, 10, 11], 'terrain and decal bands')
  assert(Bands.DECAL_BLEND_DRAW_BAND !== 10, 'negative control: blended decals must draw after opaque decals')
})

const validSurfaces = { surfaces: [{ id: 'move', kind: 'stick', anchor: 'left', x: 0.1, y: 0.9, size: 40, action: 'move' }, { id: 'jump', kind: 'button', anchor: 'right', x: 1, y: 0, size: 1, action: 'jump' }] }

gate('a valid touch surface spec parses in order into frozen records', () => {
  const parsed = TouchSpec.parseTouchSurfaces(validSurfaces)
  same(parsed.map(s => s.id), ['move', 'jump'], 'order kept')
  assert(Object.isFrozen(parsed[0]), 'parsed surface is not frozen')
  assert(TouchSpec.TOUCH_SURFACE_KINDS.includes('orientation'), 'orientation kind missing')
  assert(throwsReason(() => TouchSpec.parseTouchSurfaces({ surfaces: [{ ...validSurfaces.surfaces[0], kind: 'joystick' }] }), 'bad-field'), 'negative control: an unknown kind is refused')
})

gate('a touch surface spec refuses duplicate ids, bad fields and a missing array', () => {
  const dup = { surfaces: [validSurfaces.surfaces[0], validSurfaces.surfaces[0]] }
  assert(throwsReason(() => TouchSpec.parseTouchSurfaces(dup), 'duplicate-id'), 'duplicate id not refused')
  assert(throwsReason(() => TouchSpec.parseTouchSurfaces({ surfaces: [{ ...validSurfaces.surfaces[0], x: 1.5 }] }), 'bad-field'), 'x above one not refused')
  assert(throwsReason(() => TouchSpec.parseTouchSurfaces({ surfaces: [{ ...validSurfaces.surfaces[0], size: 0 }] }), 'bad-field'), 'zero size not refused')
  assert(throwsReason(() => TouchSpec.parseTouchSurfaces({ surfaces: ['x'] }), 'surface-not-object'), 'non-object surface not refused')
  assert(throwsReason(() => TouchSpec.parseTouchSurfaces({ surfaces: 'nope' }), 'no-surfaces-array'), 'non-array surfaces not refused')
  assert(TouchSpec.parseTouchSurfaces({ surfaces: [{ ...validSurfaces.surfaces[0], x: 1 }] }).length === 1, 'negative control: x exactly one is in range')
})

gate('touch draft lays buttons three to a row from the right and splits the sticks', () => {
  const bindings = { move: { key: 'w' }, look: {}, jump: { key: 'space', label: 'JMP' }, fire: { key: 'f', touch: 'drag' }, crouch: { key: 'c' }, reload: { key: 'r' }, zoom: { touch: 'none', key: 'z' } }
  const layout = { h: 900, buttonsRightOffset: 30, buttonsBottomOffset: 40 }
  const responsive = { buttonSize: 56, spacing: 8, joystickRadius: 70 }
  const draft = TouchDraft.touchDraftFromBindings(bindings, layout, responsive)
  same(draft.sticks, [{ action: 'move', side: 'left' }, { action: 'look', side: 'right' }], 'sticks')
  same(draft.buttons.map(b => b.action), ['jump', 'fire', 'crouch', 'reload'], 'buttons without zoom')
  const cell = 64
  near(draft.buttons[0].x, 30 + 2 * cell, 'first button in the right column', 1e-9)
  near(draft.buttons[2].x, 30, 'third button in the left column', 1e-9)
  near(draft.buttons[3].y, draft.buttons[0].y + cell, 'fourth button on the next row', 1e-9)
  same(draft.buttons[0].label, 'JMP', 'custom label')
  same(draft.buttons[1].label, 'FIRE', 'default label')
  same(draft.radius, 70, 'joystick radius')
  assert(!draft.buttons.some(b => b.action === 'zoom'), 'negative control: a none binding must not be drawn')
})

gate('touch draft refuses a stick on a non-stick action and an unknown touch mode', () => {
  const layout = { h: 900, buttonsRightOffset: 0, buttonsBottomOffset: 0 }
  const responsive = { buttonSize: 56, spacing: 8, joystickRadius: 70 }
  assert(throwsMatching(() => TouchDraft.touchDraftFromBindings({ jump: { touch: 'stick' } }, layout, responsive), /cannot be a stick/), 'stick on jump not refused')
  assert(throwsMatching(() => TouchDraft.touchDraftFromBindings({ jump: { touch: 'swipe' } }, layout, responsive), /unknown touch mode/), 'unknown mode not refused')
  assert(throwsMatching(() => TouchDraft.touchDraftFromBindings(null, layout, responsive), /bindings must be an object/), 'null bindings not refused')
  assert(throwsMatching(() => TouchDraft.touchDraftFromBindings({}, layout, null), /required/), 'missing responsive sizes not refused')
  same(TouchDraft.touchDraftFromBindings({ jump: { key: 'x' } }, layout, responsive).buttons.length, 1, 'negative control: a valid binding is drawn')
})

gate('the replay buffer keeps the newest frames and scrubs from the oldest kept', () => {
  const buffer = Replay.createReplayBuffer({ maxFrames: 4, captureFn: t => ({ t }), idleCaptureEveryNFrames: 1 })
  for (let i = 0; i < 10; i++) buffer.record(i)
  same(buffer.getFrameCount(), 4, 'frame count capped')
  same(buffer.getTotalRecorded(), 10, 'total recorded counts all')
  same(buffer.scrub(0), { t: 6 }, 'oldest kept frame')
  same(buffer.scrub(3), { t: 9 }, 'newest frame')
  assert(throwsMatching(() => buffer.scrub(4), /out of range/), 'scrub past the end not refused')
  buffer.clear()
  assert(throwsMatching(() => buffer.scrub(0), /no frames recorded/), 'scrub after clear not refused')
})

gate('the replay buffer captures on an idle cadence and every frame while subscribed', () => {
  const idle = Replay.createReplayBuffer({ maxFrames: 10, captureFn: t => ({ t }), idleCaptureEveryNFrames: 3 })
  const idleCaptures = [1, 2, 3, 4, 5, 6].map(i => idle.record(i)).filter(Boolean).length
  same(idleCaptures, 2, 'idle cadence of three')
  const live = Replay.createReplayBuffer({ maxFrames: 10, captureFn: t => ({ t }), idleCaptureEveryNFrames: 3 })
  const unsubscribe = live.subscribe()
  same(live.getConsumerCount(), 1, 'one subscriber')
  const liveCaptures = [1, 2, 3].map(i => live.record(i)).filter(Boolean).length
  same(liveCaptures, 3, 'subscribed buffer captures every frame')
  unsubscribe()
  assert(live.getConsumerCount() === 0, 'negative control: unsubscribe must remove the consumer')
})

gate('the scene graph capture reads group transforms and skips nodes without a group', () => {
  const sceneGraph = { nodes: () => [['a', { group: { position: { x: 1, y: 2, z: 3 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } } }], ['b', {}]] }
  const capture = Replay.createSceneGraphCaptureFn(sceneGraph, () => 42)
  const frame = capture(undefined)
  same(frame.t, 42, 'clock default used')
  same(frame.transforms, { a: { x: 1, y: 2, z: 3, qx: 0, qy: 0, qz: 0, qw: 1 } }, 'transforms')
  assert(!('b' in frame.transforms), 'negative control: a node without a group must not be captured')
  same(capture(7).t, 7, 'explicit time kept')
})

gate('the ground grid interpolates a plane exactly and resamples after invalidate', () => {
  let calls = 0
  const grid = Grid.createGroundNodeGrid((x, z) => { calls++; return x * 0.5 + z * 1.25 })
  near(grid.heightAt(2.25, 3.5), 5.5, 'bilinear plane', 1e-9)
  const before = calls
  grid.heightAt(2.25, 3.5)
  same(calls, before, 'cached nodes are not resampled')
  grid.invalidate()
  grid.heightAt(2.25, 3.5)
  assert(calls > before, 'negative control: invalidate must force resampling')
})

gate('the ground grid keeps slots apart across a window wrap and falls back where a node is not finite', () => {
  const grid = Grid.createGroundNodeGrid(x => x)
  near(grid.heightAt(0.5, 0), 0.5, 'near origin', 1e-9)
  near(grid.heightAt(64.5, 0), 64.5, 'node 64 shares a slot with node 0', 1e-9)
  const gapped = Grid.createGroundNodeGrid((x, z) => (x === 5 && z === 5 ? NaN : 2))
  near(gapped.heightAt(5.5, 5.5), 2, 'a NaN corner falls back to the exact sample of the point', 1e-9)
  assert(Number.isNaN(Grid.createGroundNodeGrid(() => NaN).heightAt(1, 1)), 'negative control: a NaN ground stays NaN')
  near(grid.spacingM, 1, 'node spacing', 1e-12)
  near(grid.windowM, 64, 'window size', 1e-12)
})

gate('warm passes count successes and failures and keep the first error', () => {
  const failing = Ready.runWarmPasses(() => { throw new Error('boom') }, 3)
  same([failing.attempted, failing.succeeded, failing.failed], [3, 0, 3], 'all failing')
  assert(failing.error instanceof Error && failing.error.message === 'boom', 'first error not kept')
  const mixed = Ready.runWarmPasses(() => {}, 2)
  same([mixed.attempted, mixed.succeeded, mixed.failed, mixed.error], [2, 2, 0, null], 'all passing')
  same(Ready.runWarmPasses(() => {}, -1).attempted, 0, 'negative passes run nothing')
  assert(Ready.runWarmPasses(() => {}, 0).error === null, 'negative control: a clean pass list reports no error')
})

gate('pending program counts read the pipeline cache or the program list', () => {
  const programs = { info: { programs: [{ isReady: () => false }, { isReady: () => true }, {}] } }
  same(Ready.pendingProgramCount(programs), 1, 'pending from the program list')
  const pipelines = new Map([['p1', 'x'], ['p2', 'y'], ['p3', 'z']])
  const data = { x: { pipeline: {} }, y: { pipeline: undefined }, z: { pipeline: undefined, error: true } }
  const cached = { _pipelines: { caches: pipelines, backend: { get: k => data[k] } }, info: { programs: [{ isReady: () => false }, { isReady: () => false }] } }
  same(Ready.pendingProgramCount(cached), 1, 'pending from the pipeline cache')
  same(Ready.pendingProgramCount(cached, { vacuous: true }), 2, 'vacuous mode reads the program list only')
  same(Ready.pendingProgramCount({ info: { programs: [] } }), 0, 'empty program list')
  assert(Ready.pendingProgramCount({ info: { programs: [{ isReady: () => true }] } }) === 0, 'negative control: a ready program is not pending')
})

gate('the readiness wait resolves at zero or at the wait cap and records what it saw', () => {
  let t = 0
  const scheduled = []
  let pending = 2
  const renderer = { info: { programs: [{ isReady: () => pending === 0 }, { isReady: () => pending === 0 }] } }
  const warnings = []
  const readiness = Ready.createProgramReadiness({ now: () => t, schedule: (fn) => scheduled.push(fn), warn: m => warnings.push(m) })
  readiness.whenProgramsReady(renderer, 100)
  same(readiness.lastWait().calls, 0, 'nothing recorded before the wait resolves')
  t = 16
  pending = 0
  scheduled.shift()()
  same(readiness.lastWait().pendingAtStart, 2, 'pending at start')
  same(readiness.lastWait().resolvedPending, 0, 'resolved at zero pending')
  same(readiness.lastWait().waitedMs, 16, 'waited for one poll')
  let cappedClock = 500
  const cappedQueue = []
  const capped = Ready.createProgramReadiness({ now: () => cappedClock, schedule: fn => cappedQueue.push(fn), warn: m => warnings.push(m) })
  capped.whenProgramsReady({ info: { programs: [{ isReady: () => false }] } }, 100)
  same(cappedQueue.length, 1, 'a pending program schedules another poll')
  cappedClock = 700
  cappedQueue.shift()()
  same(capped.lastWait().resolvedPending, 1, 'wait cap reports the pending count')
  same(warnings.length, 1, 'wait cap warns once')
  assert(capped.lastWait().vacuous === false, 'negative control: vacuous is off by default')
})

gate('the placement gate enforces the 40 ms minimum gap and clamps the delta to one millisecond through one second', () => {
  const gateState = Placement.createPlacementTickGate()
  assert(gateState.shouldTick(0) === true, 'first tick refused')
  assert(gateState.shouldTick(20) === false, 'tick inside the gap accepted')
  assert(gateState.shouldTick(39) === false, 'negative control: 39 ms is still inside the gap')
  assert(gateState.shouldTick(40) === true, 'tick at the gap refused')
  const delta = Placement.createPlacementTickGate()
  near(delta.takeDeltaSeconds(1000), 0, 'first delta is zero', 1e-12)
  near(delta.takeDeltaSeconds(1010), 0.01, 'ten millisecond delta', 1e-12)
  near(delta.takeDeltaSeconds(1010.1), 0.001, 'tiny delta floors at one millisecond', 1e-12)
  near(delta.takeDeltaSeconds(10000), 1, 'huge delta caps at one second', 1e-12)
  same([Placement.PLACEMENT_INTERVAL_MS, Placement.MIN_TICK_GAP_MS], [250, 40], 'placement constants')
})

gate('the edit history batches a burst into one entry and opens a new one after the window', () => {
  let t = 0
  const toasts = []
  const history = Edit.createEditHistory({ onToast: m => toasts.push(m), now: () => t, wallClock: () => 1 })
  const record = (id, k) => ({ entityId: id, k, undoOp: () => {}, redoOp: () => {} })
  t = 0
  history.push(record('a', 1))
  t = 30
  history.push(record('a', 2))
  same(history.undoDepth, 1, 'burst inside the window is one entry')
  t = 200
  history.push(record('b', 3))
  same(history.undoDepth, 2, 'later push opens a new entry')
  same(history.list()[0].count, 1, 'newest entry has one record')
  assert(history.push({ undoOp: () => {} }) === false && toasts.length === 1, 'negative control: a half-transport record is refused with a toast')
})

gate('undo reverses in reverse order, redo reapplies, and a new push clears redo', () => {
  let t = 0
  const log = []
  const history = Edit.createEditHistory({ now: () => t })
  t = 0
  history.push({ entityId: 'a', k: 1, undoOp: () => log.push('u1'), redoOp: () => log.push('r1') })
  t = 30
  history.push({ entityId: 'a', k: 2, undoOp: () => log.push('u2'), redoOp: () => log.push('r2') })
  assert(history.undo() === true, 'undo refused')
  same(log, ['u2', 'u1'], 'undo order inside the batch')
  assert(history.redo() === true, 'redo refused')
  same(log.slice(2), ['r1', 'r2'], 'redo order')
  history.undo()
  t = 500
  history.push({ entityId: 'b', k: 3, undoOp: () => {}, redoOp: () => {} })
  assert(history.redo() === false, 'negative control: a new push must clear redo')
  assert(history.redoDepth === 0 && history.undoDepth === 1, 'depths after a new push')
})

gate('the edit history caps at twenty entries and jumps across history', () => {
  let t = 0
  const history = Edit.createEditHistory({ now: () => t })
  for (let i = 0; i < 25; i++) {
    t += 100
    history.push({ entityId: 'e', k: i, undoOp: () => {}, redoOp: () => {} })
  }
  same(history.undoDepth, 20, 'undo depth capped')
  const oldest = history.list().at(-1).txnId
  assert(history.jumpTo(oldest) === true, 'jump to the oldest kept entry refused')
  same(history.undoDepth, 1, 'jump undid to the oldest entry')
  assert(history.jumpTo(999999) === false, 'negative control: an unknown transaction id must not jump')
})

gate('the layer registry applies layer visibility and lock to members and never deletes the default layer', () => {
  const calls = []
  const registry = Layers.createLayerRegistry({ setHidden: (id, v) => calls.push(['h', id, v]), setLocked: (id, v) => calls.push(['l', id, v]), sendLayerUpdate: (id, l) => calls.push(['s', id, l]) })
  registry.assign('a', 'Walls')
  registry.setLayerVisible('Walls', false)
  registry.setLayerLocked('Walls', true)
  assert(calls.some(c => c[0] === 'h' && c[1] === 'a' && c[2] === true), 'hidden layer did not hide its member')
  assert(calls.some(c => c[0] === 'l' && c[1] === 'a' && c[2] === true), 'locked layer did not lock its member')
  same(registry.layerOf('a'), 'Walls', 'member layer')
  same(registry.layerOf('zzz'), 'Default', 'unknown entity is in Default')
  same(registry.deleteLayer('Default'), false, 'default layer refused')
  assert(registry.deleteLayer('Walls') === true && registry.layerOf('a') === 'Default', 'deleting a layer did not move members to Default')
  assert(registry.renameLayer('Default', 'X') === false, 'negative control: default layer must not be renamed')
})

gate('the layer registry renames layers, hydrates from entities and refuses a bad name', () => {
  const registry = Layers.createLayerRegistry()
  registry.assign('p', 'Props')
  assert(registry.renameLayer('Props', 'Decor') === true, 'rename refused')
  same(registry.layerOf('p'), 'Decor', 'member follows rename')
  assert(registry.renameLayer('Decor', 'Decor') === false, 'rename onto itself allowed')
  registry.hydrateFromEntities([{ id: 'q', custom: { _layer: 'Lights' } }, { id: 'r', custom: { _layer: 3 } }])
  same(registry.layerOf('q'), 'Lights', 'hydrated membership')
  same(registry.layerOf('r'), 'Default', 'non-string layer ignored')
  assert(throwsMatching(() => registry.ensureLayer(''), /name required/), 'empty layer name not refused')
  same(registry.getLayerState('nope'), null, 'negative control: unknown layer has no state')
})

gate('hud stats publish, replace, clear and read, and ignore an empty or non-string key', () => {
  Hud.publishHudStat('fps', 60)
  Hud.publishHudStat('ping', 20)
  Hud.publishHudStat('ping', null)
  Hud.publishHudStat('', 1)
  Hud.publishHudStat(7, 1)
  let snapshot = Hud.readHudStats()
  same(snapshot.fps, 60, 'fps published')
  assert(!('ping' in snapshot), 'null value did not delete')
  assert(!('' in snapshot) && !('7' in snapshot), 'negative control: an invalid key was stored')
  Hud.clearHudStat('fps')
  assert(!('fps' in Hud.readHudStats()), 'clear did not remove')
})

gate('the pure source has no comments, only relative imports, and no browser or GPU globals', () => {
  const files = readdirSync(pureDir).filter(name => name.endsWith('.js'))
  const texts = files.map(name => ({ name, text: readFileSync(join(pureDir, name), 'utf8') }))
  const commented = texts.filter(f => /\/\/|\/\*/.test(f.text)).map(f => f.name)
  assert(commented.length === 0, 'comment token in ' + commented.join(', '))
  const bare = texts.filter(f => /from\s+['"](?!\.\.?\/)[^'"]+['"]/.test(f.text)).map(f => f.name)
  assert(bare.length === 0, 'non-relative import in ' + bare.join(', '))
  const stripStrings = text => text.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""')
  const globals = /\b(window|document|navigator|requestAnimationFrame|localStorage|fetch|Worker|WebGPU|WebGL|three)\b/
  const browser = texts.filter(f => globals.test(stripStrings(f.text))).map(f => f.name)
  assert(browser.length === 0, 'browser or GPU reference in ' + browser.join(', '))
  assert(globals.test(stripStrings('const x = window.foo')) && !globals.test(stripStrings("const s = 'window'")), 'negative control: the scan must flag code and ignore string data')
})

gate('every module in src/client-pure is covered by this gate or by the gate named for it', () => {
  const covered = new Set(['qualityGovernor', 'qualityTierChoice', 'qualityPresets', 'postFxSelection', 'frameMetrics', 'budgetControllers', 'cascadeShadow', 'shadowCostStats', 'lodBandPolicy', 'impostorTier', 'streamingScheduler', 'cullingHub', 'drawBands', 'touchSurfaceSpec', 'touchDraft', 'replayBuffer', 'groundNodeGrid', 'programReadiness', 'placementTickGate', 'editHistory', 'layerRegistry', 'hudStats'])
  const coveredElsewhere = {
    cacheRevalidationSweep: 'check-client-pure-rows.mjs',
    frameCapture: 'check-client-pure-spoint.mjs',
    macrotaskYield: 'check-client-pure-spoint.mjs',
    minimapGlyphs: 'check-client-pure-spoint.mjs',
    clientMachine: 'check-client-machines.mjs',
    exactPatchFrame: 'check-client-pure-rows.mjs',
    inputActionCompile: 'check-client-machines.mjs',
    inputStepper: 'check-client-machines.mjs',
    keyBindings: 'check-client-pure-rows.mjs',
    keybindingDefaults: 'check-client-pure-rows.mjs',
    loadingMachine: 'check-client-machines.mjs',
    stateValue: 'check-client-machines.mjs',
    tileExtent: 'check-client-pure-rows.mjs',
    transformLerp: 'check-client-pure-rows.mjs',
  }
  const present = readdirSync(pureDir).filter(name => name.endsWith('.js')).map(name => name.slice(0, -3))
  const missing = present.filter(name => !covered.has(name) && !(name in coveredElsewhere))
  const absent = [...covered].filter(name => !present.includes(name))
  const unlinked = Object.entries(coveredElsewhere).filter(([name, gateFile]) => !readFileSync(join(here, gateFile), 'utf8').includes(name)).map(([name]) => name)
  assert(missing.length === 0 && absent.length === 0 && unlinked.length === 0, `uncovered ${missing.join(',')} absent ${absent.join(',')} unlinked ${unlinked.join(',')}`)
  const total = covered.size + Object.keys(coveredElsewhere).length
  assert(total === present.length && present.length === 36, 'negative control: the module count must be exactly the 36 ported files')
})

finish()
