import { access, readdir, readFile as readText, watch } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function createNodeAppHost({ now = Date.now } = {}) {
  return {
    join,
    async exists(path) {
      try {
        await access(path)
        return true
      } catch {
        return false
      }
    },
    readFile: (path) => readText(path, 'utf-8'),
    async listDir(dir) {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      return entries.map((entry) => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() }))
    },
    importModule: (filePath) => import(pathToFileURL(resolve(filePath)).href + '?t=' + now()),
    watch(dir, onEvent, onError) {
      const controller = new AbortController()
      ;(async () => {
        try {
          for await (const event of watch(dir, { recursive: true, signal: controller.signal })) {
            if (event.filename) onEvent(String(event.filename))
          }
        } catch (error) {
          if (error.name !== 'AbortError') onError(error)
        }
      })()
      return () => controller.abort()
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
  }
}
