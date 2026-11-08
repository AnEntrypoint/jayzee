import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { reexpressPlayerRecord, reexpressEntityRecord } from '../src/client/reexpressRecords.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'reexpress-records.json'), 'utf8'))

const decode = (value) => {
  if (Array.isArray(value)) return value.map(decode)
  if (value !== null && typeof value === 'object') {
    if ('$undef' in value) return undefined
    if ('$num' in value) return Number(value.$num)
    const out = {}
    for (const key of Object.keys(value)) out[key] = decode(value[key])
    return out
  }
  return value
}

const encode = (value) => {
  if (value === undefined) return { $undef: true }
  if (typeof value === 'number' && !Number.isFinite(value)) return { $num: String(value) }
  if (Array.isArray(value)) return value.map(encode)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = encode(value[key])
    return out
  }
  return value
}

const recordingPass = (subject) => {
  const log = []
  const copy = (value) => (Array.isArray(value) ? value.slice() : value)
  return {
    log,
    point: (value) => log.push(['point', copy(value)]),
    vector: (value) => log.push(['vector', copy(value)]),
    yawRotation: (value) => log.push(['yawRotation', copy(value)]),
    rotation: (value) => log.push(['rotation', copy(value)]),
    look: (who, yawName, pitchName) => log.push(['look', who === subject ? '<subject>' : copy(who), yawName, pitchName]),
  }
}

const playerCases = fixture.cases.filter((item) => item.kind === 'player')
const entityCases = fixture.cases.filter((item) => item.kind === 'entity')

gate('the player trace is the five pass calls that spoint makes', () => {
  for (const item of playerCases) assert.equal(item.expect.trace.length, 5, item.label)
})

gate('the entity trace is the three pass calls that spoint makes', () => {
  for (const item of entityCases) assert.equal(item.expect.trace.length, 3, item.label)
})

gate('control: dropping the first pass call from a player trace is a difference, so the trace claim is not vacuous', () => {
  assert.notDeepEqual(playerCases[0].expect.trace.slice(1), playerCases[0].expect.trace)
})

for (const item of fixture.cases) {
  const fn = item.kind === 'player' ? reexpressPlayerRecord : reexpressEntityRecord
  gate('reexpress ' + item.kind + ': ' + item.label, () => {
    const input = decode(item.input)
    const pass = recordingPass(input)
    fn(pass, input)
    assert.deepEqual(encode(pass.log), item.expect.trace, 'pass calls differ from spoint')
    assert.equal('wallPlanes' in input, item.expect.hasWallPlanes, 'wallPlanes presence differs from spoint')
    assert.deepEqual(encode(input.wallPlanes), item.expect.wallPlanes, 'wallPlanes after the call differ from spoint')
  })
}

finish()
