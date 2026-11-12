import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { finish, gate } from './lib/gate.mjs'
import { fnv1a32, fnv1aFoldF64, fnv1aStr } from '../src/packages/spoint-core/hash.js'
import { mulQuat, packQuat, rotVec, unpackQuat } from '../src/packages/spoint-core/quaternion.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/spoint-core.json', import.meta.url), 'utf8'))
const casesOf = (op) => fixture.cases.filter((c) => c.op === op)

gate('fnv1a32 takes any byte slice, as the Rust &[u8] does: a Uint8Array, a clamped array, an ArrayBuffer, a DataView and a view with an offset give the lib.rs hash', () => {
  const cases = casesOf('fnv1a32')
  assert.ok(cases.length >= 250, 'only ' + cases.length + ' fixture cases')
  for (const c of cases) {
    const bytes = Uint8Array.from(c.in)
    const padded = new Uint8Array(bytes.length + 5)
    padded.set(bytes, 3)
    assert.equal(fnv1a32(bytes), c.out)
    assert.equal(fnv1a32(Uint8ClampedArray.from(c.in)), c.out)
    assert.equal(fnv1a32(bytes.buffer), c.out)
    assert.equal(fnv1a32(new DataView(padded.buffer, 3, bytes.length)), c.out)
    assert.equal(fnv1a32(padded.subarray(3, 3 + bytes.length)), c.out)
    assert.equal(fnv1a32(Buffer.from(c.in)), c.out)
  }
})

gate('fnv1a32 refuses what is not a byte slice: a plain array, a string, a Float32Array and nothing', () => {
  for (const bad of [[1, 2, 3], 'abc', new Float32Array(2), new Uint16Array(2), null, undefined, 7]) assert.throws(() => fnv1a32(bad), /takes a byte slice/)
})

gate('fnv1aStr refuses a lone surrogate, which no Rust &str can hold, instead of hashing it as U+FFFD', () => {
  for (const bad of ['\ud800', 'a\udc00b', '\ud83d', 'x\ud83dy\ude00']) assert.throws(() => fnv1aStr(bad), /well-formed text/)
  assert.throws(() => fnv1aStr(5), /takes a string/)
  assert.equal(fnv1aStr('😀'), fnv1a32(Uint8Array.of(0xf0, 0x9f, 0x98, 0x80)))
  assert.equal(fnv1aStr('�'), fnv1a32(Uint8Array.of(0xef, 0xbf, 0xbd)))
})

gate('fnv1aStr still matches lib.rs on every fixture string', () => {
  const cases = casesOf('fnv1aStr')
  assert.ok(cases.length >= 7, 'only ' + cases.length + ' fixture cases')
  for (const c of cases) assert.equal(fnv1aStr(c.in), c.out)
})

gate('fnv1aFoldF64 folds through one scratch buffer: a fold of one number does not disturb the next, and 200000 folds equal a byte-wise fold', () => {
  const view = new DataView(new ArrayBuffer(8))
  const bytewise = (hash, n) => {
    if (Number.isNaN(n)) view.setBigUint64(0, 0x7ff8000000000000n, true)
    else view.setFloat64(0, n === 0 ? 0 : n, true)
    let folded = hash >>> 0
    for (let i = 0; i < 8; i++) folded = Math.imul((folded ^ view.getUint8(i)) >>> 0, 16777619) >>> 0
    return folded
  }
  let a = 0x811c9dc5, b = 0x811c9dc5
  let seed = 99
  for (let i = 0; i < 200000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const n = i % 97 === 0 ? NaN : i % 89 === 0 ? -0 : (seed / 4294967296 - 0.5) * 1e6
    a = fnv1aFoldF64(a, n)
    b = bytewise(b, n)
  }
  assert.equal(a, b)
  assert.equal(fnv1aFoldF64(7, -0), fnv1aFoldF64(7, 0))
  assert.equal(fnv1aFoldF64(7, NaN), fnv1aFoldF64(7, -NaN))
})

gate('a short quaternion or vector is refused with a RangeError that names the length, where Rust panics on the index', () => {
  assert.throws(() => mulQuat([0, 0, 0], [0, 0, 0, 1]), RangeError)
  assert.throws(() => rotVec([1, 0], [0, 0, 0, 1]), RangeError)
  assert.throws(() => rotVec([1, 0, 0], [0, 0, 1]), RangeError)
  assert.deepEqual(rotVec([1, 0, 0], [0, 0, 0, 1]), [1, 0, 0])
})

gate('the 10-bit quaternion word round-trips to within one quantum on 5000 seeded unit quaternions', () => {
  let seed = 5
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - 0.5 }
  let worst = 0
  for (let i = 0; i < 5000; i++) {
    const q = [random(), random(), random(), random()]
    const length = Math.hypot(...q)
    if (length < 1e-3) continue
    const unit = q.map((c) => c / length)
    const back = unpackQuat(packQuat(...unit))
    const dot = Math.abs(unit[0] * back[0] + unit[1] * back[1] + unit[2] * back[2] + unit[3] * back[3])
    worst = Math.max(worst, 1 - dot)
  }
  assert.ok(worst < 2e-6, 'worst alignment error ' + worst)
})

gate('negative control: the replacement character and a lone surrogate would share one hash under the old encoding, which is the collision the refusal removes', () => {
  const replaced = new TextEncoder().encode('\ud800')
  assert.deepEqual(Array.from(replaced), [0xef, 0xbf, 0xbd])
  assert.equal(fnv1a32(replaced), fnv1aStr('�'))
})

finish()
