import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  NETCODE_OPCODES,
  NETCODE_OUTBOUND,
  RENDER_OPCODES,
  RENDER_OUTBOUND,
  createNetcodeDispatch,
  createRenderDispatch,
} from '../src/worker-dispatch-pure/workerDispatch.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(root, 'src', 'worker-dispatch-pure')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}

const calls = []
const netcodeHandlers = Object.fromEntries(NETCODE_OPCODES.map((opcode) => [opcode, (message) => {
  calls.push({ namespace: 'netcode', opcode, message })
  return 'netcode:' + opcode
}]))
const renderHandlers = Object.fromEntries(RENDER_OPCODES.map((opcode) => [opcode, (message) => {
  calls.push({ namespace: 'render', opcode, message })
  return 'render:' + opcode
}]))
const netcode = createNetcodeDispatch(netcodeHandlers)
const render = createRenderDispatch(renderHandlers)

gate('the netcode opcodes are the 13 uppercase type strings WorkerEntry.js accepts inbound', () => {
  sameJson(NETCODE_OPCODES, [
    'INIT', 'PEER_CONNECT', 'PEER_FRAME', 'PEER_LEFT', 'HMR_APP', 'HMR_TICK_HANDLER', 'SAVE_NOW',
    'DEBUG_COLLIDER_QUERY', 'DEBUG_COLLIDER_RAYS', 'CLIENT_MESSAGE', 'CLIENT_DISCONNECT', 'PEER_MESSAGE', 'PEER_DISCONNECT',
  ], 'netcode opcodes')
  same(NETCODE_OPCODES.length, 13, 'netcode opcode count')
})

gate('each netcode opcode reaches exactly its handler, once, with the message it was sent', () => {
  for (const opcode of NETCODE_OPCODES) {
    calls.length = 0
    const message = { type: opcode, payload: opcode.length }
    sameJson(netcode(message), { status: 'dispatched', opcode, result: 'netcode:' + opcode }, opcode + ' outcome')
    sameJson(calls, [{ namespace: 'netcode', opcode, message }], opcode + ' calls')
  }
})

gate('an unknown netcode opcode, an outbound name, a lowercase render name and a missing type invoke nothing', () => {
  calls.length = 0
  for (const type of ['NOPE', 'init', 'resize', 'ready', 'SEND_CLIENT', 'WORKER_READY', 'TRANSFORM_RING']) {
    sameJson(netcode({ type }), { status: 'unknown-opcode', opcode: type }, type + ' outcome')
  }
  sameJson(netcode({}), { status: 'unknown-opcode', opcode: null }, 'missing type outcome')
  sameJson(netcode(null), { status: 'unknown-opcode', opcode: null }, 'null message outcome')
  sameJson(netcode({ type: 42 }), { status: 'unknown-opcode', opcode: 42 }, 'non-string type outcome')
  sameJson(netcode({ type: 'constructor' }), { status: 'unknown-opcode', opcode: 'constructor' }, 'prototype key outcome')
  sameJson(calls, [], 'rejected calls')
})

gate('the outbound netcode names are not inbound opcodes, and no outbound name reaches a handler', () => {
  calls.length = 0
  for (const type of NETCODE_OUTBOUND) {
    sameJson(netcode({ type }).status, 'unknown-opcode', type + ' inbound status')
  }
  sameJson(calls, [], 'outbound calls')
})

gate('the render protocol is a separate namespace: three lowercase opcodes, its own handlers, and no netcode name', () => {
  sameJson(RENDER_OPCODES, ['init', 'resize', 'stop'], 'render opcodes')
  calls.length = 0
  for (const opcode of RENDER_OPCODES) {
    const message = { type: opcode }
    sameJson(render(message), { status: 'dispatched', opcode, result: 'render:' + opcode }, opcode + ' render outcome')
  }
  sameJson(calls.map((call) => call.namespace), ['render', 'render', 'render'], 'render namespace')
  calls.length = 0
  for (const type of ['INIT', 'SAVE_NOW', 'ready', 'frame', 'stopped', 'error']) {
    sameJson(render({ type }), { status: 'unknown-opcode', opcode: type }, type + ' render rejection')
  }
  sameJson(RENDER_OUTBOUND, ['ready', 'frame', 'stopped', 'error'], 'render outbound')
  sameJson(calls, [], 'render rejected calls')
})

gate('a namespace built with a missing handler, or with a handler for a name it does not own, is refused', () => {
  const withoutInit = { ...netcodeHandlers }
  delete withoutInit.INIT
  mustThrow(() => createNetcodeDispatch(withoutInit))
  mustThrow(() => createNetcodeDispatch({ ...netcodeHandlers, init: () => null }))
  mustThrow(() => createRenderDispatch({ init: () => null, resize: () => null, stop: () => null, INIT: () => null }))
  mustThrow(() => createRenderDispatch({ init: () => null, resize: () => null }))
})

gate('a handler that throws is not retried, and the error reaches the caller', () => {
  let count = 0
  const failing = createNetcodeDispatch({ ...netcodeHandlers, SAVE_NOW: () => {
    count += 1
    throw new Error('save failed')
  } })
  mustThrow(() => failing({ type: 'SAVE_NOW' }))
  same(count, 1, 'SAVE_NOW invocations')
})

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of ['postMessage', 'self', 'window', 'document', 'Worker', 'fetch', 'process', 'performance', 'Date', 'setTimeout', 'console', 'globalThis', 'require', 'Buffer']) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/worker-dispatch-pure/workerDispatch.js is comment-free, imports nothing, and touches no worker or host global', () => {
  sameJson(findingsIn(readFileSync(join(sourceDir, 'workerDispatch.js'), 'utf8')), [], 'findings')
})

finish()
