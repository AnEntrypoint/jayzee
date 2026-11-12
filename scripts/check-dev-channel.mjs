import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gate, finish } from './lib/gate.mjs'
import { createDevChannel, createDevServer, contentTypeOf, ISOLATION_HEADERS, COOP_VALUE, DevChannelError } from '../src/sandbox/devChannel.js'
import { COEP_VALUE } from '../src/sandbox/paths.js'

const clock = () => {
  let t = 1000
  return () => (t += 5)
}
const json = (out) => JSON.parse(out.body)
const post = (channel, path, value) => channel.handle({ method: 'POST', path, body: typeof value === 'string' ? value : JSON.stringify(value) })
const get = (channel, path) => channel.handle({ method: 'GET', path })
const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code ?? error.constructor.name
  }
  return null
}

gate('every channel reply carries COOP same-origin, COEP require-corp and no-store', () => {
  const channel = createDevChannel({ now: clock() })
  assert.equal(COOP_VALUE, 'same-origin')
  assert.equal(COEP_VALUE, 'require-corp')
  for (const out of [get(channel, '/diag'), post(channel, '/diag', 'not json'), get(channel, '/cmd'), channel.handle({ method: 'DELETE', path: '/cmd' }), get(channel, '/cmd/result?id=9')]) {
    assert.equal(out.headers['Cross-Origin-Opener-Policy'], 'same-origin')
    assert.equal(out.headers['Cross-Origin-Embedder-Policy'], 'require-corp')
    assert.equal(out.headers['Cache-Control'], 'no-store')
    assert.match(out.headers['Content-Type'], /^application\/json/)
  }
  assert.equal(get(channel, '/other'), null, 'a path the channel does not own is left to the file server')
})

gate('/diag records single entries and batches with a sequence and the injected time, and pages them back', () => {
  const channel = createDevChannel({ now: clock() })
  assert.deepEqual(json(post(channel, '/diag', { level: 'warn', msg: 'slow frame', data: { ms: 40 } })), { ok: true, seq: 1, recorded: 1 })
  assert.deepEqual(json(post(channel, '/diag', [{ msg: 'a' }, { level: 'error', msg: 'b' }])), { ok: true, seq: 3, recorded: 2 })
  const all = json(get(channel, '/diag'))
  assert.deepEqual(all.entries.map((e) => [e.seq, e.t, e.level, e.msg]), [[1, 1005, 'warn', 'slow frame'], [2, 1010, 'info', 'a'], [3, 1015, 'error', 'b']])
  assert.deepEqual(all.entries[0].data, { ms: 40 })
  assert.equal(all.next, 3)
  const page = json(get(channel, '/diag?since=1&limit=1'))
  assert.deepEqual(page.entries.map((e) => e.seq), [2])
  assert.equal(page.next, 2)
  assert.deepEqual(json(get(channel, '/diag?since=3')).entries, [])
})

gate('the diag log is a fixed ring: old entries fall off and the reader is told how many it missed', () => {
  const channel = createDevChannel({ now: clock(), diagCapacity: 4 })
  for (let i = 1; i <= 10; i++) channel.diag('info', 'm' + i)
  const out = json(get(channel, '/diag?since=2'))
  assert.deepEqual(out.entries.map((e) => e.msg), ['m7', 'm8', 'm9', 'm10'])
  assert.equal(out.dropped, 4)
  assert.equal(out.latest, 10)
  assert.deepEqual(channel.stats, { diagWritten: 10, diagHeld: 4, cmdIssued: 0, cmdOpen: 0 })
  assert.equal(json(get(channel, '/diag?since=8')).dropped, 0, 'negative control: a reader that kept up missed nothing')
})

gate('/cmd hands each queued command to the page once, in order, and the result comes back by id', () => {
  const channel = createDevChannel({ now: clock() })
  const a = json(post(channel, '/cmd', { cmd: 'teleport', args: [1, 2, 3] })).id
  const b = json(post(channel, '/cmd', { cmd: 'screenshot' })).id
  assert.deepEqual([a, b], [1, 2])
  assert.equal(json(get(channel, '/cmd/result?id=1')).command.state, 'pending')
  assert.deepEqual(json(get(channel, '/cmd')).commands, [{ id: 1, cmd: 'teleport', args: [1, 2, 3] }, { id: 2, cmd: 'screenshot', args: null }])
  assert.deepEqual(json(get(channel, '/cmd')).commands, [], 'a command is delivered once')
  assert.equal(json(get(channel, '/cmd/result?id=2')).command.state, 'sent')
  assert.deepEqual(json(post(channel, '/cmd/result', { id: 2, ok: true, result: { png: 'x' } })), { ok: true, id: 2, state: 'done' })
  assert.deepEqual(json(get(channel, '/cmd/result?id=2')).command, { id: 2, cmd: 'screenshot', state: 'done', ok: true, result: { png: 'x' } })
  assert.equal(post(channel, '/cmd/result', { id: 2, ok: true }).status, 409)
  assert.equal(json(post(channel, '/cmd/result', { id: 77, ok: true })).code, 'cmd-unknown')
})

gate('the command queue is bounded: a full queue answers 429 and frees a slot when a result lands', () => {
  const channel = createDevChannel({ now: clock(), cmdCapacity: 2 })
  post(channel, '/cmd', { cmd: 'a' })
  post(channel, '/cmd', { cmd: 'b' })
  const full = post(channel, '/cmd', { cmd: 'c' })
  assert.equal(full.status, 429)
  assert.equal(json(full).code, 'cmd-queue-full')
  assert.equal(json(post(channel, '/cmd/result', { id: 1, ok: true })).code, 'cmd-not-taken')
  get(channel, '/cmd?limit=1')
  post(channel, '/cmd/result', { id: 1, ok: false, result: 'failed' })
  const id = json(post(channel, '/cmd', { cmd: 'c' })).id
  assert.equal(id, 3)
  assert.deepEqual(json(get(channel, '/cmd')).commands.map((c) => c.cmd), ['b', 'c'])
  assert.equal(get(channel, '/cmd/result?id=1').status, 404, 'the finished slot was reused')
  assert.equal(channel.stats.cmdOpen, 2)
})

gate('malformed requests are refused with a status and a code, and record nothing', () => {
  const channel = createDevChannel({ now: clock(), maxBodyBytes: 64 })
  const cases = [
    [post(channel, '/diag', 'nope'), 400, 'body-not-json'],
    [post(channel, '/diag', '7'), 400, 'body-not-object'],
    [post(channel, '/diag', []), 400, 'body-empty'],
    [post(channel, '/diag', { level: 'loud', msg: 'x' }), 400, 'diag-entry-malformed'],
    [post(channel, '/diag', [{ msg: 'fine' }, { msg: '' }]), 400, 'diag-entry-malformed'],
    [post(channel, '/diag', { msg: 'x'.repeat(100) }), 413, 'body-too-large'],
    [channel.handle({ method: 'POST', path: '/diag', body: '', oversize: true }), 413, 'body-too-large'],
    [channel.handle({ method: 'POST', path: '/diag' }), 400, 'body-missing'],
    [channel.handle({ method: 'PUT', path: '/diag' }), 405, 'method-not-allowed'],
    [get(channel, '/diag?since=-1'), 400, 'query-not-whole'],
    [get(channel, '/diag?limit=0'), 400, 'query-not-whole'],
    [post(channel, '/cmd', { cmd: 5 }), 400, 'cmd-not-text'],
    [post(channel, '/cmd/result', { ok: true }), 400, 'result-id-not-whole'],
    [get(channel, '/cmd/result'), 400, 'query-not-whole'],
  ]
  for (const [out, status, want] of cases) {
    assert.equal(out.status, status, want)
    assert.equal(json(out).code, want)
    assert.equal(json(out).ok, false)
  }
  assert.deepEqual(channel.stats, { diagWritten: 0, diagHeld: 0, cmdIssued: 0, cmdOpen: 0 })
  assert.equal(code(() => createDevChannel({})), 'TypeError')
  assert.equal(code(() => createDevChannel({ now: clock(), diagCapacity: 0 })), 'dev-channel-capacity-not-whole')
  assert.ok(new DevChannelError('a', 'b') instanceof Error)
})

const fixtureRoot = mkdtempSync(join(tmpdir(), 'jz-dev-'))
mkdirSync(join(fixtureRoot, 'site'))
writeFileSync(join(fixtureRoot, 'site', 'index.html'), '<p>hello</p>')
writeFileSync(join(fixtureRoot, 'site', 'app.js'), 'export const a = 1\n')
writeFileSync(join(fixtureRoot, 'secret.txt'), 'outside')
const readFile = (path) => readFileSync(path)

gate('the file server answers with the isolation headers, serves the index and refuses a path that leaves the root', () => {
  const server = createDevServer({ channel: createDevChannel({ now: clock() }), root: join(fixtureRoot, 'site'), readFile, createServer: (listener) => ({ listener }) })
  const index = server.respond({ method: 'GET', path: '/' })
  assert.equal(index.status, 200)
  assert.equal(String(index.body), '<p>hello</p>')
  assert.equal(index.headers['Content-Type'], 'text/html; charset=utf-8')
  for (const [name, value] of Object.entries(ISOLATION_HEADERS)) assert.equal(index.headers[name], value)
  assert.equal(server.respond({ method: 'GET', path: '/app.js?v=3' }).headers['Content-Type'], 'text/javascript; charset=utf-8')
  assert.equal(server.respond({ method: 'HEAD', path: '/app.js' }).body, '')
  assert.equal(server.respond({ method: 'GET', path: '/missing.js' }).status, 404)
  for (const escape of ['/../secret.txt', '/%2e%2e/secret.txt', '/a/../../secret.txt']) {
    const out = server.respond({ method: 'GET', path: escape })
    assert.equal(out.status, 403, escape)
    assert.equal(JSON.parse(out.body).code, 'path-outside-root')
    assert.equal(out.headers['Cross-Origin-Embedder-Policy'], 'require-corp')
  }
  assert.equal(server.respond({ method: 'GET', path: '/%zz' }).status, 403)
  assert.equal(server.respond({ method: 'POST', path: '/app.js' }).status, 405)
  assert.equal(contentTypeOf('x.wasm'), 'application/wasm')
  assert.equal(contentTypeOf('x'), 'application/octet-stream')
  assert.equal(code(() => createDevServer({ channel: {}, root: 'x', readFile, createServer: () => null })), 'TypeError')
})

gate('over a real loopback socket a page and a tool trade a command, a result and a diag line', async () => {
  const channel = createDevChannel({ now: clock(), maxBodyBytes: 256 })
  const { server } = createDevServer({ channel, root: join(fixtureRoot, 'site'), readFile, createServer: (listener) => http.createServer(listener) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const call = async (path, body) => {
    const res = await fetch(base + path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })
    return { status: res.status, coep: res.headers.get('cross-origin-embedder-policy'), coop: res.headers.get('cross-origin-opener-policy'), text: await res.text() }
  }
  try {
    const page = await call('/')
    assert.deepEqual([page.status, page.coep, page.coop, page.text], [200, 'require-corp', 'same-origin', '<p>hello</p>'])
    const sent = JSON.parse((await call('/cmd', { cmd: 'reload', args: { hard: true } })).text)
    const taken = JSON.parse((await call('/cmd')).text)
    assert.deepEqual(taken.commands, [{ id: sent.id, cmd: 'reload', args: { hard: true } }])
    await call('/cmd/result', { id: sent.id, ok: true, result: 'reloaded' })
    await call('/diag', { level: 'info', msg: 'reloaded in 12 ms' })
    assert.equal(JSON.parse((await call('/cmd/result?id=' + sent.id)).text).command.result, 'reloaded')
    assert.equal(JSON.parse((await call('/diag?since=0')).text).entries[0].msg, 'reloaded in 12 ms')
    const big = await call('/diag', { msg: 'x'.repeat(1000) })
    assert.equal(big.status, 413)
    assert.equal(big.coep, 'require-corp')
    assert.equal((await call('/../secret.txt')).status === 200, false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

finish()
