import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { build, canon, numberToJson, snapshotJson } from './lib/app-runtime-fixture-codec.mjs'
import * as tagsModule from '../src/apps/appRuntimeTags.js'
import * as motionModule from '../src/apps/appStaticMotion.js'
const { tagAppState, untagAppState } = tagsModule
const { XF_LEN, captureTransform, createStaticMotion, forgetStaticMotion, trackStaticMotion } = motionModule

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(readFileSync(join(root, 'scripts/fixtures/spoint/app-runtime-state.json'), 'utf8'))
const WORD = ['sa', 'vi'].join('')
const BANNED = new RegExp('\\b' + WORD + '\\b', 'i')
const HOST_GLOBALS = /\b(Date\.now|performance|console|window|process|setTimeout|globalThis|Math\.random|fetch)\b/
const COMMENT = /\/\/|\/\*/
const SOURCES = ['src/apps/appRuntimeTags.js', 'src/apps/appStaticMotion.js']

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const sameJson = (actual, expected, label) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  assert(a === b, label + ' is ' + a + ', expected ' + b)
}
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}
const encodeFloats = (array) => Array.from(array, numberToJson)
const decodePose = (value) => ({
  position: value.position.map((v) => (v !== null && typeof v === 'object' ? Number(v.$num) : v)),
  rotation: value.rotation.map((v) => (v !== null && typeof v === 'object' ? Number(v.$num) : v)),
  scale: value.scale.map((v) => (v !== null && typeof v === 'object' ? Number(v.$num) : v))
})

const runTagCase = (testCase) => {
  try {
    const value = build(testCase.input)
    if (testCase.op === 'tag') return { value: canon(tagAppState(value)) }
    if (testCase.op === 'untag') return { value: canon(untagAppState(value)) }
    return { value: canon(untagAppState(tagAppState(value))) }
  } catch (error) {
    return { throws: error.name }
  }
}

const runCaptureCase = (testCase) => {
  const xf = new Float64Array(testCase.xfLength)
  if (testCase.preset) xf.set(testCase.preset)
  return testCase.steps.map((step) => {
    try {
      const ret = captureTransform(xf, decodePose(step.e))
      return { ret, xf: encodeFloats(xf) }
    } catch (error) {
      return { throws: error.name, xf: encodeFloats(xf) }
    }
  })
}

const snapshotMotion = (motion) => ({
  moving: [...motion.moving].sort((a, b) => a - b),
  staticVersion: motion.staticVersion,
  motionVersion: motion.motionVersion,
  xfs: [...motion.xfs.entries()].sort((a, b) => a[0] - b[0]).map(([id, xf]) => [id, encodeFloats(xf)])
})

const runTrackCase = (steps) => {
  const motion = createStaticMotion()
  return steps.map((step) => {
    if (step.op === 'tick') {
      motion.entities = new Map(step.entities.map(([id, value]) => [id, decodePose(value)]))
      motion.staticEntityIds = step.staticIds
      trackStaticMotion(motion, step.idle)
    } else if (step.op === 'bump') {
      motion.staticVersion++
    } else if (step.op === 'forget') {
      forgetStaticMotion(motion, step.id)
    }
    return snapshotMotion(motion)
  })
}

gate('the fixture is generated from spoint and holds the full case set', () => {
  assert(/AppRuntimeState\.js/.test(fixture.generatedFrom) && /AppRuntimeStaticMotion\.js/.test(fixture.generatedFrom), 'generatedFrom does not name both spoint sources')
  assert(fixture.tags.length === 31, 'tag case count is ' + fixture.tags.length)
  assert(fixture.captures.length === 7, 'capture case count is ' + fixture.captures.length)
  assert(fixture.tracks.length === 8, 'tracking case count is ' + fixture.tracks.length)
})

gate('tagAppState matches spoint on every tag case, including its refusals and falsy inputs', () => {
  const cases = fixture.tags.filter((c) => c.op === 'tag')
  assert(cases.length > 0, 'no tag cases')
  const bad = cases.filter((c) => JSON.stringify(runTagCase(c)) !== JSON.stringify(c.expect))
  assert(bad.length === 0, bad.map((c) => c.name).join('; '))
})

gate('untagAppState matches spoint on every untag case, including non-array entries and a non-pair entry throwing TypeError', () => {
  const cases = fixture.tags.filter((c) => c.op === 'untag')
  assert(cases.length > 0, 'no untag cases')
  const bad = cases.filter((c) => JSON.stringify(runTagCase(c)) !== JSON.stringify(c.expect))
  assert(bad.length === 0, bad.map((c) => c.name).join('; '))
})

gate('untagAppState(tagAppState(state)) matches spoint on every round trip', () => {
  const cases = fixture.tags.filter((c) => c.op === 'roundtrip')
  assert(cases.length > 0, 'no round-trip cases')
  const bad = cases.filter((c) => JSON.stringify(runTagCase(c)) !== JSON.stringify(c.expect))
  assert(bad.length === 0, bad.map((c) => c.name).join('; '))
})

gate('tagAppState and untagAppState return null for every falsy state, by direct call', () => {
  for (const value of [null, undefined, 0, '', false, NaN]) {
    assert(tagAppState(value) === null, 'tagAppState(' + String(value) + ') is not null')
    assert(untagAppState(value) === null, 'untagAppState(' + String(value) + ') is not null')
  }
})

gate('tagAppState tags a Map as {__type, entries} and a Set as {__type, values} in insertion order', () => {
  sameJson(tagAppState({ m: new Map([['a', 1], ['b', 2]]), s: new Set([3, 4]), n: 5 }), { m: { __type: 'Map', entries: [['a', 1], ['b', 2]] }, s: { __type: 'Set', values: [3, 4] }, n: 5 }, 'tagged state')
})

gate('untagAppState restores a Map and a Set, including nested ones, from a tagged state', () => {
  const back = untagAppState(tagAppState({ m: new Map([['k', new Set([1])]]) }))
  assert(back.m instanceof Map && back.m.get('k') instanceof Set && back.m.get('k').has(1), 'nested Map and Set not restored')
})

gate('captureTransform matches spoint on every capture case, including NaN, negative zero and the short-array case', () => {
  const bad = fixture.captures.filter((c) => JSON.stringify(runCaptureCase(c)) !== JSON.stringify(c.expect))
  assert(bad.length === 0, bad.map((c) => c.name).join('; '))
})

gate('trackStaticMotion and forgetStaticMotion match spoint tick by tick on every tracking case', () => {
  const bad = fixture.tracks.filter((c) => JSON.stringify(runTrackCase(c.steps)) !== JSON.stringify(c.expect))
  assert(bad.length === 0, bad.map((c) => c.name).join('; '))
})

gate('captureTransform reports a component change once and never reports a negative zero against zero', () => {
  const xf = new Float64Array(XF_LEN)
  assert(captureTransform(xf, { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }) === true, 'the first capture of a new pose was not a change')
  assert(captureTransform(xf, { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }) === false, 'an unchanged pose was reported as a change')
  assert(captureTransform(xf, { position: [-0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }) === false, 'negative zero was reported as a change')
  assert(captureTransform(xf, { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 2] }) === true, 'a scale change was not reported')
})

gate('captureTransform flags a NaN component on every capture, since NaN never equals itself', () => {
  const xf = new Float64Array(XF_LEN)
  const nanPose = { position: [NaN, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
  assert(captureTransform(xf, nanPose) === true, 'first NaN capture not flagged')
  assert(captureTransform(xf, nanPose) === true, 'second NaN capture not flagged')
})

gate('captureTransform leaves the idle slot and anything past the pose alone', () => {
  const xf = new Float64Array(12)
  xf[10] = 7
  xf[11] = 9
  captureTransform(xf, { position: [4, 5, 6], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
  assert(xf[10] === 7 && xf[11] === 9, 'the idle slot or a trailing slot was overwritten')
})

gate('captureTransform throws TypeError on a pose with no position, as spoint does', () => {
  let name = ''
  try {
    captureTransform(new Float64Array(XF_LEN), { rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
  } catch (error) {
    name = error.name
  }
  assert(name === 'TypeError', 'threw ' + (name || 'nothing'))
})

gate('a moving entity is demoted after the idle count and the static version is bumped once', () => {
  const motion = createStaticMotion()
  const pose = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
  motion.staticEntityIds = [1]
  motion.entities = new Map([[1, pose(0)]])
  trackStaticMotion(motion, 2)
  motion.entities = new Map([[1, pose(1)]])
  trackStaticMotion(motion, 2)
  assert(motion.moving.has(1), 'changed entity did not start moving')
  trackStaticMotion(motion, 2)
  assert(motion.moving.has(1), 'demoted one tick early')
  trackStaticMotion(motion, 2)
  assert(!motion.moving.has(1) && motion.staticVersion === 1 && motion.motionVersion === 1, 'demotion or version bump is wrong')
})

gate('negative control: a fixture expectation with one flipped value is rejected by the comparison', () => {
  const tracked = fixture.tracks.find((c) => c.name.startsWith('tracking: a moving entity is demoted'))
  const actual = runTrackCase(tracked.steps)
  const tampered = JSON.parse(JSON.stringify(tracked.expect))
  tampered[4].staticVersion = 0
  mustReject(() => sameJson(actual, tampered, 'tampered demotion'))
  sameJson(actual, tracked.expect, 'untampered demotion')
})

gate('negative control: dropping the static version bump changes the tracking result', () => {
  const pending = fixture.tracks.find((c) => c.name.startsWith('tracking: a pending static re-encode'))
  const withoutBump = pending.steps.filter((step) => step.op !== 'bump')
  mustReject(() => sameJson(runTrackCase(withoutBump), pending.expect, 'no bump'))
})

gate('negative control: a Map and its untagged form are not equal, so an untag that skips the reviver would be caught', () => {
  const restored = untagAppState(tagAppState({ m: new Map([['a', 1]]) }))
  mustReject(() => sameJson(canon(restored), canon(tagAppState({ m: new Map([['a', 1]]) })), 'restored vs tagged'))
})

gate('negative control: negative zero and zero have different canonical snapshots, so the comparison can tell them apart', () => {
  mustReject(() => sameJson(snapshotJson(-0), snapshotJson(0), 'negative zero against zero'))
})

gate('the port sources carry no comments and no host globals, and import nothing', () => {
  for (const file of SOURCES) {
    const text = readFileSync(join(root, file), 'utf8')
    assert(!COMMENT.test(text), file + ' carries a comment marker')
    assert(!HOST_GLOBALS.test(text), file + ' reads a host global')
    assert(!/^\s*import\s/m.test(text), file + ' imports a module')
  }
})

gate('negative control: the comment and host-global scanner flags a comment and Date.now', () => {
  assert(COMMENT.test('const a = 1 // note'), 'a line comment was not flagged')
  assert(HOST_GLOBALS.test('const t = Date.now()'), 'Date.now was not flagged')
  mustReject(() => assert(!HOST_GLOBALS.test('const t = Date.now()'), 'flagged line'))
  assert(!HOST_GLOBALS.test('const t = nowValue()'), 'scanner flagged a clean line')
})

gate('the banned project word appears in neither port source, the generator, the codec nor the fixture', () => {
  for (const file of [...SOURCES, 'scripts/gen-app-runtime-state-fixture.mjs', 'scripts/lib/app-runtime-fixture-codec.mjs', 'scripts/check-app-runtime-state.mjs', 'scripts/fixtures/spoint/app-runtime-state.json']) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n')
    const hit = lines.findIndex((line) => BANNED.test(line))
    assert(hit === -1, file + ':' + (hit + 1) + ' uses the banned word')
  }
})

gate('negative control: the banned-word scanner flags the word as a whole word', () => {
  assert(BANNED.test(WORD + ' project'), 'the whole word was not matched')
  assert(!BANNED.test('saving savings'), 'a longer word was matched')
})

gate('the port modules export exactly the names the row uses', () => {
  sameJson(Object.keys(tagsModule).sort(), ['tagAppState', 'untagAppState'], 'appRuntimeTags exports')
  sameJson(Object.keys(motionModule).sort(), ['XF_IDLE', 'XF_LEN', 'captureTransform', 'createStaticMotion', 'forgetStaticMotion', 'trackStaticMotion'], 'appStaticMotion exports')
})

finish()
