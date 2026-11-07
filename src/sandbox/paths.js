import { resolve, sep } from 'node:path'

export const COEP_VALUE = 'require-corp'

export function resolveWithinRoot(root, candidate) {
  const base = resolve(root)
  const target = resolve(base, candidate)
  const prefix = base.endsWith(sep) ? base : base + sep
  if (target !== base && !target.startsWith(prefix)) return null
  return target
}
