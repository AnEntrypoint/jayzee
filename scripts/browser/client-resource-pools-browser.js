import { createLightPool, createTexturePool, createMeshPool, createPipelineRegistry } from '../../src/client/resourcePools.js'

const FRAMES = 600
const CHURN_PER_FRAME = 8
const LIGHT = { x: 0, y: 1, z: 2, radius: 5, r: 1, g: 1, b: 1, intensity: 1 }
const PIXELS = new Uint8Array(64 * 64 * 4).fill(128)
const MESH = { vertices: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) }

const registry = createPipelineRegistry()
registry.register('terrain', () => ({ id: 'terrain' }))
registry.register('props', () => ({ id: 'props' }))
const compiledAtLoad = registry.seal()

const lights = createLightPool(256)
const textures = createTexturePool({ layers: 32, width: 64, height: 64 })
const meshes = createMeshPool({ slots: 64, vertexCapacity: 3, indexCapacity: 3, stride: 3 })

const p99 = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]
}

const runFrames = (churn) => {
  const times = []
  let lightHandles = []
  let textureHandles = []
  let meshHandles = []
  for (let frame = 0; frame < FRAMES; frame++) {
    const start = performance.now()
    if (churn) {
      for (const handle of lightHandles) lights.remove(handle)
      for (const handle of textureHandles) textures.remove(handle)
      for (const handle of meshHandles) meshes.remove(handle)
      lightHandles = []
      textureHandles = []
      meshHandles = []
      for (let i = 0; i < CHURN_PER_FRAME; i++) {
        const light = lights.add(LIGHT)
        if (light >= 0) lightHandles.push(light)
        const texture = textures.add(PIXELS)
        if (texture >= 0) textureHandles.push(texture)
        const mesh = meshes.add(MESH)
        if (mesh >= 0) meshHandles.push(mesh)
      }
    }
    registry.get('terrain')
    registry.get('props')
    times.push(performance.now() - start)
  }
  return { p99Ms: p99(times), frames: times.length }
}

const baseline = runFrames(false)
const churned = runFrames(true)
const result = {
  compiledAtLoad,
  compileCountAfterPlay: registry.compileCount(),
  baseline,
  churned,
  lightsLive: lights.count(),
  texturesLive: textures.count(),
  meshesLive: meshes.count()
}
document.getElementById('out').textContent = JSON.stringify(result, null, 2)
console.log(JSON.stringify(result))
