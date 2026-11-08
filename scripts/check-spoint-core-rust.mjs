import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { packQuat, unpackQuat, mulQuat, rotVec } from '../src/packages/spoint-core/quaternion.js'
import { fnv1a32, fnv1aStr, fnv1aFoldF64 } from '../src/packages/spoint-core/hash.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/spoint-core.json', import.meta.url), 'utf8'))
const view = new DataView(new ArrayBuffer(8))
const fromBits = (hex) => {
  view.setBigUint64(0, BigInt('0x' + hex))
  return view.getFloat64(0)
}
const floatsOf = (hexes) => hexes.map(fromBits)
const same = (a, b) => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))
const byOp = (op) => fixture.cases.filter((c) => c.op === op)
const mismatches = (cases, run) => cases.flatMap((c, index) => {
  const got = run(c)
  return got === null ? [] : [{ index, got, want: c.out }]
})
const sameFloats = (got, want) => got.length === want.length && got.every((x, i) => same(x, want[i]))

gate('the fixture was generated from spoint lib.rs on every operation', () => {
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
  assert.equal(fixture.source.file, 'packages/spoint-core/src/lib.rs')
  const minimum = { pack: 1000, unpack: 500, fnv1a32: 250, fnv1aStr: 7, fold: 500, mulQuat: 250, rotVec: 250 }
  for (const [op, least] of Object.entries(minimum)) {
    assert.ok((fixture.counts[op] ?? 0) >= least, `${op} has ${fixture.counts[op] ?? 0} cases, needs ${least}`)
  }
})

gate('pack_quat matches spoint lib.rs on every case, including NaN, negative zero and ties', () => {
  const bad = mismatches(byOp('pack'), (c) => {
    const [rx, ry, rz, rw] = floatsOf(c.in)
    return packQuat(rx, ry, rz, rw) === c.out ? null : packQuat(rx, ry, rz, rw)
  })
  assert.equal(bad.length, 0, `first mismatch ${JSON.stringify(bad[0])}`)
})

gate('pack_quat reaches the 1022 quantum cap, where spoint clamps and a 1023 would show', () => {
  const capped = byOp('pack').filter((c) => [0, 1, 2, 3].some((k) => ((c.out >>> (10 * k)) & 0x3ff) === 1022))
  assert.ok(capped.length > 0, 'no case packs a quantum of 1022')
})

gate('pack_quat covers a NaN component, which spoint clamps to 0', () => {
  const nan = byOp('pack').filter((c) => floatsOf(c.in).some((x) => Number.isNaN(x)))
  assert.ok(nan.length > 0, 'no NaN case in the fixture')
})

gate('unpack_quat matches spoint lib.rs on every packed word', () => {
  const bad = mismatches(byOp('unpack'), (c) => {
    const got = unpackQuat(c.in)
    return sameFloats(got, floatsOf(c.out)) ? null : got
  })
  assert.equal(bad.length, 0, `first mismatch ${JSON.stringify(bad[0])}`)
})

gate('fnv1a32 matches spoint lib.rs on every byte string', () => {
  const bad = mismatches(byOp('fnv1a32'), (c) => (fnv1a32(Uint8Array.from(c.in)) === c.out ? null : fnv1a32(Uint8Array.from(c.in))))
  assert.equal(bad.length, 0, `first mismatch ${JSON.stringify(bad[0])}`)
})

gate('fnv1aStr matches spoint lib.rs on every string, including multi-byte UTF-8', () => {
  const bad = mismatches(byOp('fnv1aStr'), (c) => (fnv1aStr(c.in) === c.out ? null : fnv1aStr(c.in)))
  assert.equal(bad.length, 0, `first mismatch ${JSON.stringify(bad[0])}`)
})

gate('fnv1aFoldF64 matches spoint lib.rs on every hash and float, including -0 and NaN', () => {
  const bad = mismatches(byOp('fold'), (c) => {
    const got = fnv1aFoldF64(c.in[0], fromBits(c.in[1]))
    return got === c.out ? null : got
  })
  assert.equal(bad.length, 0, `first mismatch ${JSON.stringify(bad[0])}`)
})

gate('mulQuat matches spoint lib.rs on every pair of quaternions', () => {
  const bad = mismatches(byOp('mulQuat'), (c) => {
    const got = mulQuat(floatsOf(c.in.slice(0, 4)), floatsOf(c.in.slice(4, 8)))
    return sameFloats(got, floatsOf(c.out)) ? null : got
  })
  assert.equal(bad.length, 0, `first mismatch ${JSON.stringify(bad[0])}`)
})

gate('rotVec matches spoint lib.rs on every vector and quaternion', () => {
  const bad = mismatches(byOp('rotVec'), (c) => {
    const got = rotVec(floatsOf(c.in.slice(0, 3)), floatsOf(c.in.slice(3, 7)))
    return sameFloats(got, floatsOf(c.out)) ? null : got
  })
  assert.equal(bad.length, 0, `first mismatch ${JSON.stringify(bad[0])}`)
})

finish()
