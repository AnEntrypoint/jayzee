import { releaseEngineModule } from '../../src/engine/EngineWorld.js'

const collect = () => {
  if (typeof globalThis.gc === 'function') globalThis.gc()
}

export const releaseWorld = async (world) => {
  const workers = await world.release()
  collect()
  return workers
}

export const releaseModule = async (module) => {
  const workers = await releaseEngineModule(module)
  collect()
  return workers
}
