import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = process.argv[2] || '/workspace/spoint'
const spoint = await import(pathToFileURL(join(spointRoot, 'src', 'client', 'reexpressRecords.js')).href)

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

const playerBase = { position: [1, 2, 3], velocity: [0, -1, 0], rotation: 0.5, lookYaw: 0.1, lookPitch: -0.2, groundNormal: [0, 1, 0] }
const entityBase = { position: [4, 5, 6], velocity: [1, 0, 0], rotation: 1.5 }

const PLAYER_CASES = [
  ['a full player record reexpresses every field and clears the wall planes', { ...playerBase, wallPlanes: [{ n: [1, 0, 0] }, { n: [0, 0, 1] }] }],
  ['a player without a wall plane field gains none', { ...playerBase }],
  ['an empty wall plane list stays empty', { ...playerBase, wallPlanes: [] }],
  ['a null wall plane list is left as it is', { ...playerBase, wallPlanes: null }],
  ['a non-finite position component is passed through unchanged', { ...playerBase, position: [NaN, 0, Infinity], wallPlanes: [{ n: [0, 1, 0] }] }],
  ['a player with no ground normal passes undefined to the pass', { position: [0, 0, 0], velocity: [0, 0, 0], rotation: 0, lookYaw: 0, lookPitch: 0, wallPlanes: [{ n: [1, 0, 0] }] }],
]

const ENTITY_CASES = [
  ['an entity record reexpresses position, velocity and rotation', { ...entityBase }],
  ['an entity with zero state reexpresses zeros', { position: [0, 0, 0], velocity: [0, 0, 0], rotation: 0 }],
  ['an entity with a non-finite rotation passes it through unchanged', { ...entityBase, rotation: Infinity }],
  ['an entity that carries wall planes keeps them', { ...entityBase, wallPlanes: [{ n: [1, 0, 0] }] }],
]

const runOn = (fn, raw) => {
  const subject = structuredClone(raw)
  const pass = recordingPass(subject)
  fn(pass, subject)
  return { trace: encode(pass.log), hasWallPlanes: 'wallPlanes' in subject, wallPlanes: encode(subject.wallPlanes) }
}

const cases = [
  ...PLAYER_CASES.map(([label, raw]) => ({ label, kind: 'player', input: encode(raw), expect: runOn(spoint.reexpressPlayerRecord, raw) })),
  ...ENTITY_CASES.map(([label, raw]) => ({ label, kind: 'entity', input: encode(raw), expect: runOn(spoint.reexpressEntityRecord, raw) })),
]

writeFileSync(join(here, 'fixtures', 'spoint', 'reexpress-records.json'), JSON.stringify({ source: 'spoint src/client/reexpressRecords.js', cases }, null, 2) + '\n')
console.log('wrote', cases.length, 'cases')
