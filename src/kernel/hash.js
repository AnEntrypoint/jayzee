import { posWords as statePosWords, velWords as stateVelWords } from './state.js'

const FNV_PRIME = 16777619

export const hash = (count, seed) => {
  const posWords = statePosWords
  const velWords = stateVelWords
  const words = (count * 6) | 0
  let h = seed | 0
  for (let i = 0; i < words; i++) h = Math.imul(h ^ posWords[i], FNV_PRIME)
  for (let i = 0; i < words; i++) h = Math.imul(h ^ velWords[i], FNV_PRIME)
  return h
}
