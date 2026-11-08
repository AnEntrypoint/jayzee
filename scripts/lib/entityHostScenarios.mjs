import { attempt } from './scenarioTrace.mjs'

export const ENTITY_SPAWN = { position: [1, 2, 3], custom: { team: 'red' } }

export const ENTITY_OPS = [
  { op: 'get', field: 'position' },
  { op: 'set', field: 'position', value: [4, 5, 6] },
  { op: 'get', field: 'position' },
  { op: 'set', field: 'position', value: [1, 2] },
  { op: 'set', field: 'position', value: [1, '$NaN', 3] },
  { op: 'get', field: 'velocity' },
  { op: 'set', field: 'velocity', value: [0, 1, 0] },
  { op: 'get', field: 'velocity' },
  { op: 'set', field: 'velocity', value: [0, '$NaN', 0] },
  { op: 'get', field: 'custom' },
  { op: 'set', field: 'custom', value: { hp: 3 } },
  { op: 'get', field: 'custom' },
  { op: 'set', field: 'custom', value: [1] },
  { op: 'set', field: 'custom', value: 'text' },
  { op: 'set', field: 'custom', value: null },
  { op: 'get', field: 'custom' },
  { op: 'destroy' },
  { op: 'destroy' },
  { op: 'get', field: 'position' },
  { op: 'set', field: 'velocity', value: [0, 0, 0] },
  { op: 'get', field: 'custom' },
]

const revive = (value) => (Array.isArray(value) ? value.map((x) => (x === '$NaN' ? NaN : x)) : value)

export function traceEntityOps(proxy, ops) {
  return ops.map((op, index) => {
    const label = index + ':' + op.op + (op.field ? ' ' + op.field : '')
    return {
      label,
      ...attempt(() => {
        if (op.op === 'get') return proxy[op.field]
        if (op.op === 'set') {
          proxy[op.field] = revive(op.value)
          return null
        }
        if (op.op === 'destroy') {
          proxy.destroy()
          return null
        }
        throw new Error('unknown op ' + op.op)
      }),
    }
  })
}
