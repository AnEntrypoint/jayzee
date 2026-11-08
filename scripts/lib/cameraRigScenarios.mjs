import { attempt, scenarioDifference } from './scenarioTrace.mjs'

export const POSE_A = { position: [1, 0, 2], yaw: 0.3 }
export const POSE_B = { position: [-4, 1.5, 7], yaw: -2.1 }
const CUT_FRAMES = [
  { t: 0, position: [0, 0, 0], target: [0, 0, -1] },
  { t: 1, position: [10, 0, 0], target: [0, 0, -1] },
  { t: 3, position: [10, 5, 0], target: [0, 1, 0] },
]
const ORBIT = { layers: [{ id: 'orbit', kind: 'orbit' }] }

export function fakeCameraHost() {
  const host = { position: null, target: null, layer: null, done: null, applied: 0 }
  return {
    apply(out) {
      host.position = [...out.position]
      host.target = [...out.target]
      host.layer = out.layer
      host.done = out.done
      host.applied += 1
      return { position: [...host.position], target: [...host.target], layer: host.layer, done: host.done, applied: host.applied }
    },
  }
}

export function runCameraRigScenarios(defineCameraRig) {
  const S = (name, spec, body) => {
    const camera = fakeCameraHost()
    const trace = []
    const t = (label, fn) => trace.push({ label, ...attempt(fn) })
    let rig = null
    try {
      rig = defineCameraRig(spec)
    } catch (error) {
      return { name, build: { ok: false, name: error.name, message: error.message, reasonCode: error.reasonCode ?? null }, trace }
    }
    body(rig, camera, t)
    return { name, build: { ok: true }, trace }
  }
  return [
    S('orbit', ORBIT, (rig, cam, t) => {
      t('look', () => rig.onInput('p1', { lookX: 120, lookY: -40 }))
      t('update-a', () => cam.apply(rig.update('p1', POSE_A, 0.016)))
      t('pitch-clamp', () => rig.onInput('p1', { lookY: 5000 }))
      t('update-b', () => cam.apply(rig.update('p1', POSE_B, 0.02)))
      t('input-omitted', () => rig.onInput('p1'))
      t('input-null', () => rig.onInput('p1', null))
      t('top', () => rig.top('p1'))
      t('other-player-top', () => rig.top('p2'))
      t('layer-ids', () => rig.layerIds())
      t('remove', () => rig.remove('p1'))
      t('top-after-remove', () => rig.top('p1'))
    }),
    S('orbit-defaults', { layers: [{ id: 'o', kind: 'orbit', distance: 'far' }] }, (rig, cam, t) => {
      t('update', () => cam.apply(rig.update('p', POSE_A, 0)))
      t('look-nan', () => rig.onInput('p', { lookX: NaN, lookY: NaN }))
    }),
    S('chase', { layers: [{ id: 'chase', kind: 'chase', distance: 6, height: 3, targetHeight: 1 }] }, (rig, cam, t) => {
      t('update-a', () => cam.apply(rig.update('p', POSE_A, 0.1)))
      t('update-b', () => cam.apply(rig.update('p', POSE_B, 0.1)))
      t('input-no-handler', () => rig.onInput('p', { lookX: 1 }))
    }),
    S('chase-defaults', { layers: [{ id: 'chase', kind: 'chase' }] }, (rig, cam, t) => {
      t('update', () => cam.apply(rig.update('p', POSE_B, 0.1)))
    }),
    S('first-person', { layers: [{ id: 'fp', kind: 'firstPerson', eyeHeight: 1.7, sensitivity: 0.01, maxPitch: 0.5 }] }, (rig, cam, t) => {
      t('look', () => rig.onInput('p', { lookX: 300, lookY: 200 }))
      t('update-a', () => cam.apply(rig.update('p', POSE_A, 0.1)))
      t('look-back', () => rig.onInput('p', { lookX: -90, lookY: -700 }))
      t('update-b', () => cam.apply(rig.update('p', POSE_B, 0.1)))
    }),
    S('cutscene', { layers: [{ id: 'cut', kind: 'cutscene', frames: CUT_FRAMES }] }, (rig, cam, t) => {
      for (let i = 0; i < 8; i++) t('tick-' + i, () => cam.apply(rig.update('p', POSE_A, 0.5)))
    }),
    S('cutscene-loop', { layers: [{ id: 'cut', kind: 'cutscene', loop: true, frames: CUT_FRAMES }] }, (rig, cam, t) => {
      for (let i = 0; i < 4; i++) t('tick-' + i, () => cam.apply(rig.update('p', POSE_B, 1.7)))
    }),
    S('custom', { layers: [{ id: 'c', kind: 'custom', init: () => ({ n: 0 }), update(state, pose, dt) { state.n += 1; return { position: [state.n, pose.position[1], dt], target: [0, 0, 0], done: state.n > 2 } }, onInput(state, input) { state.n += input.k || 0; return input.k === 5 } }] }, (rig, cam, t) => {
      t('update-1', () => cam.apply(rig.update('p', POSE_A, 0.5)))
      t('input-5', () => rig.onInput('p', { k: 5 }))
      t('update-2', () => cam.apply(rig.update('p', POSE_B, 0.25)))
      t('update-3', () => cam.apply(rig.update('p', POSE_B, 0.25)))
    }),
    S('custom-defaults', { layers: [{ id: 'c', kind: 'custom', update: () => ({ position: [1, 2, 3], target: [4, 5, 6] }) }] }, (rig, cam, t) => {
      t('input-no-handler', () => rig.onInput('p', { k: 5 }))
      t('update', () => cam.apply(rig.update('p', POSE_A, 0)))
    }),
    S('defaults-first-layer', { layers: [{ id: 'a', kind: 'orbit' }, { id: 'b', kind: 'chase' }] }, (rig, cam, t) => {
      t('top', () => rig.top('p'))
      t('layer-ids', () => rig.layerIds())
    }),
    S('stack', { default: 'base', layers: [{ id: 'base', kind: 'orbit' }, { id: 'top', kind: 'chase', priority: 5 }, { id: 'mid', kind: 'firstPerson', priority: 5 }] }, (rig, cam, t) => {
      t('before-push', () => rig.top('p'))
      t('push-top', () => rig.push('p', 'top'))
      t('top-after-push', () => rig.top('p'))
      t('update-top', () => cam.apply(rig.update('p', POSE_A, 0.1)))
      t('push-mid', () => rig.push('p', 'mid'))
      t('top-after-mid', () => rig.top('p'))
      t('input-mid', () => rig.onInput('p', { lookX: 50, lookY: 10 }))
      t('pop-top', () => rig.pop('p', 'top'))
      t('top-after-pop', () => rig.top('p'))
      t('pop-default-noop', () => rig.pop('p', 'base'))
      t('top-after-default-pop', () => rig.top('p'))
      t('update-mid', () => cam.apply(rig.update('p', POSE_B, 0.1)))
      t('push-unknown', () => rig.push('p', 'zz'))
    }),
    S('refuse-null-spec', null, () => {}),
    S('refuse-array-spec', [], () => {}),
    S('refuse-no-layers', {}, () => {}),
    S('refuse-empty-layers', { layers: [] }, () => {}),
    S('refuse-layer-not-object', { layers: [null] }, () => {}),
    S('refuse-layer-no-id', { layers: [{ kind: 'orbit' }] }, () => {}),
    S('refuse-layer-unknown-kind', { layers: [{ id: 'a', kind: 'dolly' }] }, () => {}),
    S('refuse-duplicate-id', { layers: [{ id: 'a', kind: 'orbit' }, { id: 'a', kind: 'chase' }] }, () => {}),
    S('refuse-default-unknown', { default: 'zz', layers: [{ id: 'a', kind: 'orbit' }] }, () => {}),
    S('refuse-cutscene-no-frames', { layers: [{ id: 'c', kind: 'cutscene' }] }, () => {}),
    S('refuse-cutscene-bad-frame', { layers: [{ id: 'c', kind: 'cutscene', frames: [{ t: 'x', position: [0, 0, 0], target: [0, 0, 0] }] }] }, () => {}),
    S('refuse-cutscene-unsorted', { layers: [{ id: 'c', kind: 'cutscene', frames: [{ t: 2, position: [0, 0, 0], target: [0, 0, 0] }, { t: 1, position: [0, 0, 0], target: [0, 0, 0] }] }] }, () => {}),
    S('refuse-custom-no-update', { layers: [{ id: 'c', kind: 'custom' }] }, () => {}),
    S('refuse-bad-pose', ORBIT, (rig, cam, t) => {
      t('no-yaw', () => rig.update('p', { position: [0, 0, 0] }, 0.1))
      t('short-position', () => rig.update('p', { position: [0, 0], yaw: 0 }, 0.1))
      t('nan-yaw', () => rig.update('p', { position: [0, 0, 0], yaw: NaN }, 0.1))
    }),
    S('refuse-bad-dt', ORBIT, (rig, cam, t) => {
      t('negative', () => rig.update('p', POSE_A, -1))
      t('nan', () => rig.update('p', POSE_A, NaN))
    }),
    S('refuse-camera-invalid', { layers: [{ id: 'c', kind: 'custom', update: () => ({ position: [NaN, 0, 0], target: [0, 0, 0] }) }] }, (rig, cam, t) => {
      t('update', () => rig.update('p', POSE_A, 0.1))
    }),
    S('refuse-push-unknown', ORBIT, (rig, cam, t) => {
      t('push', () => rig.push('p', 'zz'))
    }),
  ]
}

export function compareCameraRig(fixture, scenarios) {
  const byName = new Map(scenarios.map((s) => [s.name, s]))
  return fixture.scenarios.map((expected) => ({ name: expected.name, difference: byName.has(expected.name) ? scenarioDifference(expected, JSON.parse(JSON.stringify(byName.get(expected.name)))) : 'missing scenario' }))
}
