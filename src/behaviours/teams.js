export const COLORBLIND_SAFE_PALETTE = Object.freeze([
  0x0072B2,
  0xE69F00,
  0x009E73,
  0xCC79A7,
  0xF0E442,
  0x56B4E9,
  0xD55E00,
  0x000000,
])

function refusal(message) {
  return new TypeError(`[teams] ${message}`)
}

function readTeamDef(entry) {
  if (typeof entry === 'string') return { id: entry, label: undefined, color: undefined }
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw refusal('each team must be an id string or an object with an id')
  return { id: entry.id, label: entry.label, color: entry.color }
}

export function resolveTeamColors(teams, colorblindSafe = false) {
  if (!Array.isArray(teams)) throw refusal('teams must be an array')
  if (typeof colorblindSafe !== 'boolean') throw refusal('colorblindSafe must be a boolean')
  const seen = new Set()
  const out = []
  let paletteIndex = 0
  for (const entry of teams) {
    const def = readTeamDef(entry)
    if (typeof def.id !== 'string' || def.id.length === 0) throw refusal('every team needs a non-empty string id')
    if (seen.has(def.id)) throw refusal(`duplicate team id: ${def.id}`)
    seen.add(def.id)
    let color = def.color ?? null
    if (color === null && colorblindSafe) {
      color = COLORBLIND_SAFE_PALETTE[paletteIndex % COLORBLIND_SAFE_PALETTE.length]
      paletteIndex++
    }
    out.push({ id: def.id, label: def.label != null ? String(def.label) : def.id, color })
  }
  return out
}

export default resolveTeamColors
