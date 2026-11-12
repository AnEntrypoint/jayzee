import { loadKernel } from './src/kernel/load.js'
import { bindBrowserServer } from './src/transport/browserServer.js'

const base = new URL('./', import.meta.url)

bindBrowserServer(self, {
  now: () => performance.now(),
  timers: { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle) },
  importApp: (url) => import(url),
  prepare: async () => loadKernel(await (await fetch(new URL('./kernel.wasm', base))).arrayBuffer()),
  readModel: async (path) => {
    const response = await fetch(new URL(path, base))
    if (!response.ok) throw new Error('model ' + path + ' answered ' + response.status)
    return new Uint8Array(await response.arrayBuffer())
  },
})
