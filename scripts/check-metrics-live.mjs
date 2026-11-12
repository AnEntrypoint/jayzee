import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { METRICS_PATH, createMetricsRoute, isMetricsPath } from '../src/sdk/MetricsRoute.js'
import { METRICS_CONTENT_TYPE } from '../src/telemetry-pure/metricsRoute.js'
import { createTelemetryRegistry } from '../src/telemetry-pure/registry.js'

const cli = fileURLToPath(new URL('../bin/jayzee-serve.js', import.meta.url))

const call = (port, path, method = 'GET') => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
  })
  req.on('error', reject)
  req.end()
})

const listen = (handler) => new Promise((resolve) => {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1', () => resolve(server))
})

const close = (server) => new Promise((resolve) => server.close(resolve))

const fakeResponse = () => {
  const seen = { status: null, headers: null, body: null }
  return { seen, writeHead(status, headers) { seen.status = status; seen.headers = headers }, end(body) { seen.body = body === undefined ? null : String(body) } }
}

const startCli = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, '--host', '127.0.0.1', '--port', '0'], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('no listen line within 10 s')) }, 10000)
  child.stdout.on('data', (chunk) => {
    out += chunk
    const match = /listening on \S+:(\d+)/.exec(out)
    if (match) {
      clearTimeout(timer)
      resolve({ child, port: Number(match[1]) })
    }
  })
  child.on('exit', (code) => { clearTimeout(timer); reject(new Error('exited before listening, code ' + code)) })
})

const stopCli = (child) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) return resolve()
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  child.once('exit', () => { clearTimeout(timer); resolve() })
  child.kill('SIGTERM')
})

const fixture = () => {
  const registry = createTelemetryRegistry()
  registry.recordSnapshotBytes(300)
  registry.recordTickPhase('total', 4)
  let reads = 0
  const route = createMetricsRoute({ registry, snapshot: () => { reads += 1; return { tick: 77, players: 3 } } })
  return { registry, route, reads: () => reads }
}

gate('a GET on a live loopback server answers 200 with the Prometheus content type and the rendered registry', async () => {
  const { registry, route } = fixture()
  const server = await listen(route)
  try {
    const answer = await call(server.address().port, METRICS_PATH)
    assert.equal(answer.status, 200)
    assert.equal(answer.headers['content-type'], METRICS_CONTENT_TYPE)
    assert.equal(answer.headers['cache-control'], 'no-store')
    assert.equal(answer.body, registry.render({ tick: 77, players: 3 }))
    assert.match(answer.body, /^spoint_tick 77$/m)
    assert.match(answer.body, /^spoint_players 3$/m)
    assert.match(answer.body, /^spoint_snapshot_bytes_total 300$/m)
    assert.match(answer.body, /spoint_tick_phase_ms_bucket\{phase="total"/)
    assert.equal(Number(answer.headers['content-length']), Buffer.byteLength(answer.body))
  } finally {
    await close(server)
  }
})

gate('a later GET shows a value recorded after the first one, so the body is rendered per request', async () => {
  const { registry, route } = fixture()
  const server = await listen(route)
  try {
    const first = await call(server.address().port, METRICS_PATH)
    registry.recordSnapshotBytes(200)
    const second = await call(server.address().port, METRICS_PATH)
    assert.match(first.body, /^spoint_snapshot_bytes_total 300$/m)
    assert.match(second.body, /^spoint_snapshot_bytes_total 500$/m)
  } finally {
    await close(server)
  }
})

gate('a HEAD answers 200 with the length and no body, and a POST answers 405 with the allowed methods', async () => {
  const { route, reads } = fixture()
  const server = await listen(route)
  try {
    const head = await call(server.address().port, METRICS_PATH, 'HEAD')
    assert.equal(head.status, 200)
    assert.equal(head.body, '')
    assert.ok(Number(head.headers['content-length']) > 0)
    const before = reads()
    const post = await call(server.address().port, METRICS_PATH, 'POST')
    assert.equal(post.status, 405)
    assert.equal(post.headers.allow, 'GET, HEAD')
    assert.equal(reads(), before)
  } finally {
    await close(server)
  }
})

gate('a peer that is not loopback gets 403 and the snapshot is never read', () => {
  const { route, reads } = fixture()
  for (const remoteAddress of ['10.0.0.5', '192.168.1.9', '127.0.0.2', undefined]) {
    const res = fakeResponse()
    route({ method: 'GET', socket: { remoteAddress } }, res)
    assert.equal(res.seen.status, 403)
    assert.equal(res.seen.body, 'forbidden')
  }
  assert.equal(reads(), 0)
})

gate('control: the same fake request from loopback gets 200 and reads the snapshot once', () => {
  const { route, reads } = fixture()
  const res = fakeResponse()
  route({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, res)
  assert.equal(res.seen.status, 200)
  assert.equal(reads(), 1)
})

gate('the path match takes /metrics with or without a query and nothing else', () => {
  assert.equal(isMetricsPath('/metrics'), true)
  assert.equal(isMetricsPath('/metrics?x=1'), true)
  assert.equal(isMetricsPath('/metrics/'), false)
  assert.equal(isMetricsPath('/metricsx'), false)
  assert.equal(isMetricsPath('/'), false)
  assert.equal(isMetricsPath(undefined), false)
})

gate('the route refuses a registry without render and a snapshot that is not a function', () => {
  assert.throws(() => createMetricsRoute({ registry: {}, snapshot: () => ({}) }), TypeError)
  assert.throws(() => createMetricsRoute({ registry: createTelemetryRegistry(), snapshot: null }), TypeError)
})

gate('the spawned jayzee-serve answers /metrics with uptime and memory gauges, and still answers 404 elsewhere', async () => {
  const { child, port } = await startCli()
  try {
    const metrics = await call(port, '/metrics')
    assert.equal(metrics.status, 200)
    assert.equal(metrics.headers['content-type'], METRICS_CONTENT_TYPE)
    assert.match(metrics.body, /^spoint_uptime_seconds \d+$/m)
    assert.match(metrics.body, /^spoint_process_rss_bytes \d+$/m)
    assert.match(metrics.body, /^# TYPE spoint_snapshot_bytes histogram$/m)
    const other = await call(port, '/nothing-here')
    assert.equal(other.status, 404)
  } finally {
    await stopCli(child)
  }
})

finish()
