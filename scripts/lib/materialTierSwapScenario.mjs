import { canon } from './canon.mjs'

class MeshLambertMaterial {
  constructor() {
    this.kind = 'lambert'
  }
}

class MeshPhongMaterial {
  constructor() {
    this.kind = 'phong'
  }
}

export const FAKE_THREE = { MeshLambertMaterial, MeshPhongMaterial }

const vec = (x, y, z) => ({ x, y, z, clone() { return vec(this.x, this.y, this.z) } })

const materialKinds = {
  standard: () => ({ isMeshStandardMaterial: true, color: vec(1, 0, 0), map: 'mapA', normalMap: 'nrmA', normalScale: vec(1, 1, 0), metalness: 0.7, emissive: vec(0, 0, 0), transparent: false, opacity: 1, side: 0, name: 'std' }),
  standardNoNormal: () => ({ isMeshStandardMaterial: true, color: vec(0.5, 0.5, 0.5), metalness: 0.9, map: null, normalMap: null }),
  physical: () => ({ isMeshPhysicalMaterial: true, color: vec(0.2, 0.3, 0.4), normalMap: 'nrmB', normalScale: null, metalness: 0.2, clearcoat: 0.5, toneMapped: false }),
  basic: () => ({ isMeshBasicMaterial: true, color: vec(1, 1, 1), map: 'basicMap' }),
  lambertOld: () => ({ isMeshLambertMaterial: true, color: vec(0.1, 0.1, 0.1) }),
  alreadySwapped: () => ({ isMeshStandardMaterial: true, _lowTierSwapped: true, color: vec(0, 0, 0) }),
}

const meshOf = (material, isMesh = true) => ({ isMesh, material })

const scenes = {
  mixed: () => {
    const shared = materialKinds.standard()
    return [
      meshOf(shared),
      meshOf([shared, materialKinds.basic()]),
      meshOf([null, materialKinds.standardNoNormal()]),
      meshOf(materialKinds.lambertOld()),
      meshOf(materialKinds.standard(), false),
      meshOf(undefined),
      meshOf(null),
      meshOf(materialKinds.alreadySwapped()),
    ]
  },
  physical: () => [meshOf(materialKinds.physical())],
  alreadySwapped: () => [meshOf(materialKinds.alreadySwapped())],
  empty: () => [],
}

const devices = [
  null,
  undefined,
  {},
  { gpuTier: 'low' },
  { gpuTier: 'low', isMobile: true },
  { gpuTier: 'low', isMobile: false },
  { gpuTier: 'high', isMobile: true },
  { gpuTier: 'mid' },
  { gpuTier: 'LOW', isMobile: true },
  0,
  'low',
]

const rootOf = (children) => ({ traverse(visit) { for (const child of children) visit(child) } })

const describeScene = (children) => {
  const identities = new Map()
  const describeMaterial = (material) => {
    if (material === null || material === undefined) return canon(material)
    if (!identities.has(material)) identities.set(material, identities.size)
    return { id: identities.get(material), ctor: material.constructor.name, fields: material }
  }
  return children.map((child) => ({
    isMesh: child.isMesh,
    material: Array.isArray(child.material) ? child.material.map(describeMaterial) : describeMaterial(child.material),
  }))
}

export const runMaterialTierSwapScenario = (api) => {
  const decisions = devices.map((device, index) => canon([index, api.shouldSwapMaterials(device), api.shouldStripNormalMaps(device)]))

  const beforeRef = []
  for (const [index, device] of devices.entries()) {
    try {
      const result = api.applyLowTierMaterials(rootOf(scenes.mixed()), device)
      beforeRef.push(canon({ index, result }))
    } catch (error) {
      beforeRef.push(canon({ index, threw: error.message }))
    }
  }

  api.setThreeRef(FAKE_THREE)

  const apply = []
  for (const [index, device] of devices.entries()) {
    for (const [name, build] of Object.entries(scenes)) {
      const children = build()
      const result = api.applyLowTierMaterials(rootOf(children), device)
      apply.push(canon({ device: index, scene: name, result, objects: describeScene(children) }))
    }
  }

  return { decisions, beforeRef, apply }
}
