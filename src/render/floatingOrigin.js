export const REBASE_THRESHOLD_M = 8000

const plainVector = () => {
  const v = {
    x: 0, y: 0, z: 0,
    set(x, y, z) { v.x = x; v.y = y; v.z = z; return v },
  }
  return v
}

const translateChildren = (scene, camera, dx, dy, dz) => {
  for (const child of scene.children) {
    if (child === camera) continue
    child.position.x += dx; child.position.y += dy; child.position.z += dz
  }
}

export function createFloatingOrigin(scene, camera, makeVector = plainVector) {
  const shift = makeVector()
  const authoritativeCamera = makeVector()
  let initialized = false
  let rebaseCount = 0
  const lastDelta = makeVector()
  const listeners = new Set()

  function update(authoritativeX, authoritativeY, authoritativeZ) {
    authoritativeCamera.set(authoritativeX, authoritativeY, authoritativeZ)
    if (!initialized) {
      initialized = true
      lastDelta.set(0, 0, 0)
      return false
    }
    const rx = authoritativeX - shift.x, ry = authoritativeY - shift.y, rz = authoritativeZ - shift.z
    const d2 = rx * rx + ry * ry + rz * rz
    if (d2 < REBASE_THRESHOLD_M * REBASE_THRESHOLD_M) { lastDelta.set(0, 0, 0); return false }
    const deltaX = rx, deltaY = ry, deltaZ = rz
    shift.set(authoritativeX, authoritativeY, authoritativeZ)
    camera.position.set(0, 0, 0)
    translateChildren(scene, camera, -deltaX, -deltaY, -deltaZ)
    lastDelta.set(-deltaX, -deltaY, -deltaZ)
    rebaseCount++
    for (const fn of listeners) { try { fn(-deltaX, -deltaY, -deltaZ, shift) } catch (_) {} }
    return true
  }

  function onRebase(fn) { listeners.add(fn); return () => listeners.delete(fn) }

  function toAuthoritative(renderPos, out) {
    const o = out || makeVector()
    o.x = renderPos.x + shift.x; o.y = renderPos.y + shift.y; o.z = renderPos.z + shift.z
    return o
  }

  function toRender(authPos, out) {
    const o = out || makeVector()
    o.x = authPos.x - shift.x; o.y = authPos.y - shift.y; o.z = authPos.z - shift.z
    return o
  }

  return {
    update, onRebase, toAuthoritative, toRender,
    getShift: () => shift,
    getAuthoritativeCamera: () => authoritativeCamera,
    getRebaseCount: () => rebaseCount,
    getLastDelta: () => lastDelta,
  }
}
