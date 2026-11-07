import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as render from '../src/render/index.js'
import {
  setInstancedCullAuto, setBatchedMeshCullAuto, createCullFreeze,
  createOcclusionPolicy, createOcclusionQueryBudget,
  PostFxLookError, parsePostFxLook, applyLook, lookPasses, postfxLookNode,
  EXPR_NEUTRAL, EXPR_HAPPY, EXPR_AA, EXPR_IH, EXPR_BLINK, nameToCode, pickExpressionCode, applyExpressionCode,
  TreeTextureBudgetError, treeTextureQueryValue, parseTreeTextureMaxPx, resolveTreeTextureBudget, halvingsFor, decodedRgbaBytes, mipChainBytes,
  REBASE_THRESHOLD_M, createFloatingOrigin,
  grassWindGust,
} from '../src/render/index.js'

const renderDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'render')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const close = (actual, expected, label, eps = 1e-9) => assert(Math.abs(actual - expected) <= eps, `${label}: ${actual} != ${expected}`)
const refusedWith = (fn, code) => {
  try {
    fn()
  } catch (error) {
    return error instanceof Error && error.reasonCode === code
  }
  return false
}
const vec = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this } })
const identityPose = (x = 0, y = 0, z = 0) => ({ x, y, z, qx: 0, qy: 0, qz: 0, qw: 1 })
const yawPose = (degrees, x = 0, y = 0, z = 0) => {
  const half = (degrees * Math.PI / 180) / 2
  return { x, y, z, qx: 0, qy: Math.sin(half), qz: 0, qw: Math.cos(half) }
}
const nonRelativeImport = /from\s+['"](?!\.\.?\/)[^'"]+['"]/
const commentToken = /\/\/|\/\*/
const portedFiles = readdirSync(renderDir).filter(name => name.endsWith('.js')).map(name => ({ name, text: readFileSync(join(renderDir, name), 'utf8') }))

gate('detector flags a three import and a comment, and passes a relative import', () => {
  assert(nonRelativeImport.test("import * as THREE from 'three'"), 'three import not flagged')
  assert(nonRelativeImport.test("import { x } from '/src/terrain/PlanetFrame.js'"), 'absolute terrain import not flagged')
  assert(!nonRelativeImport.test("import { x } from './cullFreeze.js'"), 'relative import flagged')
  assert(commentToken.test('const a = 1 // note'), 'line comment not flagged')
  assert(!commentToken.test('const a = 1'), 'bare statement flagged as comment')
})

gate('every ported render module imports only relative paths', () => {
  const offenders = portedFiles.filter(f => nonRelativeImport.test(f.text)).map(f => f.name)
  assert(offenders.length === 0, 'non-relative import in ' + offenders.join(', '))
})

gate('every ported render source carries no comments', () => {
  const commented = portedFiles.filter(f => commentToken.test(f.text)).map(f => f.name)
  assert(commented.length === 0, 'comment token in ' + commented.join(', '))
})

gate('the barrel exposes every ported symbol and refuses an unknown one', () => {
  const ported = ['setInstancedCullAuto', 'setBatchedMeshCullAuto', 'createCullFreeze', 'createOcclusionPolicy', 'createOcclusionQueryBudget', 'parsePostFxLook', 'applyLook', 'lookPasses', 'postfxLookNode', 'nameToCode', 'pickExpressionCode', 'applyExpressionCode', 'resolveTreeTextureBudget', 'halvingsFor', 'mipChainBytes', 'createFloatingOrigin', 'grassWindGust']
  const missing = ported.filter(name => typeof render[name] !== 'function')
  assert(missing.length === 0, 'missing ' + missing.join(', '))
  assert(render.noSuchExport === undefined, 'unknown export resolved')
})

gate('setInstancedCullAuto writes the mesh and every LOD level, and leaves other meshes alone', () => {
  const mesh = { autoUpdate: true, LODinfo: { objects: [{ autoUpdate: true }, { autoUpdate: true }] } }
  const sibling = { autoUpdate: true }
  setInstancedCullAuto(mesh, false)
  assert(mesh.autoUpdate === false && mesh.LODinfo.objects.every(level => level.autoUpdate === false), 'mesh or LOD not cleared')
  assert(sibling.autoUpdate === true, 'sibling mesh was changed')
  setInstancedCullAuto(null, false)
})

gate('setInstancedCullAuto without LODinfo sets only the mesh flag', () => {
  const mesh = { autoUpdate: false }
  setInstancedCullAuto(mesh, true)
  assert(mesh.autoUpdate === true && !('LODinfo' in mesh), 'flag not set on bare mesh')
})

gate('setBatchedMeshCullAuto sets per-object culling and marks visibility changed', () => {
  const culled = { perObjectFrustumCulled: true }
  setBatchedMeshCullAuto(culled, false)
  assert(culled.perObjectFrustumCulled === false && culled._visibilityChanged === true, 'batched flags wrong')
  const live = { perObjectFrustumCulled: false }
  setBatchedMeshCullAuto(live, true)
  assert(live.perObjectFrustumCulled === true, 'auto true did not reach the mesh')
  assert(culled.perObjectFrustumCulled !== live.perObjectFrustumCulled, 'the two calls did not differ')
})

gate('createCullFreeze freezes after one still step and unfreezes on movement', () => {
  const calls = []
  const freeze = createCullFreeze(auto => calls.push(auto))
  assert(freeze.step(null, identityPose()) === false, 'first step frozen')
  assert(freeze.step(null, identityPose()) === true, 'second still step not frozen')
  assert(freeze.step(null, identityPose(1, 0, 0)) === false, 'moved pose still frozen')
  assert(calls.length === 2 && calls[0] === false && calls[1] === true, 'applyAutoUpdate calls ' + JSON.stringify(calls))
})

gate('createCullFreeze treats drift under 0.05 m as still and refuses 0.05 m', () => {
  const under = createCullFreeze(() => {})
  under.step(null, identityPose())
  assert(under.step(null, identityPose(0.04)) === true, 'drift of 0.04 m not still')
  const over = createCullFreeze(() => {})
  over.step(null, identityPose())
  assert(over.step(null, identityPose(0.05)) === false, 'move of exactly 0.05 m counted as still')
})

gate('createCullFreeze freezes on a 0.1 degree turn and refuses a 2 degree turn', () => {
  const small = createCullFreeze(() => {})
  small.step(null, identityPose())
  assert(small.step(null, yawPose(0.1)) === true, '0.1 degree turn not still')
  const large = createCullFreeze(() => {})
  large.step(null, identityPose())
  assert(large.step(null, yawPose(2)) === false, '2 degree turn counted as still')
})

gate('createCullFreeze never freezes while forceLive is set', () => {
  const live = createCullFreeze(() => {})
  live.step(null, identityPose(), true)
  assert(live.step(null, identityPose(), true) === false, 'forceLive froze the camera')
  const normal = createCullFreeze(() => {})
  normal.step(null, identityPose())
  assert(normal.step(null, identityPose()) === true, 'control without forceLive did not freeze')
})

gate('createCullFreeze reads the camera world matrix and quaternion when no pose is given', () => {
  const camera = {
    updateWorldMatrix() {},
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1] },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  }
  const freeze = createCullFreeze(() => {})
  freeze.step(camera)
  assert(freeze.step(camera) === true, 'static camera not frozen')
  camera.matrixWorld.elements[12] = 5
  assert(freeze.step(camera) === false, 'moved camera stayed frozen')
  assert(createCullFreeze(() => {}).step(null) === false, 'null camera and pose froze')
})

gate('createOcclusionPolicy hides only after two stable occluded resolves', () => {
  const policy = createOcclusionPolicy()
  const rec = {}
  assert(policy.advance(rec, 1, true).hidden === false, 'hidden after one resolve')
  assert(policy.advance(rec, 2, true).hidden === false, 'hidden after two resolves')
  const third = policy.advance(rec, 3, true)
  assert(third.hidden === true && third.flipped === true, 'not hidden after three resolves')
})

gate('createOcclusionPolicy honours a raised hideStreak', () => {
  const policy = createOcclusionPolicy({ hideStreak: 3 })
  const rec = {}
  for (let resolve = 1; resolve <= 3; resolve++) assert(policy.advance(rec, resolve, true).hidden === false, 'hidden at resolve ' + resolve)
  assert(policy.advance(rec, 4, true).hidden === true, 'not hidden at resolve 4')
})

gate('a hidden record stays hidden for 90 stale frames, then fails open', () => {
  const policy = createOcclusionPolicy()
  const rec = {}
  for (let resolve = 1; resolve <= 3; resolve++) policy.advance(rec, resolve, true)
  for (let frame = 1; frame <= 90; frame++) {
    const out = policy.advance(rec, 3, false)
    assert(out.hidden === true && out.failOpen === null, 'changed before frame 91 at frame ' + frame)
  }
  const expired = policy.advance(rec, 3, false)
  assert(expired.hidden === false && expired.failOpen === 'stale-resolve', 'no fail-open on frame 91')
})

gate('isAnomalousBatch needs 32 candidates and an occluded weight of at least 30 percent', () => {
  const policy = createOcclusionPolicy()
  assert(policy.isAnomalousBatch(40, 100, 30) === true, '30 percent of 40 candidates not anomalous')
  assert(policy.isAnomalousBatch(40, 100, 29) === false, '29 percent counted as anomalous')
  assert(policy.isAnomalousBatch(10, 100, 100) === false, 'batch under 32 candidates counted as anomalous')
})

gate('checkRebuildStaleness skips the query after 8 frames and fails open after 16 for a hidden record', () => {
  const policy = createOcclusionPolicy()
  const hidden = { hidden: true, streak: 2, unstreak: 0 }
  const at8 = { ...policy.checkRebuildStaleness(hidden, 8) }
  assert(at8.skipQuery === false && at8.failOpen === false, 'query skipped at 8 frames')
  const at9 = { ...policy.checkRebuildStaleness(hidden, 9) }
  assert(at9.skipQuery === true && at9.failOpen === false, 'query not skipped at 9 frames')
  const at17 = { ...policy.checkRebuildStaleness(hidden, 17) }
  assert(at17.skipQuery === true && at17.failOpen === true && hidden.hidden === false, 'no fail-open at 17 frames')
  const visible = { hidden: false }
  assert(policy.checkRebuildStaleness(visible, 17).failOpen === false, 'visible record failed open')
})

gate('eyeMovedPastExpiry uses the 3 m floor and the size multiplier', () => {
  const policy = createOcclusionPolicy()
  const rec = { eyeAtIssue: [0, 0, 0] }
  assert(policy.eyeMovedPastExpiry(rec, [3.1, 0, 0]) === true, '3.1 m not past the 3 m floor')
  assert(policy.eyeMovedPastExpiry(rec, [2.9, 0, 0]) === false, '2.9 m counted as past expiry')
  assert(policy.eyeMovedPastExpiry(rec, [5.9, 0, 0], 4) === false, '5.9 m counted past a size-4 expiry of 6 m')
  assert(policy.eyeMovedPastExpiry(rec, [6.1, 0, 0], 4) === true, '6.1 m not past a size-4 expiry of 6 m')
})

gate('checkEyeExpiry never expires a record while eye expiry is disabled, and does when enabled', () => {
  const disabled = createOcclusionPolicy()
  const off = { hidden: true, eyeAtIssue: [0, 0, 0] }
  assert(disabled.checkEyeExpiry(off, [100, 0, 0]) === false && off.hidden === true, 'disabled policy expired a record')
  const enabled = createOcclusionPolicy({ enableEyeExpiry: true })
  const on = { hidden: true, eyeAtIssue: [0, 0, 0] }
  assert(enabled.checkEyeExpiry(on, [100, 0, 0]) === true && on.hidden === false, 'enabled policy did not expire')
})

gate('resetRecord clears the hidden flag and the verdict history', () => {
  const policy = createOcclusionPolicy()
  const rec = {}
  for (let resolve = 1; resolve <= 3; resolve++) policy.advance(rec, resolve, true)
  assert(rec.hidden === true, 'setup did not hide the record')
  policy.resetRecord(rec)
  assert(rec.hidden === false && rec.lastVerdict === undefined && rec.streak === 0, 'record not reset')
})

gate('createOcclusionQueryBudget gives nothing below 6 ms and the maximum at 20 ms', () => {
  const budget = createOcclusionQueryBudget()
  budget.reportCandidates('a', 3)
  budget.reportFrameTime(5)
  let set = null
  assert(budget.apply('a', value => { set = value }) === 0 && set === 0, 'budget not zero at 5 ms')
  assert(budget.getStats().skipped === true, 'skipped flag not set at 5 ms')
  budget.reportFrameTime(20)
  assert(budget.apply('a') === 96, 'budget not 96 at 20 ms')
})

gate('createOcclusionQueryBudget interpolates linearly between the thresholds', () => {
  const budget = createOcclusionQueryBudget()
  budget.reportCandidates('a', 1)
  budget.reportFrameTime(13)
  assert(budget.apply('a') === 60 && budget.getStats().totalBudget === 60, 'budget at 13 ms is not 60')
  budget.reportFrameTime(6)
  assert(budget.apply('a') === 24 && budget.getStats().totalBudget === 24, 'budget at 6 ms is not 24')
})

gate('createOcclusionQueryBudget splits the remaining budget by candidate share', () => {
  const budget = createOcclusionQueryBudget()
  budget.reportCandidates('a', 3)
  budget.reportCandidates('b', 1)
  budget.reportFrameTime(20)
  const allocA = budget.apply('a')
  const allocB = budget.apply('b')
  assert(allocA === 70 && allocB === 26, `split is ${allocA} and ${allocB}, expected 70 and 26`)
  assert(budget.getStats().sumAllocated === 96, 'allocations do not sum to the total')
})

gate('createOcclusionQueryBudget gives only the per-consumer floor when no one has candidates', () => {
  const budget = createOcclusionQueryBudget()
  budget.reportCandidates('a', 0)
  budget.reportFrameTime(20)
  assert(budget.apply('a') === 4, 'zero-candidate consumer did not get the floor of 4')
})

gate('reportCandidates clamps invalid counts to zero and unregister removes a consumer', () => {
  const budget = createOcclusionQueryBudget()
  budget.reportCandidates('a', NaN)
  budget.reportCandidates('b', -3)
  const stats = budget.getStats()
  assert(stats.consumers.a.candidates === 0 && stats.consumers.b.candidates === 0, 'invalid count kept')
  budget.reportCandidates('a', 5)
  assert(budget.getStats().consumers.a.candidates === 5, 'valid count not kept')
  budget.unregister('a')
  assert(!('a' in budget.getStats().consumers), 'consumer not removed')
})

gate('parsePostFxLook accepts in-range operators and returns a frozen copy', () => {
  const look = parsePostFxLook({ exposure: 1.5, bloom: 0.2 })
  assert(look.exposure === 1.5 && look.bloom === 0.2, 'values lost')
  assert(Object.isFrozen(look), 'look not frozen')
  try {
    look.exposure = 9
  } catch {}
  assert(look.exposure === 1.5, 'frozen look was mutated')
})

gate('parsePostFxLook refuses unknown operators, out-of-range values and non-objects', () => {
  assert(refusedWith(() => parsePostFxLook({ bogus: 1 }), 'operator-unknown'), 'unknown operator accepted')
  assert(refusedWith(() => parsePostFxLook({ exposure: 5 }), 'operator-range'), 'exposure 5 accepted')
  assert(refusedWith(() => parsePostFxLook({ vignette: NaN }), 'operator-range'), 'NaN vignette accepted')
  assert(refusedWith(() => parsePostFxLook({ chromaticAberration: 0.06 }), 'operator-range'), 'chromatic aberration 0.06 accepted')
  assert(refusedWith(() => parsePostFxLook(null), 'look-invalid'), 'null look accepted')
  assert(refusedWith(() => parsePostFxLook([]), 'look-invalid'), 'array look accepted')
  assert(parsePostFxLook({ chromaticAberration: 0.05 }).chromaticAberration === 0.05, 'upper bound 0.05 refused')
  assert(new PostFxLookError('x', 'y') instanceof Error, 'error class is not an Error')
})

gate('applyLook with no operators returns the input clamped to [0, 1]', () => {
  const same = applyLook({}, [0.2, 0.5, 0.9])
  assert(same.every((c, i) => Math.abs(c - [0.2, 0.5, 0.9][i]) < 1e-12), 'identity look changed the colour')
  const clamped = applyLook({}, [1.5, -0.2, 0.5])
  assert(clamped[0] === 1 && clamped[1] === 0 && Math.abs(clamped[2] - 0.5) < 1e-12, 'clamp wrong: ' + clamped.join(','))
  assert(applyLook({ saturation: 0 }, [0.2, 0.5, 0.9])[0] !== same[0], 'saturation 0 did not change the colour')
})

gate('applyLook with saturation 0 collapses every channel to the Rec. 709 luma', () => {
  const luma = 0.2126 * 0.2 + 0.7152 * 0.5 + 0.0722 * 0.9
  const grey = applyLook({ saturation: 0 }, [0.2, 0.5, 0.9])
  grey.forEach((c, i) => close(c, luma, 'channel ' + i, 1e-12))
  const coloured = applyLook({ saturation: 1 }, [0.2, 0.5, 0.9])
  assert(Math.abs(coloured[0] - coloured[2]) > 0.1, 'saturation 1 collapsed the channels')
})

gate('applyLook exposure 2 doubles a 0.3 channel to 0.6 and exposure 1 leaves it at 0.3', () => {
  close(applyLook({ exposure: 2 }, [0.3, 0.3, 0.3])[0], 0.6, 'exposure 2', 1e-12)
  close(applyLook({ exposure: 1 }, [0.3, 0.3, 0.3])[0], 0.3, 'exposure 1', 1e-12)
})

gate('applyLook vignette leaves the centre alone and darkens the corner by the full amount', () => {
  const centre = applyLook({ vignette: 1 }, [0.5, 0.5, 0.5])
  centre.forEach((c, i) => close(c, 0.5, 'centre channel ' + i, 1e-12))
  const corner = applyLook({ vignette: 1 }, [0.5, 0.5, 0.5], [0, 0])
  assert(corner.every(c => c === 0), 'corner not darkened to zero: ' + corner.join(','))
})

gate('lookPasses lists defined operators in operator order and freezes each entry', () => {
  const passes = lookPasses({ bloom: 0.2, exposure: 1 })
  assert(passes.map(p => p.op).join(',') === 'exposure,bloom', 'order is ' + passes.map(p => p.op).join(','))
  assert(passes.every(p => Object.isFrozen(p)), 'entry not frozen')
  assert(lookPasses({}).length === 0, 'empty look produced passes')
  assert(refusedWith(() => lookPasses(null), 'look-invalid'), 'null look accepted')
})

gate('postfxLookNode runs only when a look is present and writes the passes into the context', () => {
  const node = postfxLookNode()
  assert(node.shouldRun({ postfxLook: null }) === false, 'ran with null look')
  assert(node.shouldRun({}) === false, 'ran with missing look')
  assert(node.shouldRun({ postfxLook: { bloom: 0.2 } }) === true, 'did not run with a look')
  const ctx = { postfxLook: { bloom: 0.2 }, res: {} }
  node.run(ctx)
  assert(ctx.res.postfxPasses.length === 1 && ctx.res.postfxPasses[0].op === 'bloom', 'passes not written')
})

gate('nameToCode maps known names including neutral 0 and refuses an unknown name', () => {
  assert(nameToCode('neutral') === EXPR_NEUTRAL, 'neutral is not 0')
  assert(nameToCode('joy') === EXPR_HAPPY, 'joy is not happy')
  assert(nameToCode('blink') === EXPR_BLINK, 'blink code wrong')
  assert(nameToCode('nope') === null, 'unknown name mapped to a code')
})

gate('pickExpressionCode prefers the strongest viseme and honours the 0.35 threshold', () => {
  const manager = values => ({ getValue: name => values[name] ?? 0 })
  assert(pickExpressionCode(manager({ aa: 0.5, happy: 0.9 })) === EXPR_AA, 'viseme did not win over emotion')
  assert(pickExpressionCode(manager({ happy: 0.9 })) === EXPR_HAPPY, 'lone emotion not chosen')
  assert(pickExpressionCode(manager({ aa: 0.35 })) === EXPR_AA, 'threshold 0.35 refused')
  assert(pickExpressionCode(manager({ aa: 0.34 })) === EXPR_NEUTRAL, '0.34 counted above threshold')
  assert(pickExpressionCode(manager({ ih: 0.6, aa: 0.5 })) === EXPR_IH, 'stronger viseme did not win')
})

gate('pickExpressionCode returns neutral for a missing manager and skips names that throw', () => {
  assert(pickExpressionCode(null) === EXPR_NEUTRAL, 'null manager not neutral')
  assert(pickExpressionCode({}) === EXPR_NEUTRAL, 'manager without getValue not neutral')
  const throwing = { getValue: name => { if (name !== 'happy') throw new Error('boom'); return 0.5 } }
  assert(pickExpressionCode(throwing) === EXPR_HAPPY, 'throwing names were not skipped')
})

gate('applyExpressionCode resets the previous name before setting the new one', () => {
  const calls = []
  const set = (...args) => calls.push(args)
  applyExpressionCode(set, 'p', EXPR_AA, EXPR_HAPPY)
  assert(JSON.stringify(calls) === JSON.stringify([['p', 'happy', 0], ['p', 'aa', 1]]), 'calls ' + JSON.stringify(calls))
  calls.length = 0
  applyExpressionCode(set, 'p', EXPR_HAPPY, EXPR_HAPPY)
  assert(JSON.stringify(calls) === JSON.stringify([['p', 'happy', 1]]), 'same code reset the previous name: ' + JSON.stringify(calls))
  calls.length = 0
  applyExpressionCode(set, 'p', EXPR_NEUTRAL, EXPR_HAPPY)
  assert(JSON.stringify(calls) === JSON.stringify([['p', 'happy', 0]]), 'neutral set a name: ' + JSON.stringify(calls))
})

gate('parseTreeTextureMaxPx accepts powers of two in range and null, and refuses bad values', () => {
  assert(parseTreeTextureMaxPx(64, 'x') === 64, '64 refused')
  assert(parseTreeTextureMaxPx('256', 'x') === 256, 'numeric string refused')
  assert(parseTreeTextureMaxPx(1024, 'x') === 1024, '1024 refused')
  assert(parseTreeTextureMaxPx(null, 'x') === null && parseTreeTextureMaxPx(undefined, 'x') === null, 'absent value not null')
  assert(refusedWith(() => parseTreeTextureMaxPx('', 'x'), 'empty-value'), 'empty string accepted')
  assert(refusedWith(() => parseTreeTextureMaxPx('abc', 'x'), 'not-a-number'), 'text accepted')
  assert(refusedWith(() => parseTreeTextureMaxPx({}, 'x'), 'not-a-number'), 'object accepted')
  assert(refusedWith(() => parseTreeTextureMaxPx(128.5, 'x'), 'not-an-integer'), 'fraction accepted')
  assert(refusedWith(() => parseTreeTextureMaxPx(100, 'x'), 'not-a-power-of-two'), '100 accepted')
  assert(refusedWith(() => parseTreeTextureMaxPx(32, 'x'), 'below-minimum'), '32 accepted')
  assert(refusedWith(() => parseTreeTextureMaxPx(2048, 'x'), 'above-maximum'), '2048 accepted')
  assert(new TreeTextureBudgetError('a', 'b') instanceof Error, 'error class is not an Error')
})

gate('treeTextureQueryValue reads one key and refuses a non-string search', () => {
  assert(treeTextureQueryValue('?leaftex=256&barktex=64', 'barktex') === '64', 'barktex not read')
  assert(treeTextureQueryValue('', 'leaftex') === null, 'empty search not null')
  assert(treeTextureQueryValue('?x=1', 'leaftex') === null, 'absent key not null')
  assert(refusedWith(() => treeTextureQueryValue(5, 'leaftex'), 'search-not-a-string'), 'non-string search accepted')
})

gate('resolveTreeTextureBudget uses defaults, then config, then a valid URL override', () => {
  const defaults = resolveTreeTextureBudget({})
  assert(defaults.leafMaxPx === 128 && defaults.barkMaxPx === 64 && defaults.sourcePx === 1024, 'defaults wrong')
  assert(resolveTreeTextureBudget({ cfg: { leafTextureMaxPx: 512 } }).leafMaxPx === 512, 'config not used')
  assert(resolveTreeTextureBudget({ search: '?leaftex=256', cfg: { leafTextureMaxPx: 512 } }).leafMaxPx === 256, 'URL did not override config')
  assert(refusedWith(() => resolveTreeTextureBudget({ search: '?leaftex=abc' }), 'not-a-number'), 'invalid URL fell back instead of refusing')
  assert(refusedWith(() => resolveTreeTextureBudget({ cfg: 5 }), 'cfg-not-an-object'), 'non-object cfg accepted')
})

gate('halvingsFor counts halvings down to the target and stops at the limit of 16', () => {
  assert(halvingsFor(1024, 64) === 4, '1024 to 64 is not 4 halvings')
  assert(halvingsFor(64, 64) === 0, 'no-op halving not 0')
  assert(halvingsFor(2 ** 30, 64) === 16, 'limit of 16 not reached')
  assert(refusedWith(() => halvingsFor(0, 64), 'not-a-texture-width'), 'zero width accepted')
  assert(refusedWith(() => halvingsFor(256, 100), 'not-a-power-of-two'), 'non-power target accepted')
})

gate('decodedRgbaBytes and mipChainBytes count four bytes per texel down the chain', () => {
  assert(decodedRgbaBytes(4, 4) === 64, 'decoded 4x4 not 64')
  assert(mipChainBytes(4, 4) === 84, 'mip chain 4x4 not 84')
  assert(mipChainBytes(1, 1) === 4, 'mip chain 1x1 not 4')
  assert(mipChainBytes(4, 4) !== decodedRgbaBytes(4, 4), 'chain counted as a single level')
})

gate('createFloatingOrigin refuses a rebase under 8000 m and takes one at exactly 8000 m', () => {
  const scene = { children: [] }
  const camera = { position: vec() }
  scene.children.push(camera)
  const origin = createFloatingOrigin(scene, camera)
  assert(origin.update(0, 0, 0) === false, 'first update rebased')
  assert(origin.update(7999, 0, 0) === false && origin.getRebaseCount() === 0, 'rebased under threshold')
  assert(origin.update(REBASE_THRESHOLD_M, 0, 0) === true && origin.getRebaseCount() === 1, 'no rebase at threshold')
})

gate('createFloatingOrigin does not rebase on the first update even when far from the origin', () => {
  const scene = { children: [] }
  const camera = { position: vec() }
  scene.children.push(camera)
  const origin = createFloatingOrigin(scene, camera)
  assert(origin.update(50000, 0, 0) === false, 'first far update rebased')
  assert(origin.getShift().x === 0, 'shift moved on first update')
})

gate('a rebase keeps every child at the same authoritative position and moves it in render space', () => {
  const camera = { position: vec() }
  const child = { position: { x: 10, y: -2, z: 3 } }
  const scene = { children: [camera, child] }
  const origin = createFloatingOrigin(scene, camera)
  origin.update(0, 0, 0)
  const before = origin.toAuthoritative(child.position)
  origin.update(8000, 0, 0)
  const after = origin.toAuthoritative(child.position)
  assert(Math.abs(after.x - before.x) < 1e-9 && after.y === before.y && after.z === before.z, 'authoritative position changed across rebase')
  assert(child.position.x === -7990, 'child render x is ' + child.position.x + ', expected -7990')
  assert(camera.position.x === 0 && camera.position.y === 0 && camera.position.z === 0, 'camera moved')
  assert(origin.getLastDelta().x === -8000 && origin.getShift().x === 8000, 'delta or shift wrong')
})

gate('toRender inverts toAuthoritative, and an unsubscribed listener is no longer called', () => {
  const camera = { position: vec() }
  const scene = { children: [camera] }
  const origin = createFloatingOrigin(scene, camera)
  origin.update(0, 0, 0)
  assert(origin.toRender({ x: 8010, y: 0, z: 0 }).x === 8010, 'render at shift 0 is wrong')
  const seen = []
  const unsubscribe = origin.onRebase((dx, dy, dz, shift) => seen.push([dx, dy, dz, shift.x]))
  origin.update(8000, 0, 0)
  assert(seen.length === 1 && seen[0][0] === -8000 && seen[0][3] === 8000, 'listener args ' + JSON.stringify(seen))
  assert(origin.toRender({ x: 8010, y: 0, z: 0 }).x === 10, 'render after rebase is wrong')
  unsubscribe()
  origin.update(16000, 0, 0)
  assert(seen.length === 1 && origin.getRebaseCount() === 2, 'unsubscribed listener still called')
})

gate('grassWindGust at the origin at time zero is exactly (0, 0, 1) and fills the given array', () => {
  const out = [9, 9, 9]
  const result = grassWindGust(out, 0, 0, 0, 1, 0)
  assert(result === out, 'did not return the given array')
  assert(out[0] === 0 && out[1] === 0 && out[2] === 1, 'origin value is ' + out.join(','))
})

gate('grassWindGust is deterministic, bounded, and changes with time and with position', () => {
  const a = grassWindGust([0, 0, 0], 3.5, -7.25, 1.5, 0.6, 0.8)
  const b = grassWindGust([0, 0, 0], 3.5, -7.25, 1.5, 0.6, 0.8)
  assert(a.every((v, i) => v === b[i]), 'same inputs gave different outputs')
  assert(Math.abs(a[1]) <= 1 && Math.abs(a[2]) <= 1 && Math.abs(a[0]) <= 1.5, 'output out of bounds: ' + a.join(','))
  const later = grassWindGust([0, 0, 0], 3.5, -7.25, 2.5, 0.6, 0.8)
  assert(later[1] !== a[1] || later[2] !== a[2], 'output did not change with time')
  const moved = grassWindGust([0, 0, 0], 40, 12, 1.5, 0.6, 0.8)
  assert(moved[0] !== a[0] || moved[1] !== a[1], 'output did not change with position')
})

gate('grassWindGust uses the injected math object for its trigonometry', () => {
  const flat = { sin: () => 0, cos: () => 1 }
  const out = grassWindGust([0, 0, 0], 0, 0, 1, 1, 0, flat)
  assert(out[0] === 0 && out[1] === 0 && out[2] === 1, 'injected math not used')
  const real = grassWindGust([0, 0, 0], 0, 0, 1, 1, 0)
  assert(real[1] !== 0, 'real math gave the flat result at t=1')
})

finish()
