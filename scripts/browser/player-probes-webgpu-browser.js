import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { describeRenderer, createLoaders, warmupShaders } from '../../src/client/sceneSetup.js'

const result = { ok: false, backend: null, errors: [], describe: null, loaders: null, refusals: null, glb: null, warmupFirst: null, warmupSecond: null, thrown: null }
const realError = console.error
console.error = (...args) => {
  result.errors.push(args.map(String).join(' ').slice(0, 400))
  realError(...args)
}
window.addEventListener('error', (e) => result.errors.push('uncaught ' + e.message))

const canvas = document.getElementById('c')
const DRACO = '../../node_modules/three/examples/jsm/libs/draco/'
const BASIS = '../../node_modules/three/examples/jsm/libs/basis/'

const loadingMgr = { setLabel() {}, reportProcessing() {} }

const parseGlb = (loader, buffer) => new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject))

try {
  const renderer = new WebGPURenderer({ canvas, antialias: false })
  await renderer.init()
  result.backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'webgpu' : 'not-webgpu'

  result.describe = describeRenderer(renderer)

  const loaders = createLoaders(renderer, { dracoDecoderPath: DRACO, basisPath: BASIS })
  result.loaders = {
    gltfLoader: loaders.gltfLoader instanceof Object,
    dracoLoader: !!loaders.dracoLoader,
    dracoDecoderWasm: loaders.dracoLoader.decoderPaths.wasm,
    ktx2Loader: !!loaders.ktx2Loader,
    meshoptDecoder: !!loaders.gltfLoader.meshoptDecoder,
    vrmPlugin: loaders.gltfLoader.pluginCallbacks.length > 0,
  }
  result.refusals = {}
  try { createLoaders(renderer) } catch (error) { result.refusals.createLoaders = error.message }
  try { await warmupShaders(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), new Map(), new Map(), loadingMgr, null, null, null, null) } catch (error) { result.refusals.warmupShaders = error.message }

  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3366cc }))
  const source = new THREE.Scene()
  source.add(box)
  const exported = await new GLTFExporter().parseAsync(source, { binary: true })
  const gltf = await parseGlb(loaders.gltfLoader, exported)
  let loadedVertices = 0
  let loadedMeshes = 0
  gltf.scene.traverse((o) => { if (o.isMesh) { loadedMeshes++; loadedVertices += o.geometry.attributes.position.count } })
  result.glb = { bytes: exported.byteLength, meshes: loadedMeshes, vertices: loadedVertices, expectedVertices: box.geometry.attributes.position.count }

  const scene = new THREE.Scene()
  const light = new THREE.DirectionalLight(0xffffff, 1)
  light.position.set(1, 2, 3)
  scene.add(light)
  const loadedMesh = gltf.scene.children.find((o) => o.isMesh) || gltf.scene.children[0]
  scene.add(loadedMesh)
  const entityMeshes = new Map([['box', loadedMesh]])
  const camera = new THREE.PerspectiveCamera(50, 320 / 240, 0.1, 50)
  camera.position.set(0, 1, 4)
  camera.lookAt(0, 0, 0)
  const records = []
  const storage = window.localStorage
  const env = {
    now: () => performance.now(),
    epochNow: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    raf: (cb) => requestAnimationFrame(cb),
    storage,
    record: (o) => records.push(o),
    log: (...args) => console.log(...args),
  }
  await warmupShaders(renderer, scene, camera, entityMeshes, new Map(), loadingMgr, null, null, null, env)
  result.warmupFirst = records[0]
  await warmupShaders(renderer, scene, camera, entityMeshes, new Map(), loadingMgr, null, null, null, env)
  result.warmupSecond = records[1]

  result.ok = result.errors.length === 0 &&
    result.backend === 'webgpu' &&
    result.describe.class === 'WebGPURenderer' && result.describe.backend === 'webgpu' && typeof result.describe.glRenderer === 'string' && result.describe.glRenderer.length > 0 &&
    result.loaders.gltfLoader && result.loaders.dracoLoader && result.loaders.ktx2Loader && result.loaders.meshoptDecoder && result.loaders.vrmPlugin && String(result.loaders.dracoDecoderWasm).endsWith('/libs/draco/draco_decoder.wasm') &&
    typeof result.refusals.createLoaders === 'string' && typeof result.refusals.warmupShaders === 'string' &&
    result.glb.meshes === 1 && result.glb.vertices === result.glb.expectedVertices &&
    result.warmupFirst.skipped === undefined && result.warmupFirst.total === 1 && result.warmupFirst.compileFailures.length === 0 &&
    result.warmupSecond.skipped === true && result.warmupSecond.reason === 'scene-unchanged'
} catch (error) {
  result.thrown = error && error.message ? error.message : String(error)
  result.errors.push('thrown ' + result.thrown)
}
window.playerWebgpuResult = result
