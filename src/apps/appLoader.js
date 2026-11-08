const BLOCKED_PATTERNS = [
  'process.exit', 'child_process', 'require(', '__proto__',
  'Object.prototype', 'globalThis', 'eval(', 'import('
]

const REFUSAL_BLOCKED_PATTERN = 'app-source-blocked-pattern'

const FILE_CHANGE_DEBOUNCE_MS = 100

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

export function createAppLoader({ runtime, host, dirs = ['./apps'], log = console, onReload = null, onTreeChange = null }) {
  if (typeof runtime?.registerApp !== 'function') throw new TypeError('createAppLoader needs runtime.registerApp')
  for (const method of ['join', 'exists', 'readFile', 'listDir', 'importModule']) {
    if (typeof host?.[method] !== 'function') throw new TypeError('createAppLoader needs host.' + method)
  }
  const loaded = new Map()
  const watchers = []
  const debounceTimers = new Map()

  function validate(source, name) {
    for (const pattern of BLOCKED_PATTERNS) {
      if (source.includes(pattern)) {
        log.error('[AppLoader] blocked pattern "' + pattern + '" in ' + name)
        return { reasonCode: REFUSAL_BLOCKED_PATTERN, app: name, pattern }
      }
    }
    return null
  }

  async function resolvePath(name) {
    for (const dir of dirs) {
      const flat = host.join(dir, name + '.js')
      if (await host.exists(flat)) return flat
      const folder = host.join(dir, name, 'index.js')
      if (await host.exists(folder)) return folder
    }
    return null
  }

  async function evaluate(filePath) {
    try {
      const mod = await host.importModule(filePath)
      return mod.default || mod
    } catch (error) {
      log.error('[AppLoader] syntax/eval error in "' + filePath + '": ' + error.message)
      return null
    }
  }

  async function loadApp(name, refusals = null) {
    const filePath = await resolvePath(name)
    if (!filePath) return null
    try {
      const source = await host.readFile(filePath)
      const refusal = validate(source, name)
      if (refusal) {
        if (refusals) refusals.push(refusal)
        return null
      }
      const appDef = await evaluate(filePath)
      if (!appDef) return null
      runtime.registerApp(name, appDef)
      loaded.set(name, { filePath, source, clientCode: source })
      return appDef
    } catch (error) {
      log.error('[AppLoader] failed to load "' + name + '": ' + error.message)
      log.error('  file: ' + filePath)
      return null
    }
  }

  async function loadAll() {
    const seen = new Set()
    const result = { loaded: [], failed: [], refusals: [] }
    for (const dir of dirs) {
      const entries = (await host.listDir(dir)).slice().sort(byName)
      for (const entry of entries) {
        let name = null
        if (entry.isFile && entry.name.endsWith('.js')) name = entry.name.slice(0, -3)
        else if (entry.isDirectory && (await host.exists(host.join(dir, entry.name, 'index.js')))) name = entry.name
        if (!name || seen.has(name)) continue
        seen.add(name)
        if (await loadApp(name, result.refusals)) result.loaded.push(name)
        else result.failed.push(name)
      }
    }
    return result
  }

  function loadFromModule(name, appModule) {
    const appDef = appModule && appModule.default ? appModule.default : appModule
    if (!appDef || typeof appDef !== 'object') {
      log.error('[AppLoader] loadFromModule: ' + name + ' has no valid default export')
      return null
    }
    runtime.registerApp(name, appDef)
    loaded.set(name, { source: null, clientCode: null, filePath: null })
    return appDef
  }

  function nameOfChange(filename) {
    const parts = filename.replace(/\\/g, '/').split('/')
    return parts.length > 1 ? parts[0] : parts[0].slice(0, -3)
  }

  async function reloadApp(name) {
    log.log('[AppLoader] reloading ' + name)
    const appDef = await loadApp(name)
    if (!appDef) return
    runtime.queueReload(name, appDef, onReload ? (n) => onReload(n, loaded.get(n)?.clientCode) : null)
    log.log('[AppLoader] queued hot reload ' + name)
  }

  function debounceFileChange(name) {
    if (debounceTimers.has(name)) host.clearTimer(debounceTimers.get(name))
    const timer = host.setTimer(() => {
      debounceTimers.delete(name)
      reloadApp(name).catch((error) => log.error('[AppLoader] reload error for ' + name + ': ' + error.message))
    }, FILE_CHANGE_DEBOUNCE_MS)
    debounceTimers.set(name, timer)
  }

  function onWatchEvent(filename) {
    if (onTreeChange) onTreeChange(filename)
    if (!filename.endsWith('.js')) return
    debounceFileChange(nameOfChange(filename))
  }

  async function watchAll() {
    if (typeof host.watch !== 'function' || typeof host.setTimer !== 'function' || typeof host.clearTimer !== 'function') {
      throw new TypeError('watchAll needs host.watch, host.setTimer and host.clearTimer')
    }
    if (typeof runtime.queueReload !== 'function') throw new TypeError('watchAll needs runtime.queueReload')
    for (const dir of dirs) {
      if (!(await host.exists(dir))) {
        log.debug('[AppLoader] skipping watch for missing directory: ' + dir)
        continue
      }
      watchers.push(host.watch(dir, onWatchEvent, (error) => log.error('[AppLoader] watch error: ' + error.message)))
    }
  }

  function stopWatching() {
    for (const stop of watchers.splice(0)) stop()
    for (const timer of debounceTimers.values()) host.clearTimer(timer)
    debounceTimers.clear()
  }

  return {
    loadAll,
    loadApp,
    loadFromModule,
    resolvePath,
    validate,
    watchAll,
    stopWatching,
    getLoaded: () => Array.from(loaded.keys()),
    getClientModules() {
      const modules = {}
      for (const [name, data] of loaded) if (data.clientCode) modules[name] = data.clientCode
      return modules
    },
    getClientModule: (name) => loaded.get(name)?.clientCode || null,
  }
}
