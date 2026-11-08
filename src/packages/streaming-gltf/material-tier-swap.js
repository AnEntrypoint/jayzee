export function shouldSwapMaterials(deviceInfo) {
  return !!deviceInfo && deviceInfo.gpuTier === 'low'
}

export function shouldStripNormalMaps(deviceInfo) {
  return !!deviceInfo && deviceInfo.gpuTier === 'low' && !!deviceInfo.isMobile
}

const copyKeys = [
  'color', 'map', 'lightMap', 'lightMapIntensity', 'aoMap', 'aoMapIntensity',
  'emissive', 'emissiveMap', 'emissiveIntensity', 'alphaMap', 'envMap',
  'combine', 'reflectivity', 'refractionRatio', 'wireframe', 'wireframeLinewidth',
  'specularMap', 'transparent', 'opacity', 'side', 'alphaTest', 'alphaHash',
  'depthTest', 'depthWrite', 'toneMapped', 'vertexColors', 'fog', 'flatShading',
  'skinning', 'morphTargets', 'morphNormals', 'polygonOffset', 'polygonOffsetFactor',
  'polygonOffsetUnits', 'name', 'userData',
]

let threeLambert = null
let threePhong = null

function swapOne(material, useLambert, stripNormalMaps) {
  if (!material || material._lowTierSwapped) return material
  const isStandardLike = material.isMeshStandardMaterial || material.isMeshPhysicalMaterial
  if (!isStandardLike) return material
  const Ctor = useLambert ? threeLambert : threePhong
  const swapped = new Ctor()
  for (const key of copyKeys) {
    if (material[key] !== undefined) swapped[key] = material[key]
  }
  if (!stripNormalMaps && material.normalMap && !useLambert) {
    swapped.normalMap = material.normalMap
    swapped.normalScale = material.normalScale ? material.normalScale.clone() : swapped.normalScale
  }
  if (useLambert && material.metalness != null && swapped.color && material.metalness > 0.5 && material.color) {
    swapped.color = material.color.clone()
  }
  swapped._lowTierSwapped = true
  swapped.needsUpdate = true
  return swapped
}

export function setThreeRef(THREE) {
  threeLambert = THREE.MeshLambertMaterial
  threePhong = THREE.MeshPhongMaterial
}

export function applyLowTierMaterials(root, deviceInfo) {
  const doSwap = shouldSwapMaterials(deviceInfo)
  const doStripNormals = shouldStripNormalMaps(deviceInfo)
  if (!doSwap && !doStripNormals) return { swapped: 0, normalMapsStripped: 0, scanned: 0 }
  if (!threeLambert || !threePhong) throw new Error('applyLowTierMaterials: setThreeRef(THREE) must be called before a low-tier swap')
  const useLambert = !!(deviceInfo && deviceInfo.isMobile)
  let swapped = 0
  let normalMapsStripped = 0
  let scanned = 0
  const swappedByOriginal = new Map()
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return
    scanned++
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    const next = mats.map((material) => {
      if (!material) return material
      if (doStripNormals && material.normalMap) {
        material.normalMap = null
        material.needsUpdate = true
        normalMapsStripped++
      }
      if (!doSwap) return material
      if (swappedByOriginal.has(material)) return swappedByOriginal.get(material)
      const wasStandardLike = material.isMeshStandardMaterial || material.isMeshPhysicalMaterial
      const out = swapOne(material, useLambert, doStripNormals)
      swappedByOriginal.set(material, out)
      if (wasStandardLike && out !== material) swapped++
      return out
    })
    obj.material = Array.isArray(obj.material) ? next : next[0]
  })
  return { swapped, normalMapsStripped, scanned }
}
