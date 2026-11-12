import { parentPort } from 'node:worker_threads'

globalThis.self = {
  postMessage: (message, transfer) => parentPort.postMessage(message, transfer),
  set onmessage(handler) { parentPort.on('message', (data) => handler({ data })) },
}

await import('../../src/transport/browserServerEntry.js')
