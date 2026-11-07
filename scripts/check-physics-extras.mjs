import { gate, finish } from './lib/gate.mjs'
import { pivotTransform, hingeAngle, riderReleaseVelocity } from '../src/physics-extras/pivotTransform.js'
import { beltVelocity, surfaceVelocityAt } from '../src/physics-extras/surfaceVelocity.js'
import { createJointMap, JOINT_TYPES } from '../src/physics-extras/jointMap.js'
import { STATIC_TILE_M, STATIC_TILE_MARGIN_M, staticTileKey, staticTileSpan, staticTileKeysOf, staticTileExtent } from '../src/physics-extras/staticTiles.js'
import { reachAlongRay, boundsRadius, nearestMoverDistance, orderBucket, orderNearestFirst, needsReorder } from '../src/physics-extras/dormantStatics.js'
import { parseGlb, extractStandardMeshAt, placementsByMesh, GLB_SKIP_MATERIALS } from '../src/physics-extras/glb.js'
import { mat4TRS, applyTransformMatrix, buildNodeTransforms } from '../src/physics-extras/transforms.js'
import { dequantizePositions, indexView, indexSlice } from '../src/physics-extras/meshopt.js'

const TOLERANCE = 1e-9
const QUARTER_TURN_Y = hingeAngle({ openFraction: 1 }).quaternion
const encoder = new TextEncoder()

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const near = (actual, expected, label) => {
  assert(Math.abs(actual - expected) <= TOLERANCE, `${label}: got ${actual}, expected ${expected}`)
}

const nearVec = (actual, expected, label) => {
  assert(actual.length === expected.length, `${label}: length ${actual.length}, expected ${expected.length}`)
  expected.forEach((value, i) => near(actual[i], value, `${label}[${i}]`))
}

const refusesWith = (call, code) => {
  let refusal = null
  try {
    call()
  } catch (error) {
    refusal = error
  }
  assert(refusal !== null, `accepted, expected refusal ${code}`)
  assert(refusal.reasonCode === code, `refused with ${refusal.reasonCode}, expected ${code}`)
}

const accepts = (call) => {
  call()
}

const concatBytes = (...parts) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const triangleFile = ({ translation = [10, 0, 0], stride = 12, declaredStride = stride, indexComponent = 5123 } = {}) => {
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
  const positionBytes = new Uint8Array(stride * 3)
  const positionView = new DataView(positionBytes.buffer)
  positions.forEach((point, i) => point.forEach((component, k) => positionView.setFloat32(i * stride + k * 4, component, true)))
  const indexValues = [0, 1, 2]
  const indexBytes = indexComponent === 5121
    ? Uint8Array.from(indexValues)
    : indexComponent === 5125
      ? new Uint8Array(new Uint32Array(indexValues).buffer)
      : new Uint8Array(new Uint16Array(indexValues).buffer)
  const json = {
    asset: { version: '2.0' },
    nodes: [translation ? { mesh: 0, translation } : { mesh: 0 }],
    meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: indexComponent, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, byteStride: declaredStride },
      { buffer: 0, byteOffset: positionBytes.length, byteLength: indexBytes.length },
    ],
  }
  return { json, bin: concatBytes(positionBytes, indexBytes) }
}

const buildGlb = (json, bin) => {
  const jsonBytes = encoder.encode(JSON.stringify(json))
  const binStart = 20 + jsonBytes.length
  const total = binStart + 8 + bin.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  out.set(encoder.encode('glTF'), 0)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonBytes.length, true)
  out.set(encoder.encode('JSON'), 16)
  out.set(jsonBytes, 20)
  view.setUint32(binStart, bin.length, true)
  out.set(encoder.encode('BIN\0'), binStart + 4)
  out.set(bin, binStart + 8)
  return out
}

const int16Bytes = (values) => new Uint8Array(new Int16Array(values).buffer)
const floatBytes = (values) => new Uint8Array(new Float32Array(values).buffer)

gate('pivot: a hinge turns a body about its pivot, not about the origin', () => {
  const turned = pivotTransform({ position: [2, 0, 0], pivot: [1, 0, 0], quaternion: QUARTER_TURN_Y })
  nearVec(turned, [1, 0, -1], 'pivot turn')
  const aboutOrigin = pivotTransform({ position: [2, 0, 0], quaternion: QUARTER_TURN_Y })
  nearVec(aboutOrigin, [0, 0, -2], 'origin turn')
  assert(Math.abs(turned[0] - aboutOrigin[0]) > 0.5, 'control: pivot had no effect')
})

gate('pivot: scale is applied to the offset from the pivot before rotation', () => {
  nearVec(pivotTransform({ position: [2, 0, 0], scale: [2, 1, 1] }), [4, 0, 0], 'scaled offset')
  nearVec(pivotTransform({ position: [2, 0, 0] }), [2, 0, 0], 'unscaled offset')
  assert(pivotTransform({ position: [2, 0, 0], scale: [2, 1, 1] })[0] !== pivotTransform({ position: [2, 0, 0] })[0], 'control: scale had no effect')
})

gate('pivot: hinge openFraction maps linearly onto the angle bounds and refuses bad input', () => {
  near(hingeAngle({ openFraction: 1 }).angleRad, Math.PI / 2, 'full open')
  near(hingeAngle({ openFraction: 0.5, minAngleRad: 0, maxAngleRad: 1 }).angleRad, 0.5, 'half open')
  refusesWith(() => hingeAngle({ openFraction: 2 }), 'pivot-open-invalid')
  refusesWith(() => hingeAngle({ openFraction: 0.5, minAngleRad: 2, maxAngleRad: 1 }), 'pivot-angle-invalid')
  accepts(() => hingeAngle({ openFraction: 0.5 }))
})

gate('pivot: rider release velocity adds omega cross offset to the platform velocity', () => {
  nearVec(riderReleaseVelocity({ platformVelocity: [3, 0, 0] }), [3, 0, 0], 'no spin')
  nearVec(riderReleaseVelocity({ platformAngularVelocity: [0, 0, 2], riderOffset: [0, 1, 0] }), [-2, 0, 0], 'spin only')
  nearVec(riderReleaseVelocity({ platformVelocity: [3, 0, 0], platformAngularVelocity: [0, 0, 2], riderOffset: [0, 1, 0] }), [1, 0, 0], 'spin plus drift')
  assert(riderReleaseVelocity({ platformAngularVelocity: [0, 0, 2], riderOffset: [0, 1, 0] })[0] !== 0, 'control: spin term vanished')
  refusesWith(() => pivotTransform({ position: [1, 2] }), 'vec3-invalid')
})

gate('surface velocity: a belt surface rotates into the world frame and adds angular tangential speed', () => {
  nearVec(beltVelocity({ surfaceVelocity: [2, 0, 0] }), [2, 0, 0], 'unrotated belt')
  nearVec(beltVelocity({ surfaceVelocity: [1, 0, 0], surfaceQuaternion: QUARTER_TURN_Y }), [0, 0, -1], 'rotated belt')
  nearVec(beltVelocity({ contactPoint: [0, 1, 0], angularVelocity: [0, 0, 1] }), [-1, 0, 0], 'tangential only')
  nearVec(beltVelocity({ surfaceVelocity: [1, 0, 0], contactPoint: [0, 1, 0], angularVelocity: [0, 0, 1] }), [0, 0, 0], 'cancelling')
  const rotatedBelt = beltVelocity({ surfaceVelocity: [1, 0, 0], surfaceQuaternion: QUARTER_TURN_Y })
  assert(Math.abs(rotatedBelt[0] - 1) > 0.5, 'control: rotation had no effect')
})

gate('surface velocity: slip is the relative velocity minus the belt velocity', () => {
  const slip = surfaceVelocityAt({ surfaceVelocity: [2, 0, 0], relativeVelocity: [3, 0, 0] })
  nearVec(slip.belt, [2, 0, 0], 'belt')
  nearVec(slip.slip, [1, 0, 0], 'slip')
  refusesWith(() => beltVelocity({ surfaceVelocity: [1, 2] }), 'vec3-invalid')
  refusesWith(() => beltVelocity({ surfaceQuaternion: [0, 0, 0] }), 'quat-invalid')
  refusesWith(() => surfaceVelocityAt({ relativeVelocity: [1, 2] }), 'vec3-invalid')
  accepts(() => beltVelocity({ surfaceQuaternion: [0, 0, 0, 1] }))
})

gate('joint map: handles store a copy of their anchors, default to point, and report ids', () => {
  const joints = createJointMap()
  const anchor = [0, 1, 0]
  const shoulder = joints.set('shoulder', { to: 'upper-arm', anchor })
  assert(shoulder.type === 'point', 'default type is not point')
  assert(joints.set('hip', { to: 'pelvis', type: 'hinge' }).type === 'hinge', 'explicit type ignored')
  anchor[1] = 9
  nearVec(joints.get('shoulder').anchor, [0, 1, 0], 'stored anchor is a copy of the input')
  assert(joints.get('shoulder').anchor !== anchor, 'control: stored anchor aliases the input array')
  assert(Object.isFrozen(shoulder), 'joint record is not frozen')
  assert(JOINT_TYPES.length === 5, 'joint type table changed')
  assert(joints.ids().join(',') === 'shoulder,hip', 'ids differ')
  assert(joints.get('missing') === null, 'missing joint is not null')
})

gate('joint map: set and remove call the constraint hooks, and a re-set keeps the first pose', () => {
  const written = []
  const removed = []
  const joints = createJointMap({ setConstraint: (id, spec) => written.push([id, spec]), removeConstraint: (id) => removed.push(id) })
  joints.set('shoulder', { to: 'arm', target: [0, 0, 0, 1] })
  const reset = joints.set('shoulder', { to: 'arm', target: [0, 0, 1, 0] })
  assert(written.length === 2, 'setConstraint not called per set')
  assert(reset.target[3] === 1, 'a re-set replaced the first pose')
  const freshPose = createJointMap().set('shoulder', { to: 'arm', target: [0, 0, 1, 0] })
  assert(freshPose.target[2] === 1, 'control: a fresh joint did not take its own target')
  assert(joints.remove('shoulder').ok === true, 'remove did not report ok')
  assert(removed.join(',') === 'shoulder', 'removeConstraint not called')
})

gate('joint map: retuning limits keeps the pose and refuses unknown joints and bad limits', () => {
  const joints = createJointMap()
  joints.set('elbow', { to: 'forearm', target: [0, 0, 0, 1], limits: { cone: 1 } })
  const retuned = joints.retuneLimits('elbow', { cone: 2 })
  assert(retuned.limits.cone === 2, 'limits not replaced')
  assert(retuned.target[3] === 1, 'retuning dropped the pose')
  assert(joints.get('elbow').limits.cone === 2, 'retune not stored')
  refusesWith(() => joints.retuneLimits('missing', {}), 'joint-unknown')
  refusesWith(() => joints.retuneLimits('elbow', []), 'joint-limits-invalid')
  accepts(() => joints.retuneLimits('elbow', {}))
})

gate('joint map: malformed specs are refused with a reason code', () => {
  const joints = createJointMap()
  refusesWith(() => createJointMap({ setConstraint: 1 }), 'joint-hook-invalid')
  refusesWith(() => joints.set('', { to: 'x' }), 'joint-id-invalid')
  refusesWith(() => joints.set('x', {}), 'joint-target-invalid')
  refusesWith(() => joints.set('x', { to: 'y', type: 'spring' }), 'joint-type-invalid')
  refusesWith(() => joints.set('x', { to: 'y', anchor: [0, 0] }), 'quat-vec-invalid')
  refusesWith(() => joints.set('x', { to: 'y', target: [0, 0, 0] }), 'quat-invalid')
  refusesWith(() => joints.set('x', { to: 'y', strength: -1 }), 'joint-strength-invalid')
  refusesWith(() => joints.remove('missing'), 'joint-unknown')
  accepts(() => joints.set('x', { to: 'y', anchor: [0, 0, 0], target: [0, 0, 0, 1], strength: 0 }))
})

gate('static tiles: keys and spans cover the margin-expanded bounds in 16 m tiles', () => {
  const span = staticTileSpan({ minX: 0, maxX: 10, minY: -1, maxY: 1, minZ: 0, maxZ: 10 })
  assert(span.tx0 === -1 && span.tx1 === 0 && span.tz0 === -1 && span.tz1 === 0, 'span differs')
  assert(!span.excluded && !span.big, 'small body flagged')
  const keys = staticTileKeysOf(span)
  assert(keys.join(' ') === '-1,-1 -1,0 0,-1 0,0', 'keys differ')
  assert(!keys.includes('1,0'), 'control: a tile outside the span was listed')
  assert(staticTileKey(1, -2) === '1,-2', 'key format differs')
  assert(STATIC_TILE_M === 16 && STATIC_TILE_MARGIN_M === 3, 'tile constants differ')
})

gate('static tiles: a body with 256 tiles stays indexed and one more tile makes it big', () => {
  const at = (maxX) => staticTileSpan({ minX: 3, maxX, minY: 0, maxY: 1, minZ: 3, maxZ: 252 })
  const sixteenByWide = at(252)
  assert((sixteenByWide.tx1 - sixteenByWide.tx0 + 1) * (sixteenByWide.tz1 - sixteenByWide.tz0 + 1) === 256, 'boundary count changed')
  assert(!sixteenByWide.big, '256 tiles flagged big')
  const seventeen = at(253)
  assert(seventeen.big, '272 tiles not flagged big')
  assert(!at(253).excluded, 'bounded body flagged excluded')
})

gate('static tiles: bodies beyond the 10 km column are excluded from indexing', () => {
  const far = staticTileSpan({ minX: 0, maxX: 1, minY: 10001, maxY: 10002, minZ: 0, maxZ: 1 })
  assert(far.excluded, 'body above the column not excluded')
  const deep = staticTileSpan({ minX: 0, maxX: 1, minY: -10002, maxY: -10001, minZ: 0, maxZ: 1 })
  assert(deep.excluded, 'body below the column not excluded')
  const straddling = staticTileSpan({ minX: 0, maxX: 1, minY: -10002, maxY: 0, minZ: 0, maxZ: 1 })
  assert(!straddling.excluded, 'body crossing the column was excluded')
  const wideAndExcluded = staticTileSpan({ minX: -1000, maxX: 1000, minY: 10001, maxY: 10002, minZ: -1000, maxZ: 1000 })
  assert(!wideAndExcluded.big, 'control: excluded body was also flagged big')
})

gate('static tiles: a tile extent spans its cell plus margin and the full column height', () => {
  const extent = staticTileExtent(2, -1)
  nearVec(extent.min, [29, -10000, -19], 'min')
  nearVec(extent.max, [51, 10000, 3], 'max')
  assert(staticTileExtent(0, 0).min[0] === -3, 'control: origin tile did not start at the margin')
})

gate('dormant statics: a ray reaches a body along the axis and misses one off it', () => {
  near(reachAlongRay([10, 0, 0], 1, [0, 0, 0], [1, 0, 0], 100), 9, 'entry distance')
  assert(reachAlongRay([10, 0, 0], 1, [0, 0, 0], [0, 1, 0], 100) === Infinity, 'off-axis ray hit')
  assert(reachAlongRay([10, 0, 0], 1, [0, 0, 0], [1, 0, 0], 5) === Infinity, 'ray beyond max distance hit')
  assert(reachAlongRay([0, 0, 0], 2, [1, 0, 0], [1, 0, 0], 100) === 0, 'origin inside the sphere not clamped to zero')
  assert(reachAlongRay([0, 0, 0], 2, [5, 0, 0], [1, 0, 0], 100) === Infinity, 'control: sphere behind the origin was hit')
  assert(reachAlongRay([-10, 0, 0], 1, [0, 0, 0], [1, 0, 0], 100) === Infinity, 'body behind the ray hit')
})

gate('dormant statics: a bounds radius is the hypot of the largest absolute extents per axis', () => {
  near(boundsRadius([-3, -4, 0], [1, 2, 5]), Math.sqrt(50), 'radius')
  near(boundsRadius([0, 0, 0], [1, 0, 0]), 1, 'unit radius')
  assert(boundsRadius([-3, -4, 0], [1, 2, 5]) !== boundsRadius([0, 0, 0], [1, 2, 5]), 'control: negative extents ignored')
})

gate('dormant statics: nearest mover distance and order buckets follow 32 m steps capped at 127', () => {
  near(nearestMoverDistance([0, 0, 0], [[3, 4, 0], [10, 0, 0]]), 5, 'nearest distance')
  assert(nearestMoverDistance([0, 0, 0], []) === Infinity, 'no movers is not infinite')
  assert(orderBucket(0) === 0 && orderBucket(31.9) === 0 && orderBucket(32) === 1, 'bucket edges differ')
  assert(orderBucket(Infinity) === 127 && orderBucket(1e9) === 127, 'bucket cap differs')
  assert(orderBucket(40) !== orderBucket(0), 'control: distinct distances share a bucket')
})

gate('dormant statics: reinsertion order is nearest bucket first and stable within a bucket', () => {
  const order = orderNearestFirst([
    { bodyId: 'a', distance: 100 },
    { bodyId: 'b', distance: 1 },
    { bodyId: 'c', distance: 40 },
    { bodyId: 'd', distance: 1 },
  ])
  assert(order.join(',') === 'b,d,c,a', `order ${order.join(',')}`)
  assert(order.join(',') !== 'a,b,c,d', 'control: insertion order returned')
})

gate('dormant statics: a reorder is needed when the mover count changes or a mover moves past 32 m', () => {
  assert(needsReorder(null, []) === true, 'no ordering yet should reorder')
  assert(needsReorder([[0, 0, 0]], [[0, 0, 0], [0, 0, 0]]) === true, 'mover count change should reorder')
  assert(needsReorder([[0, 0, 0]], [[31, 0, 0]]) === false, '31 m displacement should not reorder')
  assert(needsReorder([[0, 0, 0]], [[33, 0, 0]]) === true, '33 m displacement should reorder')
  assert(needsReorder([[0, 0, 0]], [[0, 0, 0]]) === false, 'control: unchanged mover reordered')
})

gate('GLB container: a GLB parses to its JSON with the BIN chunk offset and refuses a bad magic', () => {
  const { json, bin } = triangleFile()
  const glb = buildGlb(json, bin)
  const container = parseGlb(glb)
  assert(container.json.asset.version === '2.0', 'json not parsed')
  const jsonLength = new DataView(glb.buffer).getUint32(12, true)
  assert(container.binOffset === 20 + jsonLength + 8, 'bin offset differs')
  const broken = glb.slice()
  broken.set(encoder.encode('gLTF'), 0)
  refusesWith(() => parseGlb(broken), 'glb-magic-invalid')
  accepts(() => parseGlb(glb))
})

gate('GLB container: a JSON chunk that runs past the end is refused', () => {
  const { json, bin } = triangleFile()
  const glb = buildGlb(json, bin)
  refusesWith(() => parseGlb(glb.slice(0, 30)), 'glb-json-truncated')
  accepts(() => parseGlb(glb.slice()))
})

gate('GLB mesh: positions take the node translation and uint16 indices are read', () => {
  const { json, bin } = triangleFile()
  const glb = buildGlb(json, bin)
  const mesh = extractStandardMeshAt(glb, parseGlb(glb), 0)
  nearVec(Array.from(mesh.vertices), [10, 0, 0, 11, 0, 0, 10, 1, 0], 'translated vertices')
  assert(mesh.indices.join(',') === '0,1,2' && mesh.triangleCount === 1 && mesh.vertexCount === 3, 'indices or counts differ')
  const untranslated = triangleFile({ translation: null })
  const bareGlb = buildGlb(untranslated.json, untranslated.bin)
  const bare = extractStandardMeshAt(bareGlb, parseGlb(bareGlb), 0)
  nearVec(Array.from(bare.vertices), [0, 0, 0, 1, 0, 0, 0, 1, 0], 'untranslated vertices')
  assert(bare.vertices[0] !== mesh.vertices[0], 'control: translation had no effect')
})

gate('GLB mesh: positions are read at the declared byteStride, not a packed 12', () => {
  const padded = triangleFile({ stride: 16 })
  const padGlb = buildGlb(padded.json, padded.bin)
  const padMesh = extractStandardMeshAt(padGlb, parseGlb(padGlb), 0)
  nearVec(Array.from(padMesh.vertices), [10, 0, 0, 11, 0, 0, 10, 1, 0], 'stride 16 vertices')
  const misdeclared = triangleFile({ stride: 16, declaredStride: 12 })
  const badGlb = buildGlb(misdeclared.json, misdeclared.bin)
  const badMesh = extractStandardMeshAt(badGlb, parseGlb(badGlb), 0)
  assert(badMesh.vertices[3] !== padMesh.vertices[3], 'control: a 12-byte read matched the 16-byte layout')
})

gate('GLB mesh: uint32 indices are read and other index types are refused rather than misread', () => {
  const wide = triangleFile({ indexComponent: 5125 })
  const wideGlb = buildGlb(wide.json, wide.bin)
  assert(extractStandardMeshAt(wideGlb, parseGlb(wideGlb), 0).indices.join(',') === '0,1,2', 'uint32 indices differ')
  const bytes = triangleFile({ indexComponent: 5121 })
  const byteGlb = buildGlb(bytes.json, bytes.bin)
  refusesWith(() => extractStandardMeshAt(byteGlb, parseGlb(byteGlb), 0), 'glb-index-type-unsupported')
  refusesWith(() => extractStandardMeshAt(wideGlb, parseGlb(wideGlb), 1), 'glb-mesh-missing')
})

gate('GLB mesh: Draco and Meshopt primitives are refused, not decoded', () => {
  const { json, bin } = triangleFile()
  const draco = structuredClone(json)
  draco.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 0 } }
  const dracoGlb = buildGlb(draco, bin)
  refusesWith(() => extractStandardMeshAt(dracoGlb, parseGlb(dracoGlb), 0), 'glb-draco-unsupported')
  const meshopt = structuredClone(json)
  meshopt.bufferViews[0].extensions = { EXT_meshopt_compression: { buffer: 0 } }
  const meshoptGlb = buildGlb(meshopt, bin)
  refusesWith(() => extractStandardMeshAt(meshoptGlb, parseGlb(meshoptGlb), 0), 'glb-meshopt-unsupported')
  const plain = buildGlb(json, bin)
  accepts(() => extractStandardMeshAt(plain, parseGlb(plain), 0))
})

gate('GLB placements: identical node placements of one mesh are kept once and distinct ones all kept', () => {
  const json = {
    nodes: [
      { mesh: 0, translation: [1, 0, 0] },
      { mesh: 0, translation: [1, 0, 0] },
      { mesh: 0, translation: [2, 0, 0] },
    ],
  }
  assert(placementsByMesh(json, buildNodeTransforms(json)).get(0).join(',') === '0,2', 'duplicate placement kept')
  const distinct = { nodes: [{ mesh: 0, translation: [1, 0, 0] }, { mesh: 0, translation: [2, 0, 0] }] }
  assert(placementsByMesh(distinct, buildNodeTransforms(distinct)).get(0).join(',') === '0,1', 'control: distinct placements collapsed')
})

gate('GLB materials: the skip table names the tool and clip materials and not ordinary surfaces', () => {
  assert(GLB_SKIP_MATERIALS.has('nodraw') && GLB_SKIP_MATERIALS.has('toolstrigger'), 'skip table lost a tool material')
  assert(!GLB_SKIP_MATERIALS.has('stone'), 'control: an ordinary surface is skipped')
})

gate('transforms: a TRS matrix rotates before it translates and a child inherits its parent', () => {
  const quarterTurnZ = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
  nearVec(Array.from(applyTransformMatrix(new Float32Array([1, 0, 0]), mat4TRS([0, 0, 0], quarterTurnZ, [1, 1, 1]))), [0, 1, 0], 'quarter turn about z')
  nearVec(Array.from(applyTransformMatrix(new Float32Array([1, 0, 0]), mat4TRS([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]))), [1, 0, 0], 'identity')
  const hierarchy = {
    nodes: [
      { children: [1], translation: [5, 0, 0] },
      { translation: [0, 1, 0] },
    ],
  }
  const world = buildNodeTransforms(hierarchy)
  nearVec([world[1][12], world[1][13], world[1][14]], [5, 1, 0], 'child world translation')
  const alone = buildNodeTransforms({ nodes: [{ translation: [0, 1, 0] }] })[0]
  assert(alone[12] !== world[1][12], 'control: parent did not contribute')
})

gate('meshopt: normalized int16 positions dequantize by 32767 and floats copy through', () => {
  const normalized = int16Bytes([32767, 0, -32767, 0, 16384, 0, 0, 0])
  const vertices = dequantizePositions(normalized, 2, 8, true, 5122)
  nearVec(Array.from(vertices), [1, 0, -1, 16384 / 32767, 0, 0], 'normalized vertices')
  const floats = floatBytes([1, 2, 3, 4, 5, 6])
  nearVec(Array.from(dequantizePositions(floats, 2, 12, false, 5126)), [1, 2, 3, 4, 5, 6], 'packed floats')
  const notNormalized = dequantizePositions(normalized, 2, 8, false, 5122)
  assert(Math.abs(notNormalized[0] - 1) > 0.5, 'control: an un-normalized int16 was scaled')
})

gate('meshopt: a float stride that is not a multiple of 4 is refused', () => {
  refusesWith(() => dequantizePositions(new Uint8Array(24), 2, 6, false, 5126), 'meshopt-stride-invalid')
  accepts(() => dequantizePositions(new Uint8Array(24), 2, 8, false, 5126))
})

gate('meshopt: index views read 16-bit or 32-bit words and slices honour the accessor offset', () => {
  const decoded = new Uint8Array(new Uint16Array([7, 8, 9, 10]).buffer)
  const view = indexView(decoded, 2)
  assert(view.length === 4 && view[0] === 7, 'uint16 view differs')
  assert(indexSlice(view, 4, 2, 2).join(',') === '9,10', 'offset slice differs')
  assert(indexSlice(view, 0, 2, 2).join(',') !== '9,10', 'control: offset ignored')
  refusesWith(() => indexView(decoded, 3), 'meshopt-index-stride-invalid')
})

finish()
