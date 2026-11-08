import { canon } from './canon.mjs'

export const SCENE_SETUP_CASE_LABELS = [
  'setupLights adds an ambient, a studio and a shadow-casting sun with a warm-up point light',
  'applySceneConfig with a full exp2 fog and shadow settings sets the scene, lights and camera',
  'applySceneConfig with a linear fog and no fog colour leaves the default linear fog',
  'applySceneConfig with an empty config changes nothing',
  'createScene sets the sky colour, the exp2 fog and the fog far value',
  'the skeleton upload skip keeps the bone texture while the pose is unchanged',
  'the skeleton upload skip swaps to a back texture when the pose changes',
  'limitTextureSize leaves a texture at or under 2048 pixels unchanged',
  'limitTextureSize scales a texture over 2048 pixels to 2048 on its long side',
  'waitForManifestResidence with no manifest returns at once',
  'waitForManifestResidence with a resolved manifest reports nothing unresolved',
  'waitForManifestResidence with an unresolved url and no wait reports that url',
  'installStuckPipelineRecovery leaves a WebGL renderer untouched',
  'installStuckPipelineRecovery counts two pipeline errors without a recovery',
  'the warm-up and manifest residence constants equal spoint',
]

const describeLight = (l) => ({ type: l.type, color: l.color.getHex(), intensity: l.intensity, position: l.position.toArray(), castShadow: l.castShadow, matrixAutoUpdate: l.matrixAutoUpdate })
const describeShadow = (l) => ({ mapSize: l.shadow.mapSize.toArray(), bias: l.shadow.bias, normalBias: l.shadow.normalBias, radius: l.shadow.radius, near: l.shadow.camera.near, far: l.shadow.camera.far })
const describeFog = (f) => (f ? { kind: f.constructor.name, color: f.color.getHex(), near: f.near ?? null, far: f.far ?? null, density: f.density ?? null } : null)
const describeScene = (scene) => ({ background: scene.background ? scene.background.getHex() : null, fog: describeFog(scene.fog), children: scene.children.map((o) => o.type) })
const pick = (r) => ({ unresolved: r.unresolved, polls: r.polls, aborted: r.aborted })

export async function runSceneSetupScenario(api) {
  const THREE = api.THREE
  const rows = []
  const record = async (label, fn) => {
    try { rows.push(canon({ label, value: await fn() })) } catch (error) { rows.push(canon({ label, value: { threw: error.message } })) }
  }
  const lit = () => {
    const scene = new THREE.Scene()
    const lights = api.setupLights(scene)
    return { scene, lights, camera: new THREE.PerspectiveCamera(45, 1, 0.1, 100) }
  }
  const lightRows = (lights) => ({ ambient: describeLight(lights.ambient), studio: describeLight(lights.studio), sun: describeLight(lights.sun), sunShadow: describeShadow(lights.sun), warmup: describeLight(lights.warmupPoint) })

  await record(SCENE_SETUP_CASE_LABELS[0], () => {
    const { scene, lights } = lit()
    return { keys: Object.keys(lights).sort(), scene: describeScene(scene), lights: lightRows(lights), sunTargetInScene: scene.children.includes(lights.sun.target) }
  })

  await record(SCENE_SETUP_CASE_LABELS[1], () => {
    const { scene, lights, camera } = lit()
    api.applySceneConfig({ skyColor: 0x112233, fogColor: 0x445566, fogType: 'exp2', fogDensity: 0.01, ambientColor: 0xaaaaaa, ambientIntensity: 0.7, sunColor: 0xffeedd, sunIntensity: 2, sunPosition: [1, 2, 3], fillColor: 0x0000ff, fillIntensity: 0.9, fillPosition: [-4, 5, -6], shadowMapSize: 512, shadowBias: -0.001, shadowNormalBias: 0.2, shadowRadius: 3, shadowBlurSamples: 8, fov: 60 }, scene, lights.ambient, lights.sun, lights.studio, camera)
    return { scene: describeScene(scene), lights: lightRows(lights), fov: camera.fov, fogFar: api.host.__fogFar }
  })

  await record(SCENE_SETUP_CASE_LABELS[2], () => {
    const { scene, lights, camera } = lit()
    api.applySceneConfig({ fogColor: 0x334455, fogType: 'linear' }, scene, lights.ambient, lights.sun, lights.studio, camera)
    return { scene: describeScene(scene), fogFar: api.host.__fogFar }
  })

  await record(SCENE_SETUP_CASE_LABELS[3], () => {
    const { scene, lights, camera } = lit()
    const before = { scene: describeScene(scene), lights: lightRows(lights), fov: camera.fov }
    api.applySceneConfig({}, scene, lights.ambient, lights.sun, lights.studio, camera)
    return { unchanged: canon(before) === canon({ scene: describeScene(scene), lights: lightRows(lights), fov: camera.fov }) }
  })

  await record(SCENE_SETUP_CASE_LABELS[4], () => {
    const scene = api.createScene()
    return { scene: describeScene(scene), fogFar: api.host.__fogFar }
  })

  await record(SCENE_SETUP_CASE_LABELS[5], () => {
    api.installSkeletonUploadSkip()
    const bone = new THREE.Bone()
    const skeleton = new THREE.Skeleton([bone])
    skeleton.computeBoneTexture()
    const first = skeleton.boneTexture
    const seen = []
    bone.updateMatrixWorld(true)
    skeleton.update()
    seen.push({ same: skeleton.boneTexture === first, version: skeleton.boneTexture.version })
    skeleton.update()
    seen.push({ same: skeleton.boneTexture === first, version: skeleton.boneTexture.version })
    return seen
  })

  await record(SCENE_SETUP_CASE_LABELS[6], () => {
    api.installSkeletonUploadSkip()
    const bone = new THREE.Bone()
    const skeleton = new THREE.Skeleton([bone])
    skeleton.computeBoneTexture()
    const first = skeleton.boneTexture
    bone.updateMatrixWorld(true)
    skeleton.update()
    bone.position.set(1, 2, 3)
    bone.updateMatrixWorld(true)
    skeleton.update()
    return { swapped: skeleton.boneTexture !== first, width: skeleton.boneTexture.image.width, height: skeleton.boneTexture.image.height, firstValues: Array.from(skeleton.boneTexture.image.data.slice(12, 15)).map((v) => Math.round(v * 1000) / 1000) }
  })

  await record(SCENE_SETUP_CASE_LABELS[7], () => {
    const texture = { image: { width: 1024, height: 512 }, needsUpdate: false }
    const out = api.limitTextureSize(texture)
    return { same: out === texture, width: out.image.width, height: out.image.height, needsUpdate: out.needsUpdate }
  })

  await record(SCENE_SETUP_CASE_LABELS[8], () => {
    const texture = { image: { width: 4096, height: 1024 }, needsUpdate: false }
    const out = api.limitTextureSize(texture)
    return { width: out.image.width, height: out.image.height, needsUpdate: out.needsUpdate, drawn: out.image.drawn === true }
  })

  await record(SCENE_SETUP_CASE_LABELS[9], async () => pick(await api.waitForManifestResidence(new Map(), null, 0)))

  await record(SCENE_SETUP_CASE_LABELS[10], async () => {
    const meshes = new Map([['m', { userData: { modelUrl: 'a.glb' } }]])
    return pick(await api.waitForManifestResidence(meshes, { modelUrls: ['a.glb'] }, 0))
  })

  await record(SCENE_SETUP_CASE_LABELS[11], async () => {
    const meshes = new Map([['m', { userData: { modelUrl: 'a.glb' } }]])
    return pick(await api.waitForManifestResidence(meshes, { modelUrls: ['a.glb', 'b.glb'] }, 0))
  })

  await record(SCENE_SETUP_CASE_LABELS[12], () => {
    const renderer = { isWebGPURenderer: false, onError: undefined }
    api.installStuckPipelineRecovery(renderer, new THREE.Scene())
    return { onErrorInstalled: typeof renderer.onError === 'function' }
  })

  await record(SCENE_SETUP_CASE_LABELS[13], () => {
    const scene = new THREE.Scene()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    scene.add(mesh)
    const renderer = { isWebGPURenderer: true }
    api.installStuckPipelineRecovery(renderer, scene)
    renderer.onError({ message: 'RenderPipeline stalled' })
    renderer.onError({ message: 'CommandBuffer stalled' })
    return { count: api.host.__pipelineErrors, materialNeedsUpdate: mesh.material.needsUpdate }
  })

  await record(SCENE_SETUP_CASE_LABELS[14], () => api.constants)

  return { rows }
}
