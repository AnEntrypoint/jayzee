export class TouchSurfaceSpecError extends Error {
  constructor(reasonCode, detail) {
    super(`[touch-surface] ${reasonCode}: ${detail}`)
    this.name = 'TouchSurfaceSpecError'
    this.reasonCode = reasonCode
  }
}

export const TOUCH_SURFACE_KINDS = Object.freeze(['stick', 'button', 'pad', 'orientation'])
export const TOUCH_SURFACE_ANCHORS = Object.freeze(['left', 'right'])

const isUnitNumber = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const isPositiveNumber = v => typeof v === 'number' && Number.isFinite(v) && v > 0
const isNonEmptyString = v => typeof v === 'string' && v.length > 0

const FIELD_RULES = {
  id: [isNonEmptyString, 'nonEmptyString'],
  kind: [v => TOUCH_SURFACE_KINDS.includes(v), `one of ${TOUCH_SURFACE_KINDS.join('|')}`],
  anchor: [v => TOUCH_SURFACE_ANCHORS.includes(v), `one of ${TOUCH_SURFACE_ANCHORS.join('|')}`],
  x: [isUnitNumber, 'number in [0,1]'],
  y: [isUnitNumber, 'number in [0,1]'],
  size: [isPositiveNumber, 'positive finite number'],
  action: [isNonEmptyString, 'nonEmptyString'],
}

export function parseTouchSurfaces(spec) {
  if (spec === null || typeof spec !== 'object' || !Array.isArray(spec.surfaces)) {
    throw new TouchSurfaceSpecError('no-surfaces-array', 'spec.surfaces must be an array')
  }
  const seen = new Set()
  return spec.surfaces.map((raw, index) => {
    if (raw === null || typeof raw !== 'object') {
      throw new TouchSurfaceSpecError('surface-not-object', `surfaces[${index}]`)
    }
    for (const [field, [ok, expected]] of Object.entries(FIELD_RULES)) {
      if (!ok(raw[field])) {
        throw new TouchSurfaceSpecError('bad-field', `surfaces[${index}].${field} must be ${expected}`)
      }
    }
    if (seen.has(raw.id)) {
      throw new TouchSurfaceSpecError('duplicate-id', `surfaces[${index}].id ${raw.id}`)
    }
    seen.add(raw.id)
    return Object.freeze({ id: raw.id, kind: raw.kind, anchor: raw.anchor, x: raw.x, y: raw.y, size: raw.size, action: raw.action })
  })
}

export const TOUCH_CHIP_CAP = 4
export const DRAFT_SURFACE_NAME = 'draft'

const diagnostic = (code, message) => Object.freeze({ code, message })

const clampUnit = v => (v < 0 ? 0 : v > 1 ? 1 : v)

export function surfaceFromDraft(draft, layout) {
  if (!draft || !Array.isArray(draft.sticks) || !Array.isArray(draft.buttons)) throw new TypeError('surfaceFromDraft: draft must carry sticks and buttons')
  if (!layout || !(layout.w > 0) || !(layout.h > 0)) throw new TypeError('surfaceFromDraft: layout needs a positive w and h')
  const surfaces = []
  for (const stick of draft.sticks) {
    const left = stick.side === 'left'
    surfaces.push({ id: stick.action, kind: 'stick', anchor: left ? 'left' : 'right', x: left ? 0.15 : 0.85, y: 0.8, size: draft.radius, action: stick.action })
  }
  for (const button of draft.buttons) {
    surfaces.push({ id: button.action, kind: button.mode === 'drag' ? 'pad' : 'button', anchor: 'right', x: clampUnit(1 - (button.x + button.size / 2) / layout.w), y: clampUnit((button.y + button.size / 2) / layout.h), size: button.size, action: button.action })
  }
  return { surfaces }
}

function capChips(name, parsed, diagnostics) {
  const controls = []
  let chips = 0
  let dropped = 0
  for (const control of parsed) {
    if (control.kind === 'button') {
      if (chips === TOUCH_CHIP_CAP) {
        dropped++
        continue
      }
      chips++
    }
    controls.push(control)
  }
  if (dropped > 0) diagnostics.push(diagnostic('chip-cap-exceeded', `surface ${name} carries ${chips + dropped} button chips, the cap is ${TOUCH_CHIP_CAP}, the last ${dropped} are dropped`))
  return controls
}

function usableControls(name, spec, diagnostics) {
  let parsed
  try {
    parsed = parseTouchSurfaces(spec)
  } catch (error) {
    if (!(error instanceof TouchSurfaceSpecError)) throw error
    diagnostics.push(diagnostic(error.reasonCode, `surface ${name}: ${error.message}`))
    return null
  }
  if (parsed.length === 0) {
    diagnostics.push(diagnostic('surface-empty', `surface ${name} has no controls`))
    return null
  }
  return capChips(name, parsed, diagnostics)
}

const resolved = (name, source, controls, diagnostics) => ({ surface: Object.freeze({ name, source, controls: Object.freeze(controls) }), diagnostics })

export function resolveSurfaceControls(touch, surfaceName) {
  if (touch === null || typeof touch !== 'object') throw new TypeError('resolveSurfaceControls: touch config must be an object')
  const diagnostics = []
  const table = touch.surfaces ?? null
  const wanted = surfaceName ?? touch.active ?? null
  if (wanted !== null) {
    const has = table !== null && typeof table === 'object' && Object.prototype.hasOwnProperty.call(table, wanted)
    if (!has) {
      diagnostics.push(diagnostic('surface-unknown', `surface ${wanted} is not declared`))
    } else {
      const controls = usableControls(wanted, table[wanted], diagnostics)
      if (controls !== null) return resolved(wanted, 'surface', controls, diagnostics)
    }
  }
  if (touch.draft === undefined || touch.draft === null) {
    diagnostics.push(diagnostic('draft-missing', 'no usable surface and no draft to fall back to'))
    return resolved(DRAFT_SURFACE_NAME, 'draft', [], diagnostics)
  }
  const controls = usableControls(DRAFT_SURFACE_NAME, touch.draft, diagnostics)
  return resolved(DRAFT_SURFACE_NAME, 'draft', controls ?? [], diagnostics)
}

export const MAX_TOUCH_CHIPS = TOUCH_CHIP_CAP
export const TOUCH_SURFACE_UNUSABLE = 'touch-surface-unusable'
const DEFAULT_TOUCH_AXES = Object.freeze(['touchActive', 'touchTwist'])
const CONTROL_LISTS = Object.freeze(['sticks', 'buttons', 'pads', 'gestures'])

function controlsRefusal(code, message) {
  const error = new TypeError(`[touch-surfaces] ${code}: ${message}`)
  error.reasonCode = code
  return error
}

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

export function resolveControls(surfaceDoc, draft) {
  if (!plainObject(surfaceDoc)) throw controlsRefusal('touch-document-invalid', 'document must be an object')
  if (!plainObject(draft)) throw controlsRefusal('touch-draft-invalid', 'draft must be an object')
  const diagnostics = []
  const lists = {}
  for (const key of CONTROL_LISTS) {
    const value = surfaceDoc[key] === undefined ? [] : surfaceDoc[key]
    if (!Array.isArray(value)) {
      diagnostics.push(`${key}-not-array`)
      lists[key] = []
      continue
    }
    lists[key] = value.filter((item, i) => {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) {
        diagnostics.push(`bad-${key}-${i}`)
        return false
      }
      return true
    })
  }
  const { sticks, buttons, pads, gestures } = lists
  let chips = [...sticks, ...buttons, ...pads]
  if (chips.length > MAX_TOUCH_CHIPS) {
    diagnostics.push(`chip-cap-exceeded:${chips.length}>${MAX_TOUCH_CHIPS}`)
    chips = chips.slice(0, MAX_TOUCH_CHIPS)
  }
  if (sticks.length === 0 && buttons.length === 0) {
    return { ok: false, reasonCode: TOUCH_SURFACE_UNUSABLE, fallback: draft, diagnostics, controls: null }
  }
  return {
    ok: true,
    reasonCode: null,
    fallback: null,
    diagnostics,
    controls: {
      sticks: chips.filter((c) => sticks.includes(c)),
      buttons: chips.filter((c) => buttons.includes(c)),
      pads: chips.filter((c) => pads.includes(c)),
      gestures,
      style: plainObject(surfaceDoc.style) || Array.isArray(surfaceDoc.style) ? surfaceDoc.style : {},
      axes: Array.isArray(surfaceDoc.axes) ? surfaceDoc.axes.filter((a) => typeof a === 'string') : [...DEFAULT_TOUCH_AXES],
    },
    sendAction(id) { return { type: 'action', id } },
    sendAxis(id, value) { return { type: 'axis', id, value } },
  }
}
