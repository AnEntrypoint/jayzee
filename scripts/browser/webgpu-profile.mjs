import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WEBGPU_LABS = ['enable-unsafe-webgpu', 'enable-vulkan@1', 'enable-webgpu-developer-features']

export function profileIsOwned(userDataDir, projectRoot) {
  return resolve(userDataDir) === resolve(projectRoot, '.playwriter', 'browser-profile')
}

export function seedWebgpuLabs(userDataDir) {
  const dir = resolve(userDataDir)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'Local State')
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  const browser = state.browser && typeof state.browser === 'object' ? state.browser : {}
  const before = Array.isArray(browser.enabled_labs_experiments) ? browser.enabled_labs_experiments : []
  const labs = [...before, ...WEBGPU_LABS.filter((flag) => !before.includes(flag))]
  if (labs.length === before.length && existsSync(file)) return { changed: false, file, labs }
  writeFileSync(file, JSON.stringify({ ...state, browser: { ...browser, enabled_labs_experiments: labs } }))
  return { changed: true, file, labs }
}

const run = () => {
  const [root, ...args] = process.argv.slice(2)
  const flag = args.find((arg) => arg.startsWith('--user-data-dir='))
  if (!flag) {
    console.log(JSON.stringify({ seeded: false, reason: 'no user-data-dir argument' }))
    return
  }
  const dir = flag.slice('--user-data-dir='.length)
  if (!profileIsOwned(dir, root)) {
    console.log(JSON.stringify({ seeded: false, reason: 'not the project profile', dir }))
    return
  }
  const result = seedWebgpuLabs(dir)
  console.log(JSON.stringify({ seeded: true, changed: result.changed, file: result.file, labs: result.labs }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run()
