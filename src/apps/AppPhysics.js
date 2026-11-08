import { nonNeg } from '../netcode/vecGuard.js'

export function parseInteractable(config = {}) {
  const radius = config.radius ?? 3
  const cooldown = config.cooldown ?? 500
  const prompt = config.prompt ?? 'Press E'
  nonNeg(radius, 'interactable: radius')
  nonNeg(cooldown, 'interactable: cooldown')
  if (typeof prompt !== 'string') throw new TypeError('interactable: prompt must be a string')
  return { prompt, radius, cooldown }
}
