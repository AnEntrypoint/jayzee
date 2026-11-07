import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { instantiate } from 'jz/interop'

const WASM = fileURLToPath(new URL('../../dist/kernel.wasm', import.meta.url))

let compiled = null

export const instantiateKernel = () => {
  if (compiled === null) {
    if (!existsSync(WASM)) throw new Error('kernel is not built: run npm run build:kernel')
    compiled = new WebAssembly.Module(readFileSync(WASM))
  }
  return instantiate(compiled)
}
