import { gate, finish } from './lib/gate.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  SandboxUnavailableError,
  preflightSes,
  createSesEvaluator,
  timingSafeTokenEqual,
  resolveWithinRoot,
  COEP_VALUE,
} from '../src/sandbox/index.js'

const FakeCompartment = function () {}
const frozen = () => true

const okPreflight = await preflightSes({
  importSes: async () => ({}),
  lockdown: () => {},
  getCompartment: () => FakeCompartment,
  isFrozen: frozen,
})

const failures = [
  { code: 'ses-not-installed', opts: { importSes: async () => { throw new Error('Cannot find package ses') } } },
  { code: 'lockdown-missing', opts: { importSes: async () => ({}), lockdown: undefined } },
  { code: 'lockdown-failed', opts: { importSes: async () => ({}), lockdown: () => { throw new Error('lockdown failed') } } },
  { code: 'compartment-missing', opts: { importSes: async () => ({}), lockdown: () => {}, getCompartment: () => null } },
  { code: 'intrinsics-not-hardened', opts: { importSes: async () => ({}), lockdown: () => {}, getCompartment: () => FakeCompartment, isFrozen: () => false } },
]
const failureResults = []
for (const { code, opts } of failures) {
  failureResults.push({ code, result: await preflightSes({ getCompartment: () => FakeCompartment, isFrozen: frozen, ...opts }) })
}

let alreadyLockedCalls = 0
const alreadyLocked = await preflightSes({
  importSes: async () => ({}),
  lockdown: () => { alreadyLockedCalls++; throw new Error('SES_ALREADY_LOCKED_DOWN') },
  getCompartment: () => FakeCompartment,
  isFrozen: frozen,
})

const sesCause = Object.assign(new Error('Cannot find package ses'), { reasonCode: 'ses-not-installed' })
const unavailableError = new SandboxUnavailableError('untrusted-app', sesCause)

const refusedRecord = { made: [], evaluated: [] }
const liveRecord = { made: [], evaluated: [] }
const recordingCompartment = (record) => class RecordingCompartment {
  constructor(endowments, modules, options) { record.made.push({ endowments, options }) }
  evaluate(code) { record.evaluated.push(code); return { run: true } }
}

const refusedEvaluator = createSesEvaluator({
  importSes: async () => { throw new Error('Cannot find package ses') },
  getCompartment: () => recordingCompartment(refusedRecord),
  isFrozen: frozen,
})
const refusedError = await refusedEvaluator.evaluate('export default { name: "app" }', 'untrusted').then(() => null, (e) => e)

let evaluatorLockdownCalls = 0
const liveEvaluator = createSesEvaluator({
  importSes: async () => ({}),
  lockdown: () => { evaluatorLockdownCalls++ },
  getCompartment: () => recordingCompartment(liveRecord),
  isFrozen: frozen,
})
const accepted = await liveEvaluator.evaluate('export default { name: "app" }', 'app')

const blockedEvaluated = liveRecord.evaluated.length
const savedError = console.error
const quietErrors = []
console.error = (...args) => { quietErrors.push(args.join(' ')) }
let blockedResult
let emptyResult
try {
  blockedResult = await liveEvaluator.evaluate('export default { leak: process.exit }', 'blocked')
  emptyResult = await liveEvaluator.evaluate('', 'empty')
} finally {
  console.error = savedError
}

const tokenPairs = [
  ['s3cret-token', 's3cret-token', true],
  ['abcdef', 'abcdeg', false],
  ['abc', 'abcd', false],
  ['abcd', 'abc', false],
  ['é', 'é', true],
  ['é', 'e', false],
]
const tokenResults = tokenPairs.map(([a, b, want]) => ({ a, b, want, got: timingSafeTokenEqual(a, b) }))
const nonStringPairs = [[null, 'a'], ['a', null], [undefined, undefined], [42, 42], [{}, {}], [Buffer.from('x'), Buffer.from('x')], [Symbol('t'), Symbol('t')]]
const nonStringResults = nonStringPairs.map(([a, b]) => {
  try { return timingSafeTokenEqual(a, b) } catch (e) { return e }
})

gate('preflight reports ok with the injected compartment when every stage succeeds', () => {
  assert.equal(okPreflight.ok, true)
  assert.equal(okPreflight.reasonCode, 'ok')
  assert.equal(okPreflight.Compartment, FakeCompartment)
  assert.equal(okPreflight.cause, null)
})

for (const { code, result } of failureResults) {
  gate(`preflight reports ${code} and fails closed`, () => {
    assert.equal(result.ok, false)
    assert.equal(result.Compartment, null)
    assert.equal(result.reasonCode, code)
  })
}

gate('preflight distinguishes all five refusal reason codes', () => {
  const codes = new Set(failureResults.map((r) => r.result.reasonCode))
  assert.equal(codes.size, failureResults.length)
})

gate('preflight treats an already-locked-down runtime as ok after one lockdown call', () => {
  assert.equal(alreadyLocked.ok, true)
  assert.equal(alreadyLocked.reasonCode, 'ok')
  assert.equal(alreadyLockedCalls, 1)
})

gate('SandboxUnavailableError keeps spoint name, code and reason', () => {
  assert.equal(unavailableError.name, 'SandboxUnavailableError')
  assert.equal(unavailableError.code, 'SANDBOX_UNAVAILABLE')
  assert.equal(unavailableError.reasonCode, 'ses-not-installed')
  assert.equal(unavailableError.cause, sesCause)
  assert.equal(unavailableError.appName, 'untrusted-app')
  assert.equal(new SandboxUnavailableError('x', new Error('plain')).reasonCode, 'ses-unavailable')
})

gate('evaluator refuses with SandboxUnavailableError when SES is unavailable', () => {
  assert.ok(refusedError instanceof SandboxUnavailableError)
  assert.equal(refusedError.name, 'SandboxUnavailableError')
  assert.equal(refusedError.reasonCode, 'ses-not-installed')
})

gate('evaluator does not construct a compartment or evaluate code when SES is unavailable', () => {
  assert.equal(refusedRecord.made.length, 0)
  assert.equal(refusedRecord.evaluated.length, 0)
})

gate('evaluator accepts when SES is available and the injected lockdown succeeds', () => {
  assert.deepEqual(accepted, { default: { run: true } })
  assert.equal(evaluatorLockdownCalls, 1)
  assert.equal(liveRecord.made.length, 1)
  assert.equal(liveRecord.made[0].options.name, 'sandbox-app')
})

gate('evaluator wraps an export default source into an expression before evaluation', () => {
  assert.equal(liveRecord.evaluated[0], '({ name: "app" })')
})

gate('evaluator refuses blocked source and empty source with null, without evaluating', () => {
  assert.equal(blockedResult, null)
  assert.equal(emptyResult, null)
  assert.equal(liveRecord.evaluated.length, blockedEvaluated)
  assert.equal(quietErrors.length, 2)
})

gate('timingSafeTokenEqual is true for equal tokens and false for different tokens of equal or different length', () => {
  for (const { a, b, want, got } of tokenResults) {
    assert.equal(got, want, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
  }
})

gate('timingSafeTokenEqual never throws and returns false on non-string input', () => {
  for (const r of nonStringResults) {
    assert.equal(r instanceof Error, false, String(r))
    assert.equal(r, false)
  }
})

gate('resolveWithinRoot rejects a path that escapes the root with ../', () => {
  assert.equal(resolveWithinRoot('/srv/app', '../secret.txt'), null)
  assert.equal(resolveWithinRoot('/srv/app', '../../etc/passwd'), null)
})

gate('resolveWithinRoot accepts a nested path and the root itself', () => {
  assert.equal(resolveWithinRoot('/srv/app', 'assets/models/hero.glb'), join('/srv/app', 'assets/models/hero.glb'))
  assert.equal(resolveWithinRoot('/srv/app', '.'), '/srv/app')
})

gate('resolveWithinRoot rejects an absolute path outside the root', () => {
  assert.equal(resolveWithinRoot('/srv/app', '/etc/passwd'), null)
})

gate('resolveWithinRoot rejects a sibling directory that shares the root prefix', () => {
  assert.equal(resolveWithinRoot('/srv/app', '/srv/app-evil/x'), null)
})

gate('COEP_VALUE is require-corp as in spoint StaticHandler', () => {
  assert.equal(COEP_VALUE, 'require-corp')
})

finish()
