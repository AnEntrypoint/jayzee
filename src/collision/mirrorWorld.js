import { createJoltHost } from './joltHost.js'
import { CharacterManager } from './characterManager.js'

const LAYER_STATIC = 0

export async function createMirrorWorld({ gravity = [0, -9.81, 0], crouchHalfHeight = 0.45, joltLimits = null, maxStepHeight = 0.4, stickToFloorDistance = 0.5 } = {}) {
  const host = await createJoltHost({ gravity, joltLimits })
  const J = host.Jolt
  const charMgr = new CharacterManager(gravity, crouchHalfHeight)
  charMgr.config.maxStepHeight = maxStepHeight
  charMgr.config.stickToFloorDistance = stickToFloorDistance
  charMgr.init(J, host.jolt, host.physicsSystem)

  return {
    Jolt: J,
    jolt: host.jolt,
    charMgr,
    createStaticBody(shape) {
      return host.addBody(shape, [0, 0, 0], J.EMotionType_Static, LAYER_STATIC)
    },
    setBodyInSystem(id, present) {
      const jid = host.bodyIds.get(id)
      if (present) host.bodyInterface.AddBody(jid, J.EActivation_DontActivate)
      else host.bodyInterface.RemoveBody(jid)
    },
    destroyBody(id) {
      const jid = host.bodyIds.get(id)
      host.bodyInterface.DestroyBody(jid)
      host.bodies.delete(id)
      host.bodyIds.delete(id)
    },
    addCharacter(radius, halfHeight, position, mass, charConfig) {
      return charMgr.addCharacter(radius, halfHeight, position, mass, charConfig)
    },
    setCharacterPosition(charId, p) { charMgr.setPosition(charId, p) },
    setCharacterVelocity(charId, v) { charMgr.setVelocity(charId, v) },
    updateCharacter(charId, dt) { charMgr.update(charId, dt) },
    readCharacterPosition(charId, out) { charMgr.readPosition(charId, out) },
    readCharacterVelocity(charId, out) { charMgr.readVelocity(charId, out) },
    getCharacterGroundState(charId) { return charMgr.getGroundState(charId) },
    readCharacterGroundNormal(charId, out) { return charMgr.readGroundNormal(charId, out) },
    refreshCharacterContacts(charId) {
      const f = charMgr._filters
      charMgr.characters.get(charId).RefreshContacts(f.bp, f.ol, f.body, f.shape, host.jolt.GetTempAllocator())
      charMgr.refreshGroundCaches()
    },
    destroy() {
      charMgr.destroy()
      host.destroy()
    },
  }
}
