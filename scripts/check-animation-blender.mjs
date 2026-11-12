import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AnimationClip, AnimationMixer, Object3D, VectorKeyframeTrack } from 'three'
import { gate, finish } from './lib/gate.mjs'
import { AnimationBlender, AnimationBlenderError, BLENDER_REFUSAL } from '../src/animation/animationBlender.js'
import { BlendTree1D, BlendTree2D } from '../src/animation/blendTree.js'

const holdClip = (name, x, duration = 1) => new AnimationClip(name, duration, [
  new VectorKeyframeTrack('.position', [0, duration], [x, 0, 0, x, 0, 0]),
])

const rampClip = (name, from, to, duration) => new AnimationClip(name, duration, [
  new VectorKeyframeTrack('.position', [0, duration], [from, 0, 0, to, 0, 0]),
])

const rig = (options) => {
  const root = new Object3D()
  const mixer = new AnimationMixer(root)
  const blender = new AnimationBlender(mixer, options)
  return { root, mixer, blender }
}

const near = (actual, expected, tolerance, what) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, what + ': expected ' + expected + ', got ' + actual)
}

const codeOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error instanceof AnimationBlenderError ? error.code : 'other: ' + error.message
  }
  return 'no refusal'
}

gate('a single clip played through a three 0.185 mixer drives the bound object to the clip value', () => {
  const { root, blender } = rig()
  blender.addClip('idle', holdClip('idle', 10))
  blender.play('idle', 0).update(0.1)
  near(root.position.x, 10, 1e-9, 'position.x')
  assert.equal(blender.isPlaying('idle'), true)
  assert.equal(blender.current, 'idle')
})

gate('a crossfade of 0.4 s is half way after 0.2 s: both actions weigh 0.5 and the object sits at the midpoint 15', () => {
  const { root, blender } = rig()
  blender.addClip('idle', holdClip('idle', 10)).addClip('run', holdClip('run', 20))
  blender.play('idle', 0).update(0.1)
  blender.play('run', 0.4).update(0.2)
  near(blender.weightOf('idle'), 0.5, 1e-9, 'idle weight')
  near(blender.weightOf('run'), 0.5, 1e-9, 'run weight')
  near(root.position.x, 15, 1e-9, 'position.x')
})

gate('after the crossfade ends the old action is no longer running in three and the object holds the new clip value', () => {
  const { root, blender } = rig()
  blender.addClip('idle', holdClip('idle', 10)).addClip('run', holdClip('run', 20))
  blender.play('idle', 0).update(0.1)
  blender.play('run', 0.4)
  for (let i = 0; i < 5; i++) blender.update(0.1)
  assert.equal(blender.isPlaying('idle'), false)
  assert.equal(blender.entries.get('idle').action.isRunning(), false)
  assert.equal(blender.isPlaying('run'), true)
  near(root.position.x, 20, 1e-9, 'position.x')
})

gate('playing the clip that is already current does not restart it: its action time keeps advancing', () => {
  const { blender } = rig()
  blender.addClip('walk', rampClip('walk', 0, 4, 2))
  blender.play('walk', 0).update(0.5)
  blender.play('walk', 0).update(0.25)
  near(blender.entries.get('walk').action.time, 0.75, 1e-9, 'action time')
})

gate('a 1D blend tree at parameter 0.75 gives weights 0.25 and 0.75 and the object sits at 17.5', () => {
  const { root, blender } = rig()
  blender.addClip('walk', holdClip('walk', 10)).addClip('run', holdClip('run', 20))
  const tree = new BlendTree1D().addClip('walk', 0).addClip('run', 1).setParameter(0.75)
  blender.playTree(tree, { fade: 0 }).update(0.1)
  near(blender.weightOf('walk'), 0.25, 1e-9, 'walk weight')
  near(blender.weightOf('run'), 0.75, 1e-9, 'run weight')
  near(root.position.x, 17.5, 1e-9, 'position.x')
})

gate('moving the tree parameter moves the three weights on the next update with no second playTree call', () => {
  const { root, blender } = rig()
  blender.addClip('walk', holdClip('walk', 10)).addClip('run', holdClip('run', 20))
  const tree = new BlendTree1D().addClip('walk', 0).addClip('run', 1).setParameter(0)
  blender.playTree(tree, { fade: 0 }).update(0.1)
  near(root.position.x, 10, 1e-9, 'position.x at 0')
  tree.setParameter(1)
  blender.update(0.1)
  near(root.position.x, 20, 1e-9, 'position.x at 1')
})

gate('a 2D blend tree drives three actions whose three weights sum to 1 and match the tree', () => {
  const { root, blender } = rig()
  blender.addClip('a', holdClip('a', 3)).addClip('b', holdClip('b', 6)).addClip('c', holdClip('c', 12))
  const tree = new BlendTree2D().addClip('a', 0, 0).addClip('b', 1, 0).addClip('c', 0, 1).setParameter(0.25, 0.5)
  blender.playTree(tree, { fade: 0 }).update(0.05)
  const weights = tree.getWeights()
  const total = weights[0] + weights[1] + weights[2]
  near(blender.weightOf('a') + blender.weightOf('b') + blender.weightOf('c'), 1, 1e-9, 'weight sum')
  near(root.position.x, (3 * weights[0] + 6 * weights[1] + 12 * weights[2]) / total, 1e-9, 'position.x')
})

gate('with sync on, a 1 s and a 2 s clip keep the same normalised phase while they blend', () => {
  const { blender } = rig()
  blender.addClip('short', rampClip('short', 0, 1, 1)).addClip('long', rampClip('long', 0, 1, 2))
  const tree = new BlendTree1D().addClip('short', 0).addClip('long', 1).setParameter(0.5)
  blender.playTree(tree, { fade: 0 })
  for (let i = 0; i < 7; i++) blender.update(0.1)
  const short = blender.entries.get('short').action
  const long = blender.entries.get('long').action
  near(short.time / 1, long.time / 2, 1e-9, 'phase')
  near(short.time / 1, 0.7 / 1.5, 1e-9, 'phase against the blended 1.5 s cycle')
})

gate('negative control: with sync off the same two clips drift apart in phase', () => {
  const { blender } = rig()
  blender.addClip('short', rampClip('short', 0, 1, 1)).addClip('long', rampClip('long', 0, 1, 2))
  const tree = new BlendTree1D().addClip('short', 0).addClip('long', 1).setParameter(0.5)
  blender.playTree(tree, { fade: 0, sync: false })
  for (let i = 0; i < 7; i++) blender.update(0.1)
  const drift = Math.abs(blender.entries.get('short').action.time / 1 - blender.entries.get('long').action.time / 2)
  assert.ok(drift > 0.3, 'phase drift ' + drift)
})

gate('negative control: weights that are swapped before they reach three move the object away from 17.5', () => {
  const { root, blender } = rig()
  blender.addClip('walk', holdClip('walk', 10)).addClip('run', holdClip('run', 20))
  const tree = new BlendTree1D().addClip('walk', 0).addClip('run', 1).setParameter(0.75)
  const swapped = { clips: tree.clips, getWeight: (index) => tree.getWeight(1 - index) }
  blender.playTree(swapped, { fade: 0 }).update(0.1)
  near(root.position.x, 12.5, 1e-9, 'position.x')
})

gate('leaving a tree for a single clip fades the tree members out and the clip in', () => {
  const { root, blender } = rig()
  blender.addClip('walk', holdClip('walk', 10)).addClip('run', holdClip('run', 20)).addClip('jump', holdClip('jump', 40))
  const tree = new BlendTree1D().addClip('walk', 0).addClip('run', 1).setParameter(0.5)
  blender.playTree(tree, { fade: 0 }).update(0.1)
  blender.play('jump', 0.2)
  for (let i = 0; i < 3; i++) blender.update(0.1)
  near(root.position.x, 40, 1e-9, 'position.x')
  assert.equal(blender.isPlaying('walk'), false)
  assert.equal(blender.isPlaying('run'), false)
  assert.equal(blender.tree, null)
})

gate('a clip added with loop false plays once and clamps on its last frame', () => {
  const { root, blender } = rig()
  blender.addClip('hit', rampClip('hit', 0, 8, 1), { loop: false })
  blender.play('hit', 0)
  for (let i = 0; i < 20; i++) blender.update(0.1)
  near(root.position.x, 8, 1e-9, 'position.x')
})

gate('a time scale of 2 advances the action twice as fast, and setTimeScale changes it while playing', () => {
  const { blender } = rig()
  blender.addClip('walk', rampClip('walk', 0, 4, 10), { timeScale: 2 })
  blender.play('walk', 0).update(0.5)
  near(blender.entries.get('walk').action.time, 1, 1e-9, 'time at scale 2')
  blender.setTimeScale('walk', 0.5).update(1)
  near(blender.entries.get('walk').action.time, 1.5, 1e-9, 'time at scale 0.5')
})

gate('stop with no name stops every action and the object keeps no clip running', () => {
  const { blender } = rig()
  blender.addClip('idle', holdClip('idle', 10)).addClip('run', holdClip('run', 20))
  blender.play('idle', 0).update(0.1)
  blender.stop()
  assert.equal(blender.isPlaying('idle'), false)
  assert.equal(blender.current, null)
})

gate('refusals name the cause: no mixer, a null clip, a duplicate name, an unknown name, a bad fade, a bad tree', () => {
  assert.equal(codeOf(() => new AnimationBlender({})), BLENDER_REFUSAL.MIXER)
  const { blender } = rig()
  blender.addClip('idle', holdClip('idle', 10))
  assert.equal(codeOf(() => blender.addClip('x', null)), BLENDER_REFUSAL.CLIP)
  assert.equal(codeOf(() => blender.addClip('idle', holdClip('idle', 1))), BLENDER_REFUSAL.DUPLICATE)
  assert.equal(codeOf(() => blender.play('missing')), BLENDER_REFUSAL.UNKNOWN)
  assert.equal(codeOf(() => blender.play('idle', -1)), BLENDER_REFUSAL.NUMBER)
  assert.equal(codeOf(() => blender.update(NaN)), BLENDER_REFUSAL.NUMBER)
  assert.equal(codeOf(() => blender.playTree({ clips: [] , getWeight: () => 0 })), BLENDER_REFUSAL.TREE)
  assert.equal(codeOf(() => blender.playTree(new BlendTree1D().addClip('idle', 0).addClip('idle', 1))), BLENDER_REFUSAL.TREE)
  assert.equal(codeOf(() => blender.playTree(new BlendTree1D().addClip('nope', 0))), BLENDER_REFUSAL.UNKNOWN)
})

gate('a refused tree leaves the playing clip untouched', () => {
  const { root, blender } = rig()
  blender.addClip('idle', holdClip('idle', 10))
  blender.play('idle', 0).update(0.1)
  codeOf(() => blender.playTree(new BlendTree1D().addClip('nope', 0)))
  blender.update(0.1)
  near(root.position.x, 10, 1e-9, 'position.x')
  assert.equal(blender.isPlaying('idle'), true)
})

gate('dispose stops the actions, uncaches them in three and refuses later calls', () => {
  const { mixer, blender } = rig()
  blender.addClip('idle', holdClip('idle', 10))
  blender.play('idle', 0).update(0.1)
  blender.dispose()
  assert.equal(mixer.stats.actions.total, 0)
  assert.equal(codeOf(() => blender.update(0.1)), BLENDER_REFUSAL.DISPOSED)
})

gate('the module imports nothing, so the mixer is the only way three reaches it, and it carries no comments', () => {
  const source = readFileSync(new URL('../src/animation/animationBlender.js', import.meta.url), 'utf8')
  assert.equal(source.includes('import '), false)
  assert.equal(source.includes('//') || source.includes('/*'), false)
})

finish()
