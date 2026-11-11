import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileKernel } from '../src/kernel/build.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist', 'kernel.wasm')
const stamp = out + '.inputs'
const kernelDir = join(root, 'src', 'kernel')

const inputsDigest = () => {
  const hash = createHash('sha256')
  for (const name of readdirSync(kernelDir).sort()) hash.update(name + '\n').update(readFileSync(join(kernelDir, name)))
  hash.update(readFileSync(join(root, 'node_modules', 'jz', 'package.json')))
  hash.update(process.version)
  return hash.digest('hex')
}

const digest = inputsDigest()
if (!process.argv.includes('--force') && existsSync(out) && existsSync(stamp) && readFileSync(stamp, 'utf8') === digest) {
  console.log('kernel.wasm ' + readFileSync(out).byteLength + ' bytes, unchanged inputs, not rebuilt')
} else {
  const started = performance.now()
  const bytes = compileKernel()
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, bytes)
  writeFileSync(stamp, digest)
  console.log('kernel.wasm ' + bytes.byteLength + ' bytes in ' + Math.round(performance.now() - started) + ' ms')
}
