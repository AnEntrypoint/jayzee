import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { instantiate } from 'jz/interop'

const WASM = fileURLToPath(new URL('../../dist/kernel.wasm', import.meta.url))

let kernel = null

export const loadKernel = () => {
  if (kernel === null) {
    if (!existsSync(WASM)) throw new Error('kernel is not built: run npm run build:kernel')
    kernel = instantiate(readFileSync(WASM)).exports
  }
  return kernel
}
