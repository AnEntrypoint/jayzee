import * as THREE from 'three'

export class InstancedMesh2 {
  constructor(geometry, material, options) {
    this.geometry = geometry
    this.material = material
    this.capacity = options.capacity
    this.frustumCulled = true
    this.matrixAutoUpdate = true
    this.renderOrder = 0
    this.instances = []
  }
  updateMatrix() {}
  resizeBuffers(n) {
    this.capacity = n
  }
  clearInstances() {
    this.instances = []
  }
  addInstances(n, build) {
    for (let i = 0; i < n; i++) {
      const entity = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) }
      build(entity)
      this.instances.push({ position: entity.position.toArray(), scale: entity.scale.toArray() })
    }
  }
}
