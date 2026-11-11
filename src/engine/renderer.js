import { instantiateWithinBudget } from './glueTier.js'

export const RENDER_BACKEND = Object.freeze({ WEBGPU: 0, WEBGL2: 1 })

export const RENDER_BACKEND_NAMES = Object.freeze(['webgpu', 'webgl2'])

export const RENDER_CANVAS_ID = 'engine-canvas'

export const RENDER_MODEL_PATH = Object.freeze({ FORWARD: 0, VISIBILITY: 1 })

export const RENDER_MODEL_PATH_NAMES = Object.freeze(['forward', 'visibility'])

export const RENDER_LAYOUT = Object.freeze({
  CAMERA_BYTES: 224,
  CAMERA_PLANES_WORD: 0,
  CAMERA_VIEW_PROJ_WORD: 24,
  CAMERA_EYE_WORD: 40,
  CAMERA_COUNTS_WORD: 44,
  CAMERA_CLASS_MATERIAL_WORD: 52,
  PLACEMENT_WORDS: 14,
  LIGHT_WORDS: 8,
  MATERIAL_WORDS: 10,
  MATERIAL_ALBEDO_WORD: 9,
  PROP_CLASSES: 4,
  BODY_SLOTS: 10240,
  PAGE_LAYERS: 256,
  ALBEDO_LAYERS: 64,
  ALBEDO_SIDE: 16,
  LIGHT_SLOTS: 256,
  MATERIAL_SLOTS: 256,
})

const DEFAULT_GLUE = new URL('../../engine/out/engine-core-512mib.mjs', import.meta.url).href

const WEBGL2_MODEL_LIMITS = Object.freeze([2048, 256, 268435456, 4, 0])

const MODEL_BIND_REFUSALS = Object.freeze({
  '-1': 'the device limits fit no device tier',
  '-2': 'the arena cannot hold the pool of any tier the device fits',
  '-3': 'the model pool refused the planned layout',
  '-4': 'the model pool is already bound',
  '-5': 'the engine budget holds a smaller model tier than the device plans, so the bind is refused rather than lowered',
})

const modelLimits = (device, navigatorLike) => {
  const { maxTextureDimension2D, maxTextureArrayLayers, maxBufferSize, maxStorageBufferBindingSize } = device.limits
  const texelBytes = device.features.has('texture-compression-bc') ? 1 : 4
  const deviceMemoryBytes = navigatorLike.deviceMemory ? navigatorLike.deviceMemory * 1073741824 : 0
  const poolBytes = Math.min(maxBufferSize, maxStorageBufferBindingSize)
  return [maxTextureDimension2D, maxTextureArrayLayers, poolBytes, texelBytes, deviceMemoryBytes]
}

export const chooseBackend = (requested, hasWebGpu) => {
  if (requested === 'webgpu') {
    if (!hasWebGpu) throw new Error('WebGPU was requested but navigator.gpu is absent')
    return RENDER_BACKEND.WEBGPU
  }
  if (requested === 'webgl2') return RENDER_BACKEND.WEBGL2
  if (requested !== 'auto') throw new RangeError('unknown renderer backend: ' + String(requested))
  return hasWebGpu ? RENDER_BACKEND.WEBGPU : RENDER_BACKEND.WEBGL2
}

const requestWebGpuDevice = async (gpu) => {
  const adapter = await gpu.requestAdapter()
  if (!adapter) throw new Error('WebGPU returned no adapter')
  const requiredFeatures = adapter.features.has('texture-compression-bc') ? ['texture-compression-bc'] : []
  const requiredLimits = {
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
  }
  return adapter.requestDevice({ requiredFeatures, requiredLimits })
}

const ensureCanvasId = (canvas) => {
  if (!canvas.id) canvas.id = RENDER_CANVAS_ID
  if (canvas.id !== RENDER_CANVAS_ID) throw new RangeError('the render canvas id must be ' + RENDER_CANVAS_ID)
}

const expectWords = (array, words, label) => {
  if (array.length !== words) throw new RangeError(label + ' takes ' + words + ' values')
}

const finite = (value, label) => {
  if (!Number.isFinite(value)) throw new TypeError(label + ' must be a finite number')
  return value
}

export const createRenderer = (module, backend, { modelTier = -1, device = null, deviceLost = null } = {}) => {
  const f32 = module.HEAPF32
  const u32 = module.HEAPU32
  const u8 = module.HEAPU8
  const camera = module._engine_render_camera() >> 2
  const placements = module._engine_render_placements() >> 2
  const lights = module._engine_render_lights() >> 2
  const lightPositions = module._engine_render_light_positions() >> 3
  const f64 = module.HEAPF64
  const materials = module._engine_render_material_table() >> 2
  const classes = module._engine_render_body_classes()
  const albedo = module._engine_render_albedo_staging()
  const L = RENDER_LAYOUT

  return Object.freeze({
    module,
    backend,
    backendName: RENDER_BACKEND_NAMES[backend],
    modelTier,
    device,
    deviceLost,

    setCamera({ viewProj, eye }) {
      expectWords(viewProj, 16, 'viewProj')
      expectWords(eye, 3, 'eye')
      status(module._engine_render_set_origin(finite(eye[0], 'eye'), finite(eye[1], 'eye'), finite(eye[2], 'eye')), 'set origin')
      for (let i = 0; i < 16; i++) f32[camera + L.CAMERA_VIEW_PROJ_WORD + i] = finite(viewProj[i], 'viewProj')
      for (let i = 0; i < 3; i++) f32[camera + L.CAMERA_EYE_WORD + i] = 0
    },

    setClassMaterial(cls, material) {
      if (!Number.isInteger(cls) || cls < 0 || cls >= L.PROP_CLASSES) throw new RangeError('prop class out of range: ' + cls)
      u32[camera + L.CAMERA_CLASS_MATERIAL_WORD + cls] = material
    },

    setBodyClasses(classList) {
      if (!(classList instanceof Uint8Array) || classList.length > L.BODY_SLOTS) throw new TypeError('body classes take a Uint8Array of at most ' + L.BODY_SLOTS)
      u8.set(classList, classes)
    },

    placePage(slot, origin, uEdge, vEdge) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= L.PAGE_LAYERS) throw new RangeError('page slot out of range: ' + slot)
      expectWords(origin, 3, 'origin')
      expectWords(uEdge, 3, 'uEdge')
      expectWords(vEdge, 3, 'vEdge')
      status(module._engine_render_place_page(slot, origin[0], origin[1], origin[2], uEdge[0], uEdge[1], uEdge[2], vEdge[0], vEdge[1], vEdge[2]), 'place page')
    },

    unplacePage(slot) {
      status(module._engine_render_unplace_page(slot), 'unplace page')
    },

    markPage(slot) {
      status(module._engine_render_mark_page(slot), 'mark page')
    },

    setLight(slot, { position, radius, colour, intensity }) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= L.LIGHT_SLOTS) throw new RangeError('light slot out of range: ' + slot)
      expectWords(position, 3, 'light position')
      expectWords(colour, 3, 'light colour')
      const base = lights + slot * L.LIGHT_WORDS
      for (let i = 0; i < 3; i++) f64[lightPositions + slot * 3 + i] = finite(position[i], 'light position')
      f32[base + 3] = finite(radius, 'light radius')
      for (let i = 0; i < 3; i++) f32[base + 4 + i] = finite(colour[i], 'light colour')
      f32[base + 7] = finite(intensity, 'light intensity')
    },

    setLightCount(count) {
      status(module._engine_render_set_light_count(count), 'light count')
    },

    setModelPath(path) {
      const mode = RENDER_MODEL_PATH_NAMES.indexOf(path)
      if (mode < 0) throw new RangeError('model path must be one of ' + RENDER_MODEL_PATH_NAMES.join(', '))
      status(module._engine_render_set_model_path(mode), 'set model path')
    },

    setOcclusion(on) {
      if (typeof on !== 'boolean') throw new TypeError('occlusion takes a boolean')
      status(module._engine_render_set_occlusion(on ? 1 : 0), 'set occlusion')
    },

    get modelPath() {
      return RENDER_MODEL_PATH_NAMES[module._engine_render_model_path()]
    },

    get effectiveModelPath() {
      return RENDER_MODEL_PATH_NAMES[module._engine_render_model_path_effective()]
    },

    get occlusion() {
      return module._engine_render_occlusion() === 1
    },

    clusterStride() {
      return module._engine_models_cluster_stride()
    },

    setMaterial(slot, { colour, roughness, metallic, emissive, albedoLayer }) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= L.MATERIAL_SLOTS) throw new RangeError('material slot out of range: ' + slot)
      expectWords(colour, 4, 'material colour')
      expectWords(emissive, 3, 'material emissive')
      const base = materials + slot * L.MATERIAL_WORDS
      for (let i = 0; i < 4; i++) f32[base + i] = finite(colour[i], 'material colour')
      f32[base + 4] = finite(roughness, 'material roughness')
      f32[base + 5] = finite(metallic, 'material metallic')
      for (let i = 0; i < 3; i++) f32[base + 6 + i] = finite(emissive[i], 'material emissive')
      u32[base + L.MATERIAL_ALBEDO_WORD] = albedoLayer
    },

    setAlbedo(layer, rgba) {
      if (!Number.isInteger(layer) || layer < 1 || layer >= L.ALBEDO_LAYERS) throw new RangeError('albedo layer out of range: ' + layer)
      const bytes = L.ALBEDO_SIDE * L.ALBEDO_SIDE * 4
      if (!(rgba instanceof Uint8Array) || rgba.length !== bytes) throw new TypeError('albedo takes ' + bytes + ' RGBA bytes')
      u8.set(rgba, albedo + layer * bytes)
      status(module._engine_render_commit_albedo(layer), 'commit albedo')
    },

    frame() {
      return module._engine_render_frame()
    },

    stats() {
      return Object.freeze({
        backend: RENDER_BACKEND_NAMES[backend],
        frames: Number(module._engine_render_frames()),
        apiCallsLastFrame: module._engine_render_api_calls_last_frame(),
        checksum: module._engine_render_checksum(),
        visible: Object.freeze(Array.from({ length: L.PROP_CLASSES }, (_, cls) => module._engine_render_visible(cls))),
        pages: module._engine_render_pages(),
        uploads: module._engine_render_uploads(),
        lights: module._engine_render_light_count(),
        vegetationDraws: module._engine_render_vegetation_draws ? module._engine_render_vegetation_draws() : null,
        vegetationInstances: module._engine_render_vegetation_instances ? module._engine_render_vegetation_instances() : null,
        createsAfterSeal: module._engine_render_creates_after_seal(),
        allocationsSinceWarmup: module._engine_render_allocations_since_warmup(),
        modelPath: RENDER_MODEL_PATH_NAMES[module._engine_render_model_path_effective()],
      })
    },

    markWarmup() {
      module._engine_mark_warmup()
    },
  })
}

export const loadRenderer = async ({ glue = DEFAULT_GLUE, canvas, navigatorLike = globalThis.navigator, requested = 'auto', players = 64, workers = 1, budgetBytes = 67108864, beforeSeal = null, models = true } = {}) => {
  if (!canvas) throw new TypeError('loadRenderer needs a canvas')
  ensureCanvasId(canvas)
  const backend = chooseBackend(requested, Boolean(navigatorLike && navigatorLike.gpu))
  const options = { canvas }
  const device = backend === RENDER_BACKEND.WEBGPU ? await requestWebGpuDevice(navigatorLike.gpu) : null
  if (device) options.preinitializedWebGPUDevice = device
  const factory = (await import(glue)).default
  const module = await factory(options)
  status(module._engine_init(players, workers, budgetBytes), 'engine_init')
  const modelTier = models ? bindModelPool(module, device, navigatorLike) : -1
  status(module._engine_render_init(backend), 'engine_render_init')
  if (beforeSeal) beforeSeal(module)
  status(module._engine_render_seal(), 'engine_render_seal')
  const deviceLost = device ? device.lost.then((info) => ({ reason: info.reason, message: info.message })) : null
  return createRenderer(module, backend, { modelTier, device, deviceLost })
}

const bindModelPool = (module, device, navigatorLike) => {
  const tier = module._engine_models_bind_plan(...(device ? modelLimits(device, navigatorLike) : WEBGL2_MODEL_LIMITS))
  if (tier < 0) throw new Error('engine_models_bind_plan refused: ' + (MODEL_BIND_REFUSALS[tier] ?? 'unknown status ' + tier))
  return tier
}

const status = (code, what) => {
  if (code !== 0) throw new Error(what + ' failed with engine status ' + code)
  return code
}

export const loadRendererWithinBudget = ({ glueFor, budgetBytes, ...rest }) => {
  if (typeof glueFor !== 'function') throw new TypeError('loadRendererWithinBudget needs glueFor(tierMiB)')
  return instantiateWithinBudget({ budgetBytes, instantiate: (step) => loadRenderer({ ...rest, glue: glueFor(step.tierMiB), budgetBytes: step.budgetBytes }) })
}
