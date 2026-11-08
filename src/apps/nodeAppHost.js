import { access, readdir, readFile as readText } from 'node:fs/promises'
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
  }
}
