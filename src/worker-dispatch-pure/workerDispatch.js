export const NETCODE_OPCODES = Object.freeze([
  'INIT',
  'PEER_CONNECT',
  'PEER_FRAME',
  'PEER_LEFT',
  'HMR_APP',
  'HMR_TICK_HANDLER',
  'SAVE_NOW',
  'DEBUG_COLLIDER_QUERY',
  'DEBUG_COLLIDER_RAYS',
  'CLIENT_MESSAGE',
  'CLIENT_DISCONNECT',
  'PEER_MESSAGE',
  'PEER_DISCONNECT',
])

export const NETCODE_OUTBOUND = Object.freeze([
  'INIT_ERROR',
  'HMR_RESULT',
  'DEBUG_COLLIDER_RESULT',
  'TRANSFORM_RING',
  'SEND_CLIENT',
  'WORKER_READY',
])

export const RENDER_OPCODES = Object.freeze(['init', 'resize', 'stop'])

export const RENDER_OUTBOUND = Object.freeze(['ready', 'frame', 'stopped', 'error'])

function createOpcodeDispatch(namespace, opcodes, handlers) {
  const known = new Set(opcodes)
  for (const opcode of opcodes) {
    if (typeof handlers[opcode] !== 'function') throw new Error(namespace + ' opcode ' + opcode + ' has no handler')
  }
  for (const name of Object.keys(handlers)) {
    if (!known.has(name)) throw new Error(namespace + ' handler ' + name + ' is not an opcode of this namespace')
  }
  return function dispatch(message) {
    const opcode = message?.type
    if (typeof opcode !== 'string' || !known.has(opcode)) return { status: 'unknown-opcode', opcode: opcode ?? null }
    return { status: 'dispatched', opcode, result: handlers[opcode](message) }
  }
}

export function createNetcodeDispatch(handlers) {
  return createOpcodeDispatch('netcode', NETCODE_OPCODES, handlers)
}

export function createRenderDispatch(handlers) {
  return createOpcodeDispatch('render', RENDER_OPCODES, handlers)
}
