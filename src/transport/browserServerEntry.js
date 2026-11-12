import { bindBrowserServer } from './browserServer.js'

bindBrowserServer(self, {
  now: () => performance.now(),
  timers: { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle) },
  importApp: (url) => import(url),
})
