export const createDecodeWorker = (url = new URL('./decodeWorker.js', import.meta.url)) => {
  const worker = new Worker(url, { type: 'module' })
  const pending = new Map()
  let nextId = 1

  worker.onmessage = ({ data }) => {
    const waiting = pending.get(data.id)
    pending.delete(data.id)
    if (data.error !== undefined) waiting.reject(new Error(data.error))
    else waiting.resolve(data.result)
  }

  const call = (message, transfer) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    worker.postMessage({ ...message, id }, transfer)
  })

  return {
    decodeVertices: (bytes, count, size, filter) => call({ kind: 'vertices', bytes, count, size, filter }, [bytes.buffer]).then((result) => result.bytes),
    decodeIndices: (bytes, count, size) => call({ kind: 'indices', bytes, count, size }, [bytes.buffer]).then((result) => result.bytes),
    transcodeKtx2: (bytes) => call({ kind: 'ktx2', bytes }, [bytes.buffer]),
    close: () => worker.terminate(),
  }
}

export const uploadModelSlot = (module, handle, vertices, indices) => {
  const vertexCount = module._engine_models_vertex_count(handle)
  const indexCount = module._engine_models_index_count(handle)
  if (vertexCount === 0 || indexCount === 0) throw new Error('model slot is not live')
  const stride = 32
  if (vertices.length !== vertexCount * stride) throw new RangeError('decoded vertices take ' + vertexCount * stride + ' bytes')
  if (indices.length !== indexCount * 4) throw new RangeError('decoded indices take ' + indexCount * 4 + ' bytes')
  const vertexPtr = module._engine_models_vertex_ptr(handle)
  const indexPtr = module._engine_models_index_ptr(handle)
  module.HEAPU8.set(vertices, vertexPtr)
  module.HEAPU8.set(indices, indexPtr)
  const status = module._engine_models_mark_dirty(handle)
  if (status !== 0) throw new Error('engine_models_mark_dirty failed with status ' + status)
}
