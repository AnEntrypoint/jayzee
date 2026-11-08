import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runFsr1Scenario } from './lib/fsr1Scenario.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['client/core/FSR1.js']
const sha256 = (file) => createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex')
const commit = execFileSync('git', ['log', '-1', '--format=%h', '--', ...files], { cwd: spointRoot }).toString().trim()

const mapped = {
  three: import.meta.resolve('three'),
  'three/tsl': import.meta.resolve('three/tsl'),
  'three/webgpu': import.meta.resolve('three/webgpu'),
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(mapped, specifier)) return { url: mapped[specifier], shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
const fsrMod = await import(pathToFileURL(join(spointRoot, 'client/core/FSR1.js')).href)
const controlsMod = await import(pathToFileURL(join(spointRoot, 'client/core/RenderControls.js')).href)
const keys = ['fsr1', 'fsr1Sharpness', 'dpr']
const controls = Object.fromEntries(keys.map((k) => [k, controlsMod.RenderControls.get(k)]))

const overrides = {}
const readControl = controlsMod.RenderControls.get
controlsMod.RenderControls.get = (key) => (Object.hasOwn(overrides, key) ? overrides[key] : readControl(key))

const withDisplay = (display, fn) => {
  if (!display) return fn()
  globalThis.window = { devicePixelRatio: display.devicePixelRatio }
  try { return fn() } finally { delete globalThis.window }
}

const { rows } = runFsr1Scenario({
  set: (key, value) => { overrides[key] = value },
  make: (renderer) => new fsrMod.FSR1(renderer),
  buildNodes: (display) => fsrMod.buildFSR1Nodes().map((node) => ({ ...node, shouldRun: (ctx) => withDisplay(display, () => node.shouldRun(ctx)) })),
  install: (ctx, renderer) => fsrMod.installFSR1(ctx, renderer),
})

const fixture = { source: { commit, files, sha256: Object.fromEntries(files.map((f) => [f, sha256(f)])) }, controls, rows }
const out = join(here, 'fixtures', 'spoint', 'fsr1.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + String.fromCharCode(10))
console.log('wrote ' + out + ' with ' + rows.length + ' rows at ' + commit + ' controls ' + JSON.stringify(controls))
