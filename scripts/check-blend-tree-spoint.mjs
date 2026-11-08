import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runBlendTree } from './lib/blendTreeScenario.mjs'
import { BlendTree1D, BlendTree2D, BlendTreeNode } from '../src/animation/blendTree.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/blend-tree.json', import.meta.url), 'utf8'))
const ran = runBlendTree({ BlendTree1D, BlendTree2D, BlendTreeNode })

const firstDiff = (name) => {
  const want = fixture.sections[name]
  const got = ran[name]
  const at = want.findIndex((line, i) => got[i] !== line)
  if (at === -1 && got.length === want.length) return name + ' matches'
  const i = at === -1 ? Math.min(got.length, want.length) : at
  return name + ' line ' + i + ': spoint ' + want[i] + ' | jayzee ' + got[i]
}
const same = (name) => JSON.stringify(ran[name]) === JSON.stringify(fixture.sections[name])

gate('BlendTree1D matches spoint on every sampling, chaining, copy and refusal case', () => {
  assert.ok(same('BlendTree1D'), firstDiff('BlendTree1D'))
})

gate('BlendTree2D matches spoint on every sampling, nearest-three, tie and refusal case', () => {
  assert.ok(same('BlendTree2D'), firstDiff('BlendTree2D'))
})

gate('BlendTreeNode matches spoint on update forwarding, child shape and shared children', () => {
  assert.ok(same('BlendTreeNode'), firstDiff('BlendTreeNode'))
})

gate('the fixture reaches an exact-on-sample, a between-samples, a beyond-the-range and a floor-clamped query', () => {
  const labels = (name) => fixture.sections[name].map((line) => JSON.parse(line).label)
  const oneD = labels('BlendTree1D')
  const twoD = labels('BlendTree2D')
  assert.ok(oneD.includes('1D parameter 1 weights'), 'no 1D exact-on-sample query')
  assert.ok(oneD.includes('1D parameter 0.5 weights'), 'no 1D between-samples query')
  assert.ok(oneD.includes('1D parameter 9 weights'), 'no 1D beyond-the-range query')
  assert.ok(twoD.includes('2D (0, 0) weights'), 'no 2D exact-on-sample query')
  assert.ok(twoD.includes('2D (0.5, 0.5) weights'), 'no 2D between-samples query')
  assert.ok(twoD.includes('2D (10, 10) weights'), 'no 2D beyond-the-range query')
  assert.ok(twoD.includes('2D (0.001, 0) weights'), 'no 2D floor-clamped query')
})

finish()
