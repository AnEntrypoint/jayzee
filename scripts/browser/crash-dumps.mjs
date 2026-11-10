import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readMinidump } from './minidump.mjs'

const STACK_FRAMES = 16
const PROFILE_SWITCH = '--user-data-dir='

export const defaultDatabase = () => join(homedir(), '.config', 'chromium', 'Crash Reports')
export const projectDumpDir = (root) => join(root, '.playwriter', 'crash-dumps')
export const projectProfile = (root) => join(root, '.playwriter', 'browser-profile')

const objectsOf = (dump) => Object.assign({}, ...dump.moduleAnnotations.map((entry) => entry.objects))

export const profileOf = (dump) => {
  const value = Object.values(objectsOf(dump)).find((text) => String(text).startsWith(PROFILE_SWITCH))
  return value ? value.slice(PROFILE_SWITCH.length) : null
}

export const summariseDump = (bytes) => {
  const dump = readMinidump(bytes, { stackFrames: STACK_FRAMES })
  const objects = objectsOf(dump)
  const frame = (entry) => (entry.module ?? '?') + '+' + entry.offset
  return {
    ptype: objects.ptype ?? null,
    pid: objects.pid ?? null,
    profile: profileOf(dump),
    url: objects['url-chunk'] ?? null,
    signal: dump.crash ? dump.crash.signalName ?? String(dump.crash.signal) : null,
    signalCode: dump.crash ? dump.crash.signalCode : null,
    address: dump.crash ? dump.crash.address : null,
    instruction: dump.crash ? frame(dump.crash.instruction) : null,
    stack: dump.crash ? dump.crash.stack.map(frame) : [],
  }
}

const dumpFilesIn = (database) => ['pending', 'completed', 'new'].flatMap((state) => {
  const dir = join(database, state)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.dmp')).map((name) => join(dir, name))
})

export const collectCrashDumps = ({ root, sinceMs = 0, databases = [projectDumpDir(root), defaultDatabase()] }) => {
  const profile = projectProfile(root)
  const kept = join(projectDumpDir(root), 'collected')
  const found = []
  for (const database of databases) {
    for (const path of dumpFilesIn(database)) {
      const writtenMs = statSync(path).mtimeMs
      if (writtenMs < sinceMs) continue
      let summary = null
      try {
        summary = summariseDump(readFileSync(path))
      } catch (error) {
        if (error.code !== 'MINIDUMP_MALFORMED') throw error
        continue
      }
      if (summary.profile !== profile) continue
      const name = path.split('/').pop()
      const inProject = path.startsWith(projectDumpDir(root) + '/')
      const file = inProject ? path : join(kept, name)
      if (!inProject && !existsSync(file)) {
        mkdirSync(kept, { recursive: true })
        copyFileSync(path, file)
      }
      found.push({ file, source: database, written: new Date(writtenMs).toISOString(), ...summary })
    }
  }
  return found.sort((a, b) => a.written.localeCompare(b.written))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const sinceArg = process.argv.slice(2).find((arg) => arg.startsWith('--since='))
  const outArg = process.argv.slice(2).find((arg) => arg.startsWith('--out='))
  const found = collectCrashDumps({ root, sinceMs: sinceArg ? Date.parse(sinceArg.slice(8)) : 0 })
  const text = JSON.stringify(found, null, 1) + '\n'
  if (outArg) writeFileSync(resolve(root, outArg.slice(6)), text)
  console.log(text)
}
