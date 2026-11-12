import { parentPort, workerData } from 'node:worker_threads'
import { TRANSFORM_RING_CAPACITY, createWorkerEntryHost } from './workerEntryHost.js'
import { createRingBuffer } from './transformRing.js'

if (parentPort === null) throw new Error('nodeWorkerEntry must run inside a worker thread')
if (typeof workerData?.boot !== 'string') throw new TypeError('nodeWorkerEntry needs workerData.boot, the URL of a module that exports boot')

const allocateRing = () => (workerData.ring === false ? null : createRingBuffer(TRANSFORM_RING_CAPACITY))

const module = await import(workerData.boot)
if (typeof module.boot !== 'function') throw new TypeError('the boot module must export a boot function')

const host = createWorkerEntryHost({
  post: (message, transfer) => parentPort.postMessage(message, transfer ?? []),
  boot: module.boot,
  allocateRing,
  log: { error: (line) => process.stderr.write(line + '\n') },
})
host.attach(parentPort)
