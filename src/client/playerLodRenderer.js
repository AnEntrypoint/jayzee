import * as THREE from 'three'
import { createPlayerLodPlanner } from '../client-pure/playerLodPlanner.js'
import { TIER_DOT } from '../client-pure/playerTierSplit.js'
import { CROWD_DOT_SIZE, decodeCrowdDots } from './crowdDots.js'
import { CROWD_DOT_CELL_M } from '../snapshot-lod-pure/constants.js'
import { createCrowdDotRendererWebGPU } from './playerLodRendererWebGPU.js'
import { isWebGPUInstancingSupported } from './webgpuInstancing.js'
import { makeDotGeometry } from './dotGeometry.js'

const DOT_COLOR = 0xffcc66
const DOT_OPACITY = 0.85
const DOT_RENDER_ORDER = 3
const DOT_CAPACITY = 512
const LINE = String.fromCharCode(10)
const BILLBOARD_BLOCK = [
  '{',
  'vec3 worldPos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;',
  'vec3 toCam = normalize(cameraPosition - worldPos);',
  'vec3 up = vec3(0.0, 1.0, 0.0);',
  'vec3 right = normalize(cross(up, toCam));',
  'vec3 camUp = cross(toCam, right);',
  'float sx = length(instanceMatrix[0].xyz);',
  'transformed = right * position.x * sx - camUp * position.z * sx;',
  '}',
].join(LINE)

export { makeDotGeometry }

export const makeDotMaterial = () => {
  const mat = new THREE.MeshBasicMaterial({ color: DOT_COLOR, transparent: true, opacity: DOT_OPACITY, depthWrite: false })
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + LINE + BILLBOARD_BLOCK)
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
    const poses = decodeCrowdDots(dots, { dotCellM, dotSize, viewerY, groundHeightFn })
    ensureCapacity(poses.length)
    poses.forEach((pose, i) => {
      position.set(pose.x, pose.y, pose.z)
      scale.set(pose.scale, pose.scale, pose.scale)
      im.setMatrixAt(i, matrix.compose(position, quaternion, scale))
    })
    im.count = poses.length
    im.instanceMatrix.needsUpdate = true
    activeCount = poses.length
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
      const tier = planner.getTiers().tierById.get(id)
      return tier !== undefined ? tier : TIER_DOT
    },
    setFullCountOverride: (value) => planner.setFullCountOverride(value),
    dots,
    dispose: () => dots.dispose(),
  }
}
