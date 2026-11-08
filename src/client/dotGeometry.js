import * as THREE from 'three'

export function makeDotGeometry(size) {
  const geo = new THREE.PlaneGeometry(size, size)
  geo.rotateX(-Math.PI / 2)
  return geo
}
