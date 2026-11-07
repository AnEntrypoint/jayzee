export const FNV1A_32_OFFSET_BASIS = 0x811c9dc5
export const FNV1A_32_PRIME = 0x01000193

const floatScratch = new DataView(new ArrayBuffer(4))

export function fnv1aStepString(hash, str) {
  for (let i = 0; i < str.length; i++) hash = Math.imul(hash ^ str.charCodeAt(i), FNV1A_32_PRIME)
  return hash
}

export function fnv1aStepBytes(hash, bytes) {
  for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], FNV1A_32_PRIME)
  return hash
}

export function fnv1aStepFloat32(hash, n) {
  floatScratch.setFloat32(0, n)
  for (let i = 0; i < 4; i++) hash = Math.imul(hash ^ floatScratch.getUint8(i), FNV1A_32_PRIME)
  return hash
}
