import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createWorkerTransport } from '../src/transport/workerTransport.js'

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'transport', 'workerTransport.js')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}
const recordingPost = () => {
  const calls = []
  return { calls, post: (message, transfer) => calls.push({ message, transfer }) }
}

gate('a Uint8Array with a full view is posted as its own buffer and transferred', () => {
  const { calls, post } = recordingPost()
  const transport = createWorkerTransport(post)
  const bytes = new Uint8Array([1, 2, 3])
  same(transport.send(bytes, 2), true, 'send result')
  same(calls[0].message.type, 'SEND_CLIENT', 'message type')
  same(calls[0].message.data, bytes.buffer, 'posted buffer identity')
  same(calls[0].message.mt, 2, 'message tag')
  same(calls[0].transfer[0], bytes.buffer, 'transfer list')
})

gate('a view into a larger buffer is posted as a copy of exactly its bytes', () => {
  const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9, 9])
  const view = new Uint8Array(backing.buffer, 2, 3)
  const { calls, post } = recordingPost()
  createWorkerTransport(post).send(view, 0)
  sameJson(Array.from(new Uint8Array(calls[0].message.data)), [1, 2, 3], 'posted bytes')
  same(calls[0].message.data === backing.buffer, false, 'posted the whole backing buffer')
  mustReject(() => sameJson(Array.from(new Uint8Array(calls[0].message.data)), [9, 9, 1, 2, 3, 9, 9, 9], 'whole backing buffer'))
})

gate('an ArrayBuffer is posted as itself', () => {
  const { calls, post } = recordingPost()
  const buffer = new ArrayBuffer(4)
  createWorkerTransport(post).send(buffer, 1)
  same(calls[0].message.data, buffer, 'posted ArrayBuffer identity')
})

gate('payloads other than Uint8Array or ArrayBuffer are refused and never posted as empty frames', () => {
  const { calls, post } = recordingPost()
  const transport = createWorkerTransport(post)
  for (const bad of ['text', [1, 2, 3], new DataView(new ArrayBuffer(4)), null, undefined]) {
    mustReject(() => transport.send(bad, 0))
  }
  same(calls.length, 0, 'posts after refusals')
})

gate('a postFn that is not callable is refused at construction', () => {
  mustReject(() => createWorkerTransport('postMessage'))
  mustReject(() => createWorkerTransport(null))
})

gate('a closed worker transport refuses sends and tells its close listeners once', () => {
  const { calls, post } = recordingPost()
  const transport = createWorkerTransport(post)
  let closes = 0
  transport.onClose(() => {
    closes++
  })
  transport.close()
  same(transport.ready, false, 'ready after close')
  same(transport.send(new Uint8Array(1), 0), false, 'send after close')
  same(calls.length, 0, 'posts after close')
  same(closes, 1, 'close listeners')
})

gate('the worker transport module is comment-free and reads no worker or window global', () => {
  const text = readFileSync(sourcePath, 'utf8')
  assert(!text.includes('//') && !text.includes('/*'), 'comment marker')
  const words = new Set(text.split(/[^A-Za-z0-9_$]/))
  for (const token of ['self', 'postMessage', 'Worker', 'window', 'globalThis', 'process', 'require']) {
    assert(!words.has(token), 'uses ' + token)
  }
})

finish()
