const STUB = new URL('./hotQueueAppContextStub.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === './AppContext.js' && context.parentURL?.endsWith('/apps/HotReloadQueue.js')) {
    return { url: STUB, shortCircuit: true, format: 'module' }
  }
  return nextResolve(specifier, context)
}
