import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as telemetry from '../src/telemetry-pure/index.js'

const sourceDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'telemetry-pure')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, `${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
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

const TICK_LITERAL = [0.5, 1, 2, 5, 10, 16.7, 25, 50, 100, 250, 500]
const SNAP_LITERAL = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]

const checkBuckets = (ticks, snaps) => {
  sameJson(ticks, TICK_LITERAL, 'TICK_MS_BUCKETS')
  sameJson(snaps, SNAP_LITERAL, 'SNAP_BYTES_BUCKETS')
}

gate('bucket boundaries match spoint Metrics.js', () => {
  checkBuckets(telemetry.TICK_MS_BUCKETS, telemetry.SNAP_BYTES_BUCKETS)
  mustReject(() => checkBuckets(telemetry.TICK_MS_BUCKETS.slice(1), telemetry.SNAP_BYTES_BUCKETS))
})

const checkEscaping = (formatLabels) => {
  same(formatLabels({ a: 'x"y\\z\nq' }), '{a="x\\"y\\\\z\\nq"}', 'escaped labels')
}
const naiveFormatLabels = (labels) => `{${Object.keys(labels).map((key) => `${key}="${labels[key]}"`).join(',')}}`

gate('label values escape backslash, double quote and newline', () => {
  checkEscaping(telemetry.formatLabels)
  mustReject(() => checkEscaping(naiveFormatLabels))
  same(telemetry.formatLabels({}), '', 'empty labels')
  same(telemetry.formatLabels(undefined), '', 'undefined labels')
})

const checkHistogram = (createHistogramFn, boundaries = [1, 2, 5]) => {
  const hist = createHistogramFn('h', 'help', boundaries)
  for (const value of [0.5, 1, 1.5, 3, 10]) hist.observe(value)
  same(hist.render(), '# HELP h help\n# TYPE h histogram\nh_bucket{le="1"} 2\nh_bucket{le="2"} 3\nh_bucket{le="5"} 4\nh_bucket{le="+Inf"} 5\nh_sum 16\nh_count 5', 'histogram render')
}

gate('histogram counts with inclusive upper bounds, cumulative buckets, +Inf, sum and count', () => {
  checkHistogram(telemetry.createHistogram)
  mustReject(() => checkHistogram(telemetry.createHistogram, [1, 2, 6]))
})

gate('histogram reset clears buckets, sum and count, and labels reach every line', () => {
  const hist = telemetry.createHistogram('h', 'help', [1])
  hist.observe(0.5)
  hist.observe(3)
  const populated = hist.renderBody()
  hist.reset()
  const empty = 'h_bucket{le="1"} 0\nh_bucket{le="+Inf"} 0\nh_sum 0\nh_count 0'
  same(hist.renderBody(), empty, 'after reset')
  mustReject(() => same(populated, empty, 'populated before reset'))
  hist.observe(0.5)
  same(hist.renderBody({ phase: 'total' }), 'h_bucket{phase="total",le="1"} 1\nh_bucket{phase="total",le="+Inf"} 1\nh_sum{phase="total"} 0.5\nh_count{phase="total"} 1', 'labelled body')
})

const checkCounter = (createCounterFn) => {
  const counter = createCounterFn('c_total', 'Help text')
  counter.inc()
  counter.inc(4)
  same(counter.value, 5, 'counter value')
  same(counter.render(), '# HELP c_total Help text\n# TYPE c_total counter\nc_total 5', 'bare render')
  same(counter.render({ a: 'b' }), '# HELP c_total Help text\n# TYPE c_total counter\nc_total{a="b"} 5', 'labelled render')
}
const counterIgnoringAmount = (name, help) => {
  const real = telemetry.createCounter(name, help)
  return { name, help, type: 'counter', inc: () => real.inc(1), get value() { return real.value }, render: (labels) => real.render(labels) }
}

gate('counter increments by its amount and renders with and without labels', () => {
  checkCounter(telemetry.createCounter)
  mustReject(() => checkCounter(counterIgnoringAmount))
})

const checkGc = (createGc) => {
  const gc = createGc({ 4: 'major' })
  gc.observe([{ duration: 2.5, kind: 4 }, { duration: 0.5, kind: 4 }, { duration: 7, kind: 99 }])
  const lines = gc.render().split('\n')
  const cumulative = [1, 1, 1, 2, 3, 3, 3, 3, 3, 3, 3]
  telemetry.TICK_MS_BUCKETS.forEach((bound, i) => assert(lines.includes(`spoint_gc_pause_ms_bucket{le="${bound}"} ${cumulative[i]}`), `pause bucket ${bound}`))
  assert(lines.includes('spoint_gc_pause_ms_bucket{le="+Inf"} 3'), 'pause +Inf')
  assert(lines.includes('spoint_gc_pause_ms_sum 10'), 'pause sum')
  assert(lines.includes('spoint_gc_pause_ms_count 3'), 'pause count')
  sameJson(lines.slice(-2), ['spoint_gc_events_total{kind="major"} 2', 'spoint_gc_events_total{kind="unknown_99"} 1'], 'kind counts')
}

gate('GC aggregation buckets durations, counts kinds and names unknown kinds', () => {
  checkGc(telemetry.createGcAggregator)
  mustReject(() => checkGc(() => telemetry.createGcAggregator({ 4: 'minor' })))
  sameJson(telemetry.createGcAggregator().render().split('\n').slice(-1), ['spoint_gc_events_total{kind="none"} 0'], 'empty kinds')
})

const fullAverage = { avgTotalMs: 6, avgMvMs: 2, avgPhysMs: 2, avgSnapMs: 2, sampleCount: 2 }
const emptyAverage = { avgTotalMs: 0, avgMvMs: 0, avgPhysMs: 0, avgSnapMs: 0, sampleCount: 0 }
const tickSamples = [{ total: 4, mv: 1, phys: 2, snap: 1 }, { total: 8, mv: 3, phys: 2, snap: 3 }]

gate('tick window averages each phase over its samples, is zero when empty and resets', () => {
  const window = telemetry.createTickWindow()
  sameJson(window.average(), emptyAverage, 'empty window')
  tickSamples.forEach((sample) => window.add(sample))
  sameJson(window.average(), fullAverage, 'two samples')
  window.reset()
  sameJson(window.average(), emptyAverage, 'after reset')
  const lastOnly = telemetry.createTickWindow()
  lastOnly.add(tickSamples[1])
  mustReject(() => sameJson(lastOnly.average(), fullAverage, 'last sample only'))
})

const checkSnapshotLines = (registry) => {
  const lines = registry.render({}).split('\n')
  const expected = [
    'spoint_snapshot_bytes_bucket{le="64"} 0',
    'spoint_snapshot_bytes_bucket{le="128"} 1',
    'spoint_snapshot_bytes_bucket{le="16384"} 1',
    'spoint_snapshot_bytes_bucket{le="+Inf"} 2',
    'spoint_snapshot_bytes_sum 20100',
    'spoint_snapshot_bytes_count 2',
    'spoint_snapshot_bytes_total 20100',
  ]
  for (const line of expected) assert(lines.includes(line), `missing ${line}`)
}

gate('snapshot bytes feed a histogram and a cumulative counter', () => {
  const registry = telemetry.createTelemetryRegistry()
  registry.recordSnapshotBytes(100)
  registry.recordSnapshotBytes(20000)
  checkSnapshotLines(registry)
  const wrong = telemetry.createTelemetryRegistry()
  wrong.recordSnapshotBytes(100)
  wrong.recordSnapshotBytes(2000)
  mustReject(() => checkSnapshotLines(wrong))
})

const checkTickPhaseLines = (registry) => {
  const lines = registry.render({}).split('\n')
  const expected = [
    '# HELP spoint_tick_phase_ms Per-tick phase duration in milliseconds, full distribution by phase label',
    '# TYPE spoint_tick_phase_ms histogram',
    'spoint_tick_phase_ms_bucket{phase="total",le="5"} 1',
    'spoint_tick_phase_ms_count{phase="total"} 1',
    'spoint_tick_phase_ms_bucket{phase="constructor",le="0.5"} 0',
    'spoint_tick_phase_ms_bucket{phase="constructor",le="1"} 1',
  ]
  for (const line of expected) assert(lines.includes(line), `missing ${line}`)
}

gate('tick phases keep one histogram per phase, including prototype-named phases', () => {
  const registry = telemetry.createTelemetryRegistry()
  registry.recordTickPhase('total', 3)
  registry.recordTickPhase('constructor', 1)
  checkTickPhaseLines(registry)
  const wrong = telemetry.createTelemetryRegistry()
  wrong.recordTickPhase('total', 7)
  wrong.recordTickPhase('constructor', 1)
  mustReject(() => checkTickPhaseLines(wrong))
  assert(!telemetry.createTelemetryRegistry().render({}).includes('# HELP spoint_tick_phase_ms '), 'empty registry wrote a phase section')
})

gate('each registry keeps its own state', () => {
  const first = telemetry.createTelemetryRegistry()
  const second = telemetry.createTelemetryRegistry()
  first.recordSnapshotBytes(100)
  assert(second.render({}).split('\n').includes('spoint_snapshot_bytes_total 0'), 'second registry saw the first registry')
  mustReject(() => same(second.render({}), first.render({}), 'two registries'))
})

gate('GC kind names are supplied by the host through the registry', () => {
  const named = telemetry.createTelemetryRegistry({ gcKindNames: { 4: 'major' } })
  named.gc.observe([{ duration: 0.5, kind: 4 }])
  assert(named.render({}).includes('spoint_gc_events_total{kind="major"} 1'), 'named kind missing')
  const bare = telemetry.createTelemetryRegistry()
  bare.gc.observe([{ duration: 0.5, kind: 4 }])
  mustReject(() => assert(bare.render({}).includes('kind="major"'), 'unnamed kind resolved to major'))
})

const gaugeSources = () => ({
  tick: 0,
  tickRate: 60,
  players: 2,
  entities: 5,
  sessionCount: 1,
  uptimeSec: 12.5,
  memoryUsage: () => ({ heapUsed: 100, heapTotal: 200, rss: 300, external: 4 }),
  tickTiming: { avgTotalMs: 1.23456, avgMvMs: 0.5, avgPhysMs: 0.25, avgSnapMs: 0.1, sampleCount: 7 },
  rooms: [{ roomId: 'a"b', worldName: 'w', tick: 9, players: 1, entities: 2, uptimeMs: 1500 }],
})

const checkGauges = (render) => {
  const text = render(gaugeSources())
  const lines = text.split('\n')
  const expected = [
    'spoint_tick 0',
    'spoint_tick_rate_hz 60',
    'spoint_players 2',
    'spoint_entities 5',
    'spoint_sessions 1',
    'spoint_uptime_seconds 12.5',
    'spoint_process_heap_used_bytes 100',
    'spoint_process_arraybuffers_bytes 0',
    'spoint_tick_phase_avg_ms{phase="total"} 1.2346',
    'spoint_tick_phase_avg_ms{phase="mv"} 0.5000',
    'spoint_tick_phase_sample_count 7',
    'spoint_room_tick{room_id="a\\"b",world="w"} 9',
    'spoint_room_uptime_seconds{room_id="a\\"b",world="w"} 1.500',
  ]
  for (const line of expected) assert(lines.includes(line), `missing ${line}`)
  assert(text.endsWith('\n'), 'output does not end with a newline')
}

gate('renderMetrics writes spoint gauges, tick timing and escaped room labels', () => {
  const registry = telemetry.createTelemetryRegistry()
  checkGauges((sources) => registry.render(sources))
  mustReject(() => checkGauges((sources) => registry.render(sources.tick ? sources : { ...sources, tick: undefined })))
})

gate('a null tick is omitted and a missing memory counter reads as zero', () => {
  const registry = telemetry.createTelemetryRegistry()
  const lines = registry.render({ tick: null, players: 1 }).split('\n')
  assert(!lines.some((line) => line.startsWith('spoint_tick ')), 'null tick was written')
  assert(lines.includes('spoint_players 1'), 'players missing')
  const memory = registry.render({ memoryUsage: () => ({ heapUsed: 1, heapTotal: 1, rss: 1, external: 1 }) }).split('\n')
  assert(memory.includes('spoint_process_arraybuffers_bytes 0'), 'arrayBuffers default missing')
  mustReject(() => assert(!registry.render({ tick: 0 }).split('\n').some((line) => line.startsWith('spoint_tick ')), 'tick 0 written'))
})

const stripStrings = (text) => text.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""')

const findingsIn = (text) => {
  const found = []
  if (/\/\/|\/\*/.test(text)) found.push('comment marker')
  for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*)(['"])([^'"]+)\1/g)) {
    if (!match[2].startsWith('.')) found.push(`bare import ${match[2]}`)
  }
  const code = stripStrings(text)
  for (const token of ['process', 'performance', 'Date', 'require', 'window', 'document', 'globalThis', 'setTimeout', 'setInterval']) {
    if (new RegExp(`\\b${token}\\b`).test(code)) found.push(`code uses ${token}`)
  }
  return found
}

const expectedFiles = ['gc.js', 'gcObserver.js', 'histogram.js', 'index.js', 'metricsRoute.js', 'registry.js', 'render.js', 'tickProfile.js', 'tickWindow.js']

gate('telemetry-pure has the expected files and each carries no comments and imports no host module', () => {
  sameJson(readdirSync(sourceDir).filter((name) => name.endsWith('.js')).sort(), expectedFiles, 'source files')
  for (const name of expectedFiles) {
    const found = findingsIn(readFileSync(join(sourceDir, name), 'utf8'))
    assert(found.length === 0, `${name}: ${found.join(', ')}`)
  }
  const sample = "import fs from 'node:fs'\n// note\nconst t = process.uptime()\n"
  mustReject(() => assert(findingsIn(sample).length === 0, 'sample with fs, comment and process'))
})

gate('index exports the public surface and no module-level recorder', () => {
  for (const name of ['createHistogram', 'createCounter', 'escapeLabelValue', 'formatLabels', 'createGcAggregator', 'createTickWindow', 'renderMetrics', 'createTelemetryRegistry']) {
    same(typeof telemetry[name], 'function', name)
  }
  sameJson([telemetry.TICK_MS_BUCKETS.length, telemetry.SNAP_BYTES_BUCKETS.length], [11, 11], 'bucket counts')
  same(typeof telemetry.recordTickPhase, 'undefined', 'module-level recordTickPhase')
  mustReject(() => same(typeof telemetry.createTelemetryRegistry().recordTickPhase, 'undefined', 'registry recordTickPhase'))
})

gate('metrics route answers only loopback peers and reads the snapshot only for them', () => {
  let reads = 0
  const snapshot = () => {
    reads++
    return { tick: 1 }
  }
  const registry = telemetry.createTelemetryRegistry()
  const denied = telemetry.metricsResponse({ remoteAddress: '10.0.0.5', registry, snapshot })
  same(denied.status, 403, 'denied status')
  same(denied.body, 'forbidden', 'denied body')
  same(reads, 0, 'snapshot reads for a denied peer')
  for (const remoteAddress of ['127.0.0.2', '::ffff:127.0.0.2', 'localhost', '', undefined, null]) {
    same(telemetry.metricsResponse({ remoteAddress, registry, snapshot }).status, 403, 'denied ' + String(remoteAddress))
  }
  same(reads, 0, 'snapshot reads for denied peers')
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const response = telemetry.metricsResponse({ remoteAddress, registry, snapshot })
    same(response.status, 200, 'loopback status')
    same(response.headers['Content-Type'], telemetry.METRICS_CONTENT_TYPE, 'content type')
    same(response.body, registry.render({ tick: 1 }), 'loopback body')
  }
  same(reads, 3, 'snapshot reads for loopback peers')
  same(telemetry.METRICS_CONTENT_TYPE, 'text/plain; version=0.0.4; charset=utf-8', 'content type literal')
  mustReject(() => same(telemetry.metricsResponse({ remoteAddress: '127.0.0.2', registry, snapshot }).status, 200, 'prefix match'))
})

gate('average text is zero with no samples and two decimals otherwise', () => {
  same(telemetry.averageText(0, 0), '0', 'empty average')
  same(telemetry.averageText(10, 4), '2.50', 'average')
  mustReject(() => same(telemetry.averageText(10, 4), '2.5', 'average'))
})

gate('profile log cadence counts only enabled ticks and logs every interval-th one', () => {
  const logGate = telemetry.createProfileLogGate(3)
  const sequence = [false, true, true, true, false, true, true, true].map((enabled) => logGate(enabled))
  sameJson(sequence, [false, false, false, true, false, false, false, true], 'cadence')
  mustReject(() => sameJson(sequence, [false, false, false, true, false, false, true, false], 'cadence'))
})

const profileInput = {
  tick: 42,
  players: 2,
  idle: 1,
  physSkip: 2,
  entities: 9,
  dynIds: 3,
  activeDyn: 2,
  phases: { total: 4.5, mv: 1, col: 0.5, phys: 2, app: 1, sync: 0, respawn: 0, spatial: 0, col2: 0, int: 0, snap: 0.25 },
  sums: { total: 10, mv: 2, phys: 4, snap: 1 },
  count: 4,
  memory: { heapUsed: 3 * 1048576, rss: 10.5 * 1048576, external: 0, arrayBuffers: 2 * 1048576 },
}
const profileLine = '[tick-profile] tick:42 players:2 idle:1 physSkip:2 entities:9 dynIds:3 activeDyn:2 total:4.50ms(avg:2.50) | mv:1.00(avg:0.50) col:0.50 phys:2.00(avg:1.00) app:1.00 sync:0.00 respawn:0.00 spatial:0.00 col2:0.00 int:0.00 snap:0.25(avg:0.25) | heap:3.0MB rss:10.5MB ext:0.0MB ab:2.0MB'

gate('tick profile line keeps the spoint layout, averages and megabyte fields', () => {
  same(telemetry.formatTickProfileLine(profileInput), profileLine, 'profile line')
  mustReject(() => same(telemetry.formatTickProfileLine({ ...profileInput, count: 0 }), profileLine, 'profile line'))
})

class FakePerformanceObserver {
  constructor(callback) {
    this.callback = callback
    this.options = null
    this.disconnected = false
    FakePerformanceObserver.last = this
  }
  observe(options) {
    this.options = options
  }
  disconnect() {
    this.disconnected = true
  }
}

gate('the GC observer subscribes to gc entries and feeds the aggregator until it is disconnected', () => {
  const gc = telemetry.createGcAggregator({ 4: 'major' })
  const installed = telemetry.installGcObserver({ PerformanceObserver: FakePerformanceObserver, aggregator: gc })
  same(installed.installed, true, 'installed')
  sameJson(FakePerformanceObserver.last.options, { entryTypes: ['gc'], buffered: false }, 'observe options')
  FakePerformanceObserver.last.callback({ getEntries: () => [{ duration: 2.5, kind: 4 }] })
  assert(gc.render().includes('spoint_gc_events_total{kind="major"} 1'), 'entry not counted')
  installed.disconnect()
  same(FakePerformanceObserver.last.disconnected, true, 'disconnected')
  mustReject(() => sameJson(FakePerformanceObserver.last.options, { entryTypes: ['gc'], buffered: true }, 'options'))
})

gate('the GC observer reports why it is absent and never throws', () => {
  const gc = telemetry.createGcAggregator()
  const absent = telemetry.installGcObserver({ PerformanceObserver: undefined, aggregator: gc })
  same(absent.installed, false, 'absent installed')
  same(absent.reason, 'performance-observer-unavailable', 'absent reason')
  class Refusing {
    observe() {
      throw new Error('gc not supported')
    }
  }
  const refused = telemetry.installGcObserver({ PerformanceObserver: Refusing, aggregator: gc })
  same(refused.installed, false, 'refused installed')
  same(refused.reason, 'gc not supported', 'refused reason')
  refused.disconnect()
})

gate('the telemetry index exports the route, profile and observer helpers', () => {
  for (const name of ['metricsResponse', 'isLoopbackAddress', 'averageText', 'createProfileLogGate', 'formatTickProfileLine', 'installGcObserver']) {
    same(typeof telemetry[name], 'function', name)
  }
  same(typeof telemetry.METRICS_CONTENT_TYPE, 'string', 'content type')
})

finish()
