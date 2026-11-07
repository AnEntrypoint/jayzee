export const STORAGE_KEY = 'spoint.qualityPreset'
export const DEFAULT_PRESET = 'Medium'

export const PRESETS = {
  Low: {
    shadowsEnabled: false,
    dpr: null,
    dprAuto: false,
    fogFar: 100,
    vegWind: false,
    vegAllOff: false,
    vegHideFar: null,
    grassWind: false,
    halfResWater: false,
    thc: false,
    ssao: false,
    bloom: false,
    ssr: false,
    toneMappingExposure: 0.8,
  },
  Medium: {
    shadowsEnabled: true,
    dpr: null,
    dprAuto: false,
    fogFar: 200,
    vegWind: true,
    vegAllOff: false,
    vegHideFar: null,
    grassWind: true,
    halfResWater: false,
    thc: false,
    ssao: false,
    bloom: false,
    ssr: false,
    toneMappingExposure: 1.0,
  },
  High: {
    shadowsEnabled: true,
    dpr: null,
    dprAuto: false,
    fogFar: 300,
    vegWind: true,
    vegAllOff: false,
    vegHideFar: null,
    grassWind: true,
    halfResWater: false,
    thc: false,
    ssao: false,
    bloom: false,
    ssr: false,
    toneMappingExposure: 1.0,
  },
  Ultra: {
    shadowsEnabled: true,
    dpr: null,
    dprAuto: false,
    fogFar: 500,
    vegWind: true,
    vegAllOff: false,
    vegHideFar: null,
    grassWind: true,
    halfResWater: false,
    thc: false,
    ssao: false,
    bloom: false,
    ssr: true,
    toneMappingExposure: 1.0,
  },
}

export const PRESET_NAMES = Object.keys(PRESETS)

const CONTROL_ORDER = ['dprAuto', 'fogFar', 'vegWind', 'vegAllOff', 'vegHideFar', 'grassWind', 'halfResWater', 'thc', 'ssao', 'bloom', 'ssr']

const NO_DEVICE_INFO = { isMobile: false, hardwareConcurrency: -1, gpuTier: 'unknown', memoryMB: -1 }

export function clampDpr(v, devicePixelRatio = 1) {
  const cap = devicePixelRatio || 1
  return v == null ? cap : Math.max(0.5, Math.min(cap, v))
}

export function choosePreset(deviceInfo, devicePixelRatio = 1) {
  const info = deviceInfo || NO_DEVICE_INFO
  const isMobile = !!info.isMobile
  const hardwareConcurrency = info.hardwareConcurrency
  const gpuTier = info.gpuTier
  const memoryMB = info.memoryMB
  const dpr = devicePixelRatio || 1

  const isLowEnd = gpuTier === 'low' || (memoryMB > 0 && memoryMB < 2048) || (hardwareConcurrency > 0 && hardwareConcurrency < 4)
  const isHighEnd = gpuTier === 'medium' && !isMobile && hardwareConcurrency >= 8 && (memoryMB <= 0 || memoryMB >= 8192)

  if (isMobile || isLowEnd) return 'Low'
  if (isHighEnd && dpr >= 1.5) return 'Ultra'
  if (hardwareConcurrency >= 6 || dpr >= 1.5) return 'High'
  return DEFAULT_PRESET
}

export function createQualityPresets(opts = {}) {
  const sink = typeof opts.set === 'function' ? opts.set : null
  const storage = opts.storage || null
  const devicePixelRatio = opts.devicePixelRatio || 1
  const warn = typeof opts.warn === 'function' ? opts.warn : (...args) => console.warn(...args)
  const values = new Map()
  const write = (key, value) => {
    values.set(key, value)
    if (sink) sink(key, value)
  }

  let rendererHandle = null
  let current = null

  function apply(name, applyOpts = {}) {
    if (!Object.hasOwn(PRESETS, name)) {
      warn(`[quality-presets] unknown preset '${name}'. Valid: ${PRESET_NAMES.join(', ')}`)
      return false
    }
    const preset = PRESETS[name]
    const renderer = applyOpts.renderer || rendererHandle
    if (renderer) rendererHandle = renderer

    for (const key of CONTROL_ORDER) write(key, preset[key])
    if (preset.toneMappingExposure !== undefined) write('toneMappingExposure', preset.toneMappingExposure)

    if (renderer) {
      renderer.shadowMap.enabled = preset.shadowsEnabled
      const dpr = clampDpr(preset.dpr, devicePixelRatio)
      try { renderer.setPixelRatio(dpr) } catch (e) { warn('[quality-presets] setPixelRatio failed:', e?.message || e) }
      write('dpr', dpr)
    }

    current = name
    return true
  }

  function getPersisted() {
    if (!storage) return null
    try {
      const value = storage.getItem(STORAGE_KEY)
      return Object.hasOwn(PRESETS, value) ? value : null
    } catch (_) {
      return null
    }
  }

  function setPreset(name, applyOpts = {}) {
    const ok = apply(name, applyOpts)
    if (ok && storage) {
      try { storage.setItem(STORAGE_KEY, name) } catch (e) { warn('[quality-presets] storage write failed:', e?.message || e) }
    }
    return ok
  }

  function chooseInitialPreset(deviceInfo) {
    return choosePreset(deviceInfo, devicePixelRatio)
  }

  function autoApplyPersisted(applyOpts = {}) {
    const saved = getPersisted()
    if (saved) {
      apply(saved, applyOpts)
      return { name: saved, wasPersisted: true }
    }
    const name = chooseInitialPreset(applyOpts.deviceInfo)
    apply(name, applyOpts)
    return { name, wasPersisted: false }
  }

  return {
    names: PRESET_NAMES,
    presets: PRESETS,
    get current() { return current },
    apply,
    setPreset,
    getPersisted,
    chooseInitialPreset,
    autoApplyPersisted,
    controls: () => Object.fromEntries(values),
  }
}
