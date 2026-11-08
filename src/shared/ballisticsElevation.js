function refusal(code, message) {
  const err = new TypeError(`[ballistics] ${message}`)
  err.reasonCode = code
  return err
}

function requirePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw refusal('ballistics-positive-invalid', `${name} must be a positive finite number`)
  return value
}

export function elevation(speed, g, distance, rise) {
  requirePositive(speed, 'speed')
  requirePositive(g, 'g')
  if (!Number.isFinite(distance) || distance < 0) throw refusal('ballistics-distance-invalid', 'distance must be a finite number >= 0')
  if (!Number.isFinite(rise)) throw refusal('ballistics-rise-invalid', 'rise must be a finite number')
  if (distance === 0) return null
  const v2 = speed * speed
  const disc = v2 * v2 - g * (g * distance * distance + 2 * rise * v2)
  if (disc < 0) return null
  return Math.atan((v2 - Math.sqrt(disc)) / (g * distance))
}
