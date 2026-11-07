const kindOf = (value) => Object.prototype.toString.call(value).slice(8, -1)

export class SendContractError extends Error {
  constructor(detail) {
    super(detail)
    this.name = 'SendContractError'
  }
}

const requirePostFunction = (postFn, who) => {
  if (typeof postFn !== 'function') {
    throw new SendContractError(`${who} reaches the wire only through postFn; got ${kindOf(postFn)}, so no send can ever reach the wire`)
  }
  return postFn
}

export const wireBufferOf = (data, who) => {
  if (data instanceof ArrayBuffer) return data
  if (data instanceof Uint8Array) {
    const wholeBuffer = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    return wholeBuffer ? data.buffer : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  }
  throw new SendContractError(`${who}.send() accepts only Uint8Array or ArrayBuffer; got ${kindOf(data)}`)
}

export const createWorkerSender = (postFn) => {
  const post = requirePostFunction(postFn, 'WorkerTransport')
  return (data, messageType) => {
    const buffer = wireBufferOf(data, 'WorkerTransport')
    post({ type: 'SEND_CLIENT', data: buffer, mt: messageType }, [buffer])
    return true
  }
}

export const createPeerSender = (peerId, postFn) => {
  const post = requirePostFunction(postFn, 'PeerTransport')
  return (data, messageType) => {
    const buffer = wireBufferOf(data, 'PeerTransport')
    post({ type: 'PEER_SEND', peerId, data: buffer, mt: messageType }, [buffer])
    return true
  }
}
