import { DEFAULT_KEY_BINDINGS, DEFAULT_PAD_BINDINGS, KEY_BINDINGS_STORAGE_KEY, PAD_BUTTON_MAX } from './keybindingDefaults.js'

export class KeyBindingError extends Error {
  constructor(reasonCode, detail) {
    super(`[keybindings] ${reasonCode}: ${detail}`)
    this.name = 'KeyBindingError'
    this.reasonCode = reasonCode
  }
}

const hasOwn = (table, action) => Object.hasOwn(table, action)

function cloneTable(table) {
  const out = {}
  for (const action of Object.keys(table)) out[action] = table[action].slice()
  return out
}

function checkAction(table, action) {
  if (!hasOwn(table, action)) throw new KeyBindingError('unknown-action', String(action))
}

function checkKeyCodes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) throw new KeyBindingError('bad-keys', 'need a non-empty array')
  for (const code of codes) {
    if (typeof code !== 'string' || code === '') throw new KeyBindingError('bad-keys', String(code))
  }
}

function checkPadButtons(buttons) {
  if (!Array.isArray(buttons) || buttons.length === 0) throw new KeyBindingError('bad-pad', 'need a non-empty array')
  for (const b of buttons) {
    if (!Number.isInteger(b) || b < 0 || b > PAD_BUTTON_MAX) throw new KeyBindingError('bad-pad', String(b))
  }
}

function parseStored(raw, base) {
  const parsed = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new KeyBindingError('bad-record', 'not an object')
  const keys = cloneTable(base.keys)
  const pad = cloneTable(base.pad)
  for (const action of Object.keys(parsed.keys ?? {})) {
    checkAction(keys, action)
    checkKeyCodes(parsed.keys[action])
    keys[action] = parsed.keys[action].slice()
  }
  for (const action of Object.keys(parsed.pad ?? {})) {
    checkAction(pad, action)
    checkPadButtons(parsed.pad[action])
    pad[action] = parsed.pad[action].slice()
  }
  return { keys, pad }
}

function conflictOf(table, action, values) {
  for (const other of Object.keys(table)) {
    if (other === action) continue
    if (table[other].some((v) => values.includes(v))) return other
  }
  return null
}

export function createKeyBindings({ storage = null, defaults = { keys: DEFAULT_KEY_BINDINGS, pad: DEFAULT_PAD_BINDINGS } } = {}) {
  if (storage !== null && (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function')) {
    throw new TypeError('createKeyBindings: storage must expose getItem and setItem, or be null')
  }
  const base = { keys: cloneTable(defaults.keys), pad: cloneTable(defaults.pad) }
  let state = { keys: cloneTable(base.keys), pad: cloneTable(base.pad) }
  const raw = storage ? storage.getItem(KEY_BINDINGS_STORAGE_KEY) : null
  if (raw) state = parseStored(raw, base)

  const keysFor = (action) => {
    checkAction(state.keys, action)
    return state.keys[action].slice()
  }
  const padFor = (action) => {
    checkAction(state.pad, action)
    return state.pad[action].slice()
  }

  return {
    keysFor,
    padFor,
    actionForKey(code) {
      for (const action of Object.keys(state.keys)) if (state.keys[action].includes(code)) return action
      return null
    },
    actionForPad(button) {
      for (const action of Object.keys(state.pad)) if (state.pad[action].includes(button)) return action
      return null
    },
    rebindKeys(action, codes) {
      checkAction(state.keys, action)
      checkKeyCodes(codes)
      const clash = conflictOf(state.keys, action, codes)
      if (clash) throw new KeyBindingError('conflict', `${codes.join(',')} already bound to ${clash}`)
      state.keys[action] = codes.slice()
      return keysFor(action)
    },
    rebindPad(action, buttons) {
      checkAction(state.pad, action)
      checkPadButtons(buttons)
      const clash = conflictOf(state.pad, action, buttons)
      if (clash) throw new KeyBindingError('conflict', `${buttons.join(',')} already bound to ${clash}`)
      state.pad[action] = buttons.slice()
      return padFor(action)
    },
    resetAll() {
      state = { keys: cloneTable(base.keys), pad: cloneTable(base.pad) }
    },
    snapshot() {
      return { keys: cloneTable(state.keys), pad: cloneTable(state.pad) }
    },
    save() {
      if (!storage) return false
      storage.setItem(KEY_BINDINGS_STORAGE_KEY, JSON.stringify(state))
      return true
    },
  }
}
