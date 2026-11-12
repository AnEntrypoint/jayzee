import assert from 'node:assert/strict'
import * as THREE from 'three'
import { gate, finish } from './lib/gate.mjs'
import { createProceduralBody, planProceduralBody } from '../src/animation/proceduralBodyThree.js'

const spec = {
  hips: { pivot: [0, 1, 0] },
  spine: { pivot: [0, 1.3, 0], parent: 'hips' },
  head: { pivot: [0, 1.7, 0], parent: 'spine' },
  leftUpperArm: { pivot: [0.2, 1.5, 0], parent: 'spine' },
  leftLowerArm: { pivot: [0.5, 1.5, 0], parent: 'leftUpperArm' },
  leftHand: { pivot: [0.75, 1.5, 0], parent: 'leftLowerArm' },
  leftUpperLeg: { pivot: [0.1, 0.9, 0], parent: 'hips' },
  leftLowerLeg: { pivot: [0.1, 0.5, 0], parent: 'leftUpperLeg' },
  leftFoot: { pivot: [0.1, 0.08, 0], parent: 'leftLowerLeg' },
}
const names = Object.keys(spec)
const near = (a, b, eps, label) => assert.ok(Math.abs(a - b) <= eps, `${label}: ${a} against ${b}`)
const skinned = (body, i) => body.mesh.getVertexPosition(i, new THREE.Vector3())
const raw = (body, i) => new THREE.Vector3().fromBufferAttribute(body.geometry.getAttribute('position'), i)

gate('the body is a three SkinnedMesh bound to a Skeleton of Bones in declaration order', () => {
  const body = createProceduralBody(THREE, spec)
  assert.ok(body.mesh instanceof THREE.SkinnedMesh && body.mesh.isSkinnedMesh)
  assert.ok(body.skeleton instanceof THREE.Skeleton)
  assert.equal(body.mesh.skeleton, body.skeleton)
  assert.deepEqual(body.skeleton.bones.map((b) => b.name), names)
  assert.ok(body.skeleton.bones.every((b) => b instanceof THREE.Bone))
  assert.equal(body.bones.get('leftHand').parent, body.bones.get('leftLowerArm'))
  assert.equal(body.bones.get('hips').parent, body.mesh)
  assert.equal(body.skeleton.boneInverses.length, names.length)
})

gate('every bone sits at its pivot in world space', () => {
  const body = createProceduralBody(THREE, spec)
  body.mesh.updateMatrixWorld(true)
  for (const name of names) {
    const world = body.bones.get(name).getWorldPosition(new THREE.Vector3())
    for (let k = 0; k < 3; k++) near(world.getComponent(k), spec[name].pivot[k], 1e-6, name)
  }
})

gate('the geometry is sized once from the bone count: eight vertices and twelve triangles per bone', () => {
  const body = createProceduralBody(THREE, spec)
  const g = body.geometry
  assert.equal(g.getAttribute('position').count, names.length * 8)
  assert.equal(g.getIndex().count, names.length * 36)
  assert.equal(g.getAttribute('skinIndex').itemSize, 4)
  assert.ok(g.getAttribute('skinIndex').array instanceof Uint16Array)
  assert.ok(g.getAttribute('normal') && g.boundingSphere.radius > 0.5)
  for (let i = 0; i < g.getIndex().count; i++) assert.ok(g.getIndex().getX(i) < body.vertexCount)
  const w = g.getAttribute('skinWeight')
  const j = g.getAttribute('skinIndex')
  for (let v = 0; v < w.count; v++) {
    near(w.getX(v) + w.getY(v) + w.getZ(v) + w.getW(v), 1, 1e-6, `weights of vertex ${v}`)
    assert.ok(j.getX(v) < names.length && j.getY(v) < names.length)
  }
  let volume = 0
  const p = g.getAttribute('position')
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let i = 0; i < 36; i += 3) {
    a.fromBufferAttribute(p, g.getIndex().getX(i))
    b.fromBufferAttribute(p, g.getIndex().getX(i + 1))
    c.fromBufferAttribute(p, g.getIndex().getX(i + 2))
    volume += a.dot(b.clone().cross(c)) / 6
  }
  assert.ok(Math.abs(volume) > 1e-5, 'the first segment is a closed box with a consistent winding')
})

gate('in the bind pose skinning leaves every vertex where the geometry has it', () => {
  const body = createProceduralBody(THREE, spec)
  for (let i = 0; i < body.vertexCount; i++) assert.ok(skinned(body, i).distanceTo(raw(body, i)) < 1e-6, `vertex ${i}`)
})

gate('rotating the lower arm swings the hand, half-turns the elbow ring and leaves the legs, spine and head still', () => {
  const body = createProceduralBody(THREE, spec)
  body.bones.get('leftLowerArm').rotation.z = Math.PI / 2
  body.mesh.updateMatrixWorld(true)
  const segment = (name) => names.indexOf(name) * 8
  const centre = (name, ring) => {
    const sum = new THREE.Vector3()
    for (let c = 0; c < 4; c++) sum.add(skinned(body, segment(name) + ring * 4 + c))
    return sum.multiplyScalar(0.25)
  }
  const handTip = centre('leftHand', 1)
  near(handTip.x, 0.5, 1e-5, 'hand tip x is back over the elbow')
  near(handTip.y, 1.75, 1e-5, 'hand tip is lifted by the hand length')
  const handBase = centre('leftHand', 0)
  near(handBase.x, 0.5, 1e-5, 'hand base stays on the elbow pivot')
  near(handBase.y, 1.5, 1e-5, 'hand base stays on the elbow pivot')
  const elbow = segment('leftLowerArm') + 4
  for (let v = elbow; v < elbow + 4; v++) {
    const rest = raw(body, v)
    const turned = new THREE.Vector3(0.5 - (rest.y - 1.5), 1.5 + (rest.x - 0.5), rest.z)
    assert.ok(skinned(body, v).distanceTo(rest.clone().add(turned).multiplyScalar(0.5)) < 1e-5, 'an elbow ring vertex is the mean of its rest and fully turned places')
  }
  for (const still of ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'head', 'spine', 'leftUpperArm', 'hips']) {
    for (let v = segment(still); v < segment(still) + 8; v++) assert.ok(skinned(body, v).distanceTo(raw(body, v)) < 1e-6, still)
  }
  let moved = 0
  for (let v = segment('leftHand'); v < segment('leftHand') + 8; v++) if (skinned(body, v).distanceTo(raw(body, v)) > 0.03) moved++
  assert.equal(moved, 8, 'negative control: every hand vertex moved')
})

gate('the plan is plain typed arrays and the same spec gives the same body', () => {
  const a = planProceduralBody(spec)
  const b = planProceduralBody(spec, { thickness: 0.05 })
  assert.ok(a.positions instanceof Float32Array && a.indices instanceof Uint16Array)
  assert.deepEqual(Array.from(a.positions), Array.from(b.positions))
  assert.deepEqual(Array.from(a.skinWeight), Array.from(b.skinWeight))
  const thick = planProceduralBody(spec, { thickness: 0.1 })
  assert.notDeepEqual(Array.from(thick.positions), Array.from(a.positions))
  const lone = planProceduralBody({ root: { pivot: [0, 0, 0] } })
  assert.equal(lone.vertexCount, 8)
  assert.deepEqual(Array.from(lone.skinIndex), new Array(32).fill(0))
})

gate('a missing three namespace, a bad thickness and a bad skeleton are refused', () => {
  assert.throws(() => createProceduralBody(null, spec), /needs the three namespace/)
  assert.throws(() => createProceduralBody({ Bone: THREE.Bone }, spec), /has no Skeleton/)
  assert.throws(() => planProceduralBody(spec, { thickness: 0 }), /thickness/)
  assert.throws(() => createProceduralBody(THREE, { a: { pivot: [0, 0, 0], parent: 'b' } }), /must be declared before it/)
  assert.throws(() => createProceduralBody(THREE, {}), /declares no bones/)
})

finish()
