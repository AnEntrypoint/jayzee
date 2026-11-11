import { emitResult } from './emit.mjs'

const bytes = Number(process.argv[2])
if (!Number.isInteger(bytes) || bytes < 1) throw new RangeError('usage: pipeProbe.mjs <bytes>')
emitResult({ kind: 'pipe-probe', bytes, filler: 'x'.repeat(bytes) })
