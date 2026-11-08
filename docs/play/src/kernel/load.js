import { instantiate } from 'jz/interop'

let compiled = null

export const loadKernel = (bytes) => {
  compiled = new WebAssembly.Module(bytes)
  return compiled
}

const readKernelFromDisk = () => {
  const host = globalThis.process
  if (typeof host?.getBuiltinModule !== 'function') {
    throw new Error('kernel bytes are not loaded: call loadKernel(bytes) with the contents of kernel.wasm first')
  }
  const { existsSync, readFileSync } = host.getBuiltinModule('node:fs')
  const { fileURLToPath } = host.getBuiltinModule('node:url')
  const wasm = fileURLToPath(new URL('../../dist/kernel.wasm', import.meta.url))
  if (!existsSync(wasm)) throw new Error('kernel is not built: run npm run build:kernel')
  return readFileSync(wasm)
}

export const instantiateKernel = () => {
  if (compiled === null) loadKernel(readKernelFromDisk())
  return instantiate(compiled)
}
