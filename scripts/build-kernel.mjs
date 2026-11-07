import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileKernel } from '../src/kernel/build.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist', 'kernel.wasm')
const started = performance.now()
const bytes = compileKernel()
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, bytes)
console.log('kernel.wasm ' + bytes.byteLength + ' bytes in ' + Math.round(performance.now() - started) + ' ms')
