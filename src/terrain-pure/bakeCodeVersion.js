export const BAKE_INPUTS_GLB_TRANSFORM = Object.freeze([
  './GLBTransformer.js',
  './GLBDraco.js',
  './GLBKtx2.js',
  './GLBVrmPassthrough.js',
  '../shared/fnv1a.js',
])

export const BAKE_INPUTS_KTX2_EXTRACT = Object.freeze([
  './KTX2Extract.js',
  './GLBTransformer.js',
  './GLBDraco.js',
  './GLBKtx2.js',
  './GLBVrmPassthrough.js',
  '../shared/fnv1a.js',
])

export const BAKE_INPUTS_PROGRESSIVE_BAKE = Object.freeze([
  '../../packages/streaming-gltf/tools/bake-cluster.mjs',
  '../../packages/streaming-gltf/src/meshlet-codec.js',
  '../../packages/streaming-gltf/src/degenerate-triangles.js',
  '../../packages/streaming-gltf/src/cluster-lod-mesh.js',
  '../../packages/streaming-gltf/src/material-convergence.js',
])

export const BAKE_VERSION_DIGEST_LENGTH = 12

export const normalizeBakeText = (text) => {
  if (typeof text !== 'string') throw new TypeError('bake input text must be a string')
  return text.replace(/\r\n/g, '\n')
}

export const bakeCodeVersion = (relFiles, readText, sha1Hex) => {
  if (!Array.isArray(relFiles) || relFiles.length === 0) throw new TypeError('bakeCodeVersion needs a non-empty list of input paths')
  if (typeof readText !== 'function') throw new TypeError('bakeCodeVersion needs a readText function')
  if (typeof sha1Hex !== 'function') throw new TypeError('bakeCodeVersion needs a sha1Hex function')
  let text = ''
  for (const rel of relFiles) {
    if (typeof rel !== 'string') throw new TypeError('bake input paths must be strings')
    text += rel + normalizeBakeText(readText(rel))
  }
  return sha1Hex(text).slice(0, BAKE_VERSION_DIGEST_LENGTH)
}
