import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, canon, numberFromJson, numberToJson } from './lib/app-runtime-fixture-codec.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')

const stateModule = await import(pathToFileURL(join(spointRoot, 'src/apps/AppRuntimeState.js')).href)
const motionModule = await import(pathToFileURL(join(spointRoot, 'src/apps/AppRuntimeStaticMotion.js')).href)

const tagCases = [
  { name: 'tag: null, undefined, 0, empty string, false and NaN return null', op: 'tag', input: null },
  { name: 'tag: undefined input returns null', op: 'tag', input: { $undef: true } },
  { name: 'tag: zero input returns null', op: 'tag', input: 0 },
  { name: 'tag: empty string input returns null', op: 'tag', input: '' },
  { name: 'tag: false input returns null', op: 'tag', input: false },
  { name: 'tag: NaN input returns null', op: 'tag', input: { $num: 'NaN' } },
  { name: 'tag: a Map and a Set keep insertion order', op: 'tag', input: { m: { $map: [['a', 1], ['b', 2]] }, s: { $set: [3, 4] }, n: 5 } },
  { name: 'tag: a Map nested in a Map entry and a Set nested in that', op: 'tag', input: { $map: [['outer', { $map: [['inner', { $set: ['x'] }]] }]] } },
  { name: 'tag: an object key in a Map is kept as an object', op: 'tag', input: { $map: [[{ k: 1 }, 2]] } },
  { name: 'tag: undefined object values are dropped', op: 'tag', input: { a: { $undef: true }, b: 1 } },
  { name: 'tag: undefined array items become null', op: 'tag', input: [{ $undef: true }, 2] },
  { name: 'tag: NaN in a plain object becomes null', op: 'tag', input: { x: { $num: 'NaN' } } },
  { name: 'tag: an empty Map and an empty Set', op: 'tag', input: { m: { $map: [] }, s: { $set: [] } } },
  { name: 'tag: a Date is serialised by its toJSON', op: 'tag', input: { d: { $date: '2026-01-02T03:04:05.000Z' } } },
  { name: 'tag: a function at the top level throws SyntaxError', op: 'tag', input: { $fn: true } },
  { name: 'untag: null, undefined, 0, empty string, false and NaN return null', op: 'untag', input: null },
  { name: 'untag: undefined input returns null', op: 'untag', input: { $undef: true } },
  { name: 'untag: zero input returns null', op: 'untag', input: 0 },
  { name: 'untag: empty string input returns null', op: 'untag', input: '' },
  { name: 'untag: false input returns null', op: 'untag', input: false },
  { name: 'untag: NaN input returns null', op: 'untag', input: { $num: 'NaN' } },
  { name: 'untag: a tagged Map holding a tagged Set is restored', op: 'untag', input: { __type: 'Map', entries: [['k', { __type: 'Set', values: [1, 2] }]] } },
  { name: 'untag: a Map entries field that is not an array stays plain', op: 'untag', input: { __type: 'Map', entries: 'not-an-array' } },
  { name: 'untag: a Set values field that is not an array stays plain', op: 'untag', input: { __type: 'Set', values: { 0: 1 } } },
  { name: 'untag: extra keys on a tagged Map are dropped', op: 'untag', input: { __type: 'Map', entries: [['a', 1]], extra: 2 } },
  { name: 'untag: a Map entry that is not a pair throws TypeError', op: 'untag', input: { __type: 'Map', entries: [1, 2] } },
  { name: 'untag: a live Map is serialised to an empty object first', op: 'untag', input: { $map: [['a', 1]] } },
  { name: 'untag: a plain number passes through', op: 'untag', input: 5 },
  { name: 'untag: a plain object with no tags passes through', op: 'untag', input: { a: [1, { b: 'c' }] } },
  { name: 'roundtrip: a Map and a Set with nesting survive tag then untag', op: 'roundtrip', input: { m: { $map: [['a', { $set: [1, 2] }]] }, n: [1, 'two'] } },
  { name: 'roundtrip: a top-level Map survives tag then untag', op: 'roundtrip', input: { $map: [[1, 'one'], [2, 'two']] } }
]

const captureCases = [
  {
    name: 'captureTransform: an all-zero pose on a zeroed snapshot reports no change',
    xfLength: 11,
    steps: [{ e: pose([0, 0, 0], [0, 0, 0, 0], [0, 0, 0]) }]
  },
  {
    name: 'captureTransform: first pose reports a change, the same pose does not, and each component change is seen',
    xfLength: 11,
    steps: [
      { e: pose([1, 2, 3], [0, 0, 0, 1], [1, 1, 1]) },
      { e: pose([1, 2, 3], [0, 0, 0, 1], [1, 1, 1]) },
      { e: pose([1.5, 2, 3], [0, 0, 0, 1], [1, 1, 1]) },
      { e: pose([1.5, 2, 3], [0, 0, 0.1, 1], [1, 1, 1]) },
      { e: pose([1.5, 2, 3], [0, 0, 0.1, 1], [1, 1, 2]) },
      { e: pose([1.5, 2, 3], [0, 0, 0.1, 1], [1, 1, 2]) }
    ]
  },
  {
    name: 'captureTransform: negative zero against zero is not a change and does not overwrite',
    xfLength: 11,
    steps: [{ e: pose([-0, 0, 0], [0, 0, 0, 1], [1, 1, 1]) }, { e: pose([-0, 0, 0], [0, 0, 0, 1], [1, 1, 1]) }]
  },
  {
    name: 'captureTransform: NaN in a component reports a change on every capture',
    xfLength: 11,
    steps: [{ e: pose([{ $num: 'NaN' }, 0, 0], [0, 0, 0, 1], [1, 1, 1]) }, { e: pose([{ $num: 'NaN' }, 0, 0], [0, 0, 0, 1], [1, 1, 1]) }]
  },
  {
    name: 'captureTransform: trailing slots beyond the ten pose values are left alone',
    xfLength: 12,
    preset: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 9],
    steps: [{ e: pose([4, 5, 6], [0, 0, 0, 1], [1, 1, 1]) }]
  },
  {
    name: 'captureTransform: a short position array stores NaN for the missing components',
    xfLength: 11,
    steps: [{ e: pose([1], [0, 0, 0, 1], [1, 1, 1]) }]
  },
  {
    name: 'captureTransform: an entity with no position throws TypeError',
    xfLength: 11,
    steps: [{ e: { rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }]
  }
]

const trackCases = [
  {
    name: 'tracking: a new static entity is captured and does not start moving',
    steps: [{ op: 'tick', idle: 3, staticIds: [1], entities: [[1, pose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] }]
  },
  {
    name: 'tracking: a static entity whose pose changes joins the moving set',
    steps: [
      { op: 'tick', idle: 3, staticIds: [1], entities: [[1, pose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [1], entities: [[1, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] }
    ]
  },
  {
    name: 'tracking: a moving entity is demoted after idle snapshots and the static version is bumped',
    steps: [
      { op: 'tick', idle: 3, staticIds: [1], entities: [[1, pose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [1], entities: [[1, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [1], entities: [[1, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [1], entities: [[1, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [1], entities: [[1, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] }
    ]
  },
  {
    name: 'tracking: a pending static re-encode stops a changed entity from starting to move, until the next tick',
    steps: [
      { op: 'tick', idle: 3, staticIds: [2], entities: [[2, pose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'bump' },
      { op: 'tick', idle: 3, staticIds: [2], entities: [[2, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [2], entities: [[2, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [2], entities: [[2, pose([2, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] }
    ]
  },
  {
    name: 'tracking: a change during the idle count restarts it',
    steps: [
      { op: 'tick', idle: 3, staticIds: [4], entities: [[4, pose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [4], entities: [[4, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [4], entities: [[4, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [4], entities: [[4, pose([2, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [4], entities: [[4, pose([2, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [4], entities: [[4, pose([2, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [4], entities: [[4, pose([2, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] }
    ]
  },
  {
    name: 'tracking: a missing entity is skipped and keeps its snapshot',
    steps: [
      { op: 'tick', idle: 3, staticIds: [3], entities: [[3, pose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [3], entities: [] },
      { op: 'tick', idle: 3, staticIds: [3], entities: [[3, pose([5, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] }
    ]
  },
  {
    name: 'tracking: forgetStaticMotion drops the snapshot and the moving flag',
    steps: [
      { op: 'tick', idle: 3, staticIds: [2], entities: [[2, pose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 3, staticIds: [2], entities: [[2, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'forget', id: 2 },
      { op: 'tick', idle: 3, staticIds: [2], entities: [[2, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] }
    ]
  },
  {
    name: 'tracking: an idle count of 1 demotes on the first unchanged tick',
    steps: [
      { op: 'tick', idle: 1, staticIds: [5], entities: [[5, pose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 1, staticIds: [5], entities: [[5, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] },
      { op: 'tick', idle: 1, staticIds: [5], entities: [[5, pose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1])]] }
    ]
  }
]

function pose(position, rotation, scale) {
  return { position: position.map(numberToJson), rotation: rotation.map(numberToJson), scale: scale.map(numberToJson) }
}

function decodePose(value) {
  return {
    position: value.position.map(numberFromJson),
    rotation: value.rotation.map(numberFromJson),
    scale: value.scale.map(numberFromJson)
  }
}

function encodeFloats(array) {
  return Array.from(array, numberToJson)
}

function runTag(input, op) {
  try {
    const value = build(input)
    if (op === 'tag') return { value: canon(stateModule.tagAppState(value)) }
    if (op === 'untag') return { value: canon(stateModule.untagAppState(value)) }
    return { value: canon(stateModule.untagAppState(stateModule.tagAppState(value))) }
  } catch (error) {
    return { throws: error.name }
  }
}

function runCapture(xfLength, preset, steps) {
  const xf = new Float64Array(xfLength)
  if (preset) xf.set(preset)
  return steps.map((step) => {
    try {
      const e = decodePose(step.e)
      const ret = motionModule.captureTransform(xf, e)
      return { ret, xf: encodeFloats(xf) }
    } catch (error) {
      return { throws: error.name, xf: encodeFloats(xf) }
    }
  })
}

function runTrack(steps) {
  const runtime = { entities: new Map(), _staticEntityIds: [], _movedStaticIds: new Set(), _staticVersion: 0 }
  motionModule.mixinStaticMotion(runtime)
  return steps.map((step) => {
    if (step.op === 'tick') {
      runtime.entities = new Map(step.entities.map(([id, value]) => [id, decodePose(value)]))
      runtime._staticEntityIds = step.staticIds
      runtime.trackStaticMotion(step.idle)
    } else if (step.op === 'bump') {
      runtime._staticVersion++
    } else if (step.op === 'forget') {
      runtime._forgetStaticMotion(step.id)
    }
    return {
      moving: [...runtime._movedStaticIds].sort((a, b) => a - b),
      staticVersion: runtime._staticVersion,
      motionVersion: runtime._staticMotionVersion,
      xfs: [...runtime._staticXf.entries()].sort((a, b) => a[0] - b[0]).map(([id, xf]) => [id, encodeFloats(xf)])
    }
  })
}

const fixture = {
  generatedFrom: 'spoint src/apps/AppRuntimeState.js (tagAppState, untagAppState) and src/apps/AppRuntimeStaticMotion.js (captureTransform, mixinStaticMotion)',
  tags: tagCases.map((c) => ({ name: c.name, op: c.op, input: c.input, expect: runTag(c.input, c.op) })),
  captures: captureCases.map((c) => ({
    name: c.name,
    xfLength: c.xfLength,
    preset: c.preset ?? null,
    steps: c.steps,
    expect: runCapture(c.xfLength, c.preset, c.steps)
  })),
  tracks: trackCases.map((c) => ({ name: c.name, steps: c.steps, expect: runTrack(c.steps) }))
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'app-runtime-state.json'), JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote app-runtime-state.json: ' + fixture.tags.length + ' tag cases, ' + fixture.captures.length + ' capture cases, ' + fixture.tracks.length + ' tracking cases')
