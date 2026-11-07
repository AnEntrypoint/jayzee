export const PLAYER_DEFAULTS = Object.freeze({ capsuleRadius: 0.4, capsuleHalfHeight: 0.9, crouchHalfHeight: 0.45, mass: 120, health: 100 })

export function playerDefault(playerConfig, key) {
  const value = playerConfig?.[key]
  return value === undefined ? PLAYER_DEFAULTS[key] : value
}
