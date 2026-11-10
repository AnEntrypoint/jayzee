import * as THREE from 'three'
import { createPlayerLodPlanner } from '../client-pure/playerLodPlanner.js'
import { TIER_DOT } from '../client-pure/playerTierSplit.js'
import { CROWD_DOT_SIZE, CROWD_POSE_STRIDE, crowdPoseBuffer, crowdPoseBufferFor, decodeCrowdDotPoses } from './crowdDots.js'
import { CROWD_DOT_CELL_M } from '../snapshot-lod-pure/constants.js'
import { createCrowdDotRendererWebGPU } from './playerLodRendererWebGPU.js'
import { isWebGPUInstancingSupported } from './webgpuInstancing.js'
import { makeDotGeometry } from './dotGeometry.js'

const DOT_COLOR = 0xffcc66
const DOT_OPACITY = 0.85
const DOT_RENDER_ORDER = 3
const DOT_CAPACITY = 512
const BILLBOARD_REPLACEMENT = [
  '#include <begin_vertex>',
  '      {',
  '        vec3 worldPos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
  '        vec3 toCam = normalize(cameraPosition - worldPos);',
  '        vec3 up = vec3(0.0, 1.0, 0.0);',
  '        vec3 right = normalize(cross(toCam, up));',
  '        vec3 camUp = cross(right, toCam);',
  '        transformed = right * position.x + camUp * position.z;',
  '      }',
].join(String.fromCharCode(10))

export { makeDotGeometry }

export const makeDotMaterial = () => {
  const mat = new THREE.MeshBasicMaterial({ color: DOT_COLOR, transparent: true, opacity: DOT_OPACITY, depthWrite: false })
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', BILLBOARD_REPLACEMENT)
  }
  return mat
}

export function createCrowdDotRenderer(scene, opts = {}) {
  if (isWebGPUInstancingSupported(opts.renderer)) return createCrowdDotRendererWebGPU(scene, opts)
  return createCrowdDotRendererWebGL(scene, opts)
}

export function createCrowdDotRendererWebGL(scene, opts = {}) {
  const dotCellM = opts.dotCellM || CROWD_DOT_CELL_M
  const dotSize = opts.dotSize || CROWD_DOT_SIZE
  let capacity = opts.capacity || DOT_CAPACITY
  const geo = makeDotGeometry(dotSize)
  const mat = makeDotMaterial()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const matrix = new THREE.Matrix4()
  let activeCount = 0
  const decodeOptions = { dotCellM, dotSize, viewerY: 0, groundHeightFn: null }
  let poses = crowdPoseBuffer(capacity)

  const newMesh = (n) => {
    const mesh = new THREE.InstancedMesh(geo, mat, n)
    mesh.frustumCulled = false
    mesh.matrixAutoUpdate = false
    mesh.renderOrder = DOT_RENDER_ORDER
    mesh.count = 0
    return mesh
  }
  let im = newMesh(capacity)
  scene.add(im)

  const ensureCapacity = (n) => {
    if (n <= capacity) return
    capacity = Math.max(n, capacity * 2)
    const next = newMesh(capacity)
    scene.remove(im)
    scene.add(next)
    im = next
  }

  const update = (dots, viewerY, groundHeightFn) => {
    decodeOptions.viewerY = viewerY
    decodeOptions.groundHeightFn = groundHeightFn
    poses = crowdPoseBufferFor(poses, dots ? dots.length : 0)
    const count = decodeCrowdDotPoses(dots, decodeOptions, poses)
    ensureCapacity(count)
    for (let i = 0; i < count; i++) {
      const at = i * CROWD_POSE_STRIDE
      const size = poses[at + 3]
      position.set(poses[at], poses[at + 1], poses[at + 2])
      scale.set(size, size, size)
      im.setMatrixAt(i, matrix.compose(position, quaternion, scale))
    }
    im.count = count
    im.instanceMatrix.needsUpdate = true
    activeCount = count
  }

  const dispose = () => {
    scene.remove(im)
    geo.dispose()
    mat.dispose()
  }

  return {
    get instancedMesh() {
      return im
    },
    update,
    dispose,
    get count() {
      return activeCount
    },
  }
}

export function installPlayerLodRenderer(scene, opts = {}) {
  const dots = createCrowdDotRenderer(scene, opts)
  const planner = createPlayerLodPlanner()
  return {
    tick(remoteEntries, viewerPos, serverDots = null, groundHeightFn = null) {
      const { tiers, dots: source } = planner.plan(remoteEntries, viewerPos, serverDots)
      dots.update(source.list, viewerPos.y, groundHeightFn)
      return tiers
    },
    getTiers: () => planner.getTiers(),
    tierOf(id) {
      const tier = planner.tierOf(id)
      return tier !== undefined ? tier : TIER_DOT
    },
    setFullCountOverride: (value) => planner.setFullCountOverride(value),
    dots,
    dispose: () => dots.dispose(),
  }
}
