const kindOf = (value) => Object.prototype.toString.call(value).slice(8, -1)

const wireBufferOf = (data) => {
  if (data instanceof ArrayBuffer) return data
  if (data instanceof Uint8Array) {
    return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? data.buffer
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }
  throw new TypeError('WorkerTransport.send() accepts only Uint8Array or ArrayBuffer; got ' + kindOf(data))
}

export function createWorkerTransport(postFn) {
  if (typeof postFn !== 'function') {
    throw new TypeError('WorkerTransport reaches the wire only through postFn; got ' + kindOf(postFn))
  }
  const closeListeners = []
  let ready = true
  return {
    type: 'worker',
    get ready() {
      return ready
    },
    send(data, mt) {
      const buffer = wireBufferOf(data)
      if (!ready) return false
      postFn({ type: 'SEND_CLIENT', data: buffer, mt }, [buffer])
      return true
    },
    onClose(listener) {
      closeListeners.push(listener)
    },
    close() {
      ready = false
      for (const listener of closeListeners) listener()
    },
  }
}
