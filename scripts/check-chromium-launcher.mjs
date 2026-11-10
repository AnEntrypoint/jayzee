import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const launcher = readFileSync(join(root, 'scripts/browser/chromium-webgpu.sh'), 'utf8')
const execLine = launcher.split('\n').find((line) => line.startsWith('exec '))

gate('the launcher starts Chromium with the WebGPU flags on the command line', () => {
  assert.ok(execLine, 'no exec line in the launcher')
  assert.ok(execLine.includes('--enable-unsafe-webgpu'), 'the WebGPU switch is missing')
  assert.ok(execLine.includes('--enable-features=Vulkan,WebGPUService'), 'the Vulkan and WebGPUService features are missing')
})

gate('the launcher passes the caller arguments after its own flags, so a caller can still override them', () => {
  assert.ok(execLine.indexOf('--enable-unsafe-webgpu') < execLine.indexOf('"$@"'))
})

gate('the launcher names no SwiftShader switch, which measured the CPU adapter', () => {
  assert.ok(!/swiftshader/i.test(execLine), 'a SwiftShader switch is on the exec line')
})

gate('the launcher still seeds the project profile labs before it starts Chromium', () => {
  assert.ok(launcher.includes('webgpu-profile.mjs'))
})

finish()
