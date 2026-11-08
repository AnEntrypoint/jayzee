import { canon } from './canon.mjs'

export const DOT_WEBGPU_STEP_LABELS = [
  'buckets over no ground use the viewer height',
  'buckets over a sloped ground',
  'flat dots over no ground keep their own height',
  'flat dots over a sloped ground',
  'buckets are capped at three dot sizes',
  'an empty update after dots clears the instances',
  'an empty update with nothing drawn leaves the instances alone',
  'growing past the 512 starting capacity keeps every instance',
  'dispose removes the mesh from the scene',
]

const makeScene = () => ({
  children: [],
  add(object) { this.children.push(object) },
  remove(object) { this.children = this.children.filter((child) => child !== object) },
})

const sloped = (x, z) => 0.5 + 0.01 * x - 0.02 * z
const flat = (count, base) => Array.from({ length: count }, (_, i) => ({ x: base + i * 0.5, y: 1 + (i % 3) * 0.25, z: -i * 0.25 }))
const liveMesh = (scene) => scene.children.find((child) => child.isInstancedMesh === true)

const snapshot = (scene, count) => {
  const mesh = liveMesh(scene)
  if (!mesh) return { count, sceneChildren: scene.children.length }
  const material = mesh.material
  return {
    count,
    meshCount: mesh.count,
    renderOrder: mesh.renderOrder,
    frustumCulled: mesh.frustumCulled,
    sceneChildren: scene.children.length,
    nodeMaterial: material.isMeshBasicNodeMaterial === true,
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    color: material.color.getHex(),
    matrices: Array.from(mesh.instanceMatrix.array.subarray(0, mesh.count * 16)),
  }
}

export function runDotWebGPUScenario(createRenderer, crowdDots) {
  const scene = makeScene()
  const renderer = createRenderer(scene, { renderer: { isWebGPURenderer: true } })
  const rows = []
  const step = (label, action) => {
    let value
    try {
      action()
      value = snapshot(scene, renderer.count)
    } catch (error) {
      value = { threw: error.message }
    }
    rows.push(canon({ label, value }))
  }
  const [buckets, bucketsSloped, flatFlat, flatSloped, capped, emptyAfter, emptyIdle, growth, disposed] = DOT_WEBGPU_STEP_LABELS
  step(buckets, () => renderer.update(crowdDots, 2, null))
  step(bucketsSloped, () => renderer.update(crowdDots, 2, sloped))
  step(flatFlat, () => renderer.update(flat(3, 0), 0, null))
  step(flatSloped, () => renderer.update(flat(3, 10), 0, sloped))
  step(capped, () => renderer.update([[3, 4, 49], [0, 0, 1], [-2, -2, 400]], 0, null))
  step(emptyAfter, () => renderer.update([], 0, null))
  step(emptyIdle, () => renderer.update([], 0, null))
  step(growth, () => renderer.update(flat(600, 200), 0, null))
  step(disposed, () => renderer.dispose())
  return rows
}
