import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { classifyResolve, parseResolve } from '../src/spawn/resolve.js'

const REDIRECT_TEXT = 'Redirecting...'

const CAPTURED_REDIRECTS = [
  { label: 'run record seq 57, probe rb-2 (trailing slash)', status: 308, location: 'https://www.spawn.co/api/resolve-adventure', body: REDIRECT_TEXT + '\n', bytes: 15 },
  { label: 'run record seq 57, probe rb-3 (http)', status: 308, location: 'https://www.spawn.co/api/resolve-adventure?address=@borickk/gta-earth', body: REDIRECT_TEXT, bytes: 14 },
  { label: 'run record seq 57, probe rb-4 (apex)', status: 307, location: 'https://www.spawn.co/api/resolve-adventure?address=@borickk/gta-earth', body: REDIRECT_TEXT + '\n', bytes: 15 },
]

const CAPTURED_400_BODY = '{"ok":false,"error":"Invalid query"}'

gate('the captured redirect bodies are the byte counts the probe reported (15, 14, 15)', () => {
  for (const c of CAPTURED_REDIRECTS) assert.equal(Buffer.byteLength(c.body), c.bytes, c.label)
})

gate('each captured redirect classifies as a redirect with its captured status and Location', () => {
  for (const c of CAPTURED_REDIRECTS) {
    const got = classifyResolve({ status: c.status, location: c.location, text: c.body })
    assert.deepEqual(got, { type: 'redirect', status: c.status, location: c.location }, c.label)
  }
})

gate('the captured 400 body is refused as an unexpected status, not read as a result', () => {
  assert.equal(Buffer.byteLength(CAPTURED_400_BODY), 36)
  assert.throws(() => classifyResolve({ status: 400, text: CAPTURED_400_BODY }), /unexpected resolve status 400/)
})

gate('a 410 is refused with the spec reason, since no captured body exists for it (label: no captured 410 body; the spec is the only source)', () => {
  assert.throws(() => classifyResolve({ status: 410, text: '' }), /does not document/)
})

gate('the spec gone result parses under 200 with its required fields (label: spec shape, not a captured body; UNVERIFIED against traffic)', () => {
  const body = { ok: true, result: { type: 'gone', appName: 'Gauntlet', username: 'alice', adventureName: 'gauntlet', deletedAt: '2026-10-01T00:00:00Z' } }
  assert.deepEqual(classifyResolve({ status: 200, text: JSON.stringify(body) }), { type: 'gone', appName: 'Gauntlet', username: 'alice', adventureName: 'gauntlet', deletedAt: '2026-10-01T00:00:00Z' })
})

gate('the spec renamed result parses under 200 as renamed (label: spec shape, UNVERIFIED against traffic)', () => {
  const body = { ok: true, result: { type: 'redirect', username: 'alice', newAdventureName: 'gauntlet' } }
  assert.deepEqual(parseResolve(JSON.stringify(body)), { type: 'renamed', username: 'alice', newAdventureName: 'gauntlet' })
})

gate('negative control: a redirect with a body other than the captured text is refused', () => {
  assert.throws(() => classifyResolve({ status: 307, location: '/x', text: '{"ok":true}' }), /unexpected body/)
})

gate('negative control: a redirect status outside 307 and 308 is refused', () => {
  assert.throws(() => classifyResolve({ status: 301, location: 'https://www.spawn.co/api/resolve-adventure', text: REDIRECT_TEXT }), /unexpected resolve status 301/)
})

finish()
