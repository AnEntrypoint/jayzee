import { importClosure, assertClosed } from './sourceClosure.js'
import { bakeCodeVersion } from '../terrain-pure/bakeCodeVersion.js'
import { HEIGHTFIELD_BAKE_ENTRIES } from '../terrain-pure/heightfieldBake.js'

export const PIN_PINNED = 'pinned'
export const PIN_DRIFTED = 'drifted'
export const PIN_UNRECORDED = 'unrecorded'
export const PIN_UNKNOWN_KIND = 'unknown-kind'

export const BAKE_KINDS = Object.freeze({
  heightfield: Object.freeze({ entries: HEIGHTFIELD_BAKE_ENTRIES, artifact: '.hf' }),
})

export class BakePinError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'BakePinError'
    this.code = code
  }
}

export function createBakePinTable({ kinds = BAKE_KINDS, readText, sha1Hex }) {
  if (typeof readText !== 'function') throw new TypeError('createBakePinTable needs a readText function')
  if (typeof sha1Hex !== 'function') throw new TypeError('createBakePinTable needs a sha1Hex function')
  const names = Object.keys(kinds).sort()
  if (names.length === 0) throw new BakePinError('pin-table-empty', 'a pin table needs at least one bake kind')
  for (const name of names) {
    const kind = kinds[name]
    const lists = (Array.isArray(kind.entries) ? 1 : 0) + (Array.isArray(kind.inputs) ? 1 : 0)
    if (lists !== 1) throw new BakePinError('pin-kind-needs-one-list', `bake kind ${name} needs either entries (followed through imports) or inputs (read as listed)`)
  }
  const inputsByName = new Map()
  const versionByName = new Map()

  function known(name) {
    if (!Object.prototype.hasOwnProperty.call(kinds, name)) throw new BakePinError('pin-unknown-kind', `no bake kind named ${name}, the table holds ${names.join(', ')}`)
    return kinds[name]
  }

  function inputsOf(name) {
    const kind = known(name)
    let inputs = inputsByName.get(name)
    if (inputs === undefined) {
      inputs = Object.freeze(kind.entries ? assertClosed(importClosure(kind.entries, readText)).files : [...kind.inputs])
      inputsByName.set(name, inputs)
    }
    return inputs
  }

  function versionOf(name) {
    let version = versionByName.get(name)
    if (version === undefined) {
      version = bakeCodeVersion(inputsOf(name), readText, sha1Hex)
      versionByName.set(name, version)
    }
    return version
  }

  function versions() {
    const out = {}
    for (const name of names) out[name] = versionOf(name)
    return out
  }

  function check(recorded) {
    if (recorded === null || typeof recorded !== 'object') throw new BakePinError('pin-record-not-object', 'the recorded pins must be an object of kind to version')
    const rows = []
    for (const name of names) {
      const current = versionOf(name)
      const pin = Object.prototype.hasOwnProperty.call(recorded, name) ? recorded[name] : null
      rows.push({ name, recorded: pin, current, status: pin === null ? PIN_UNRECORDED : pin === current ? PIN_PINNED : PIN_DRIFTED })
    }
    for (const name of Object.keys(recorded).sort()) {
      if (!names.includes(name)) rows.push({ name, recorded: recorded[name], current: null, status: PIN_UNKNOWN_KIND })
    }
    return { ok: rows.every((row) => row.status === PIN_PINNED), rows }
  }

  function require(name, stamped) {
    const current = versionOf(name)
    if (stamped !== current) throw new BakePinError('pin-stale-artifact', `${name} artifact is stamped ${JSON.stringify(stamped ?? null)}, this tree bakes ${current}: re-bake it`)
    return current
  }

  return { names, inputsOf, versionOf, versions, check, require }
}

export function heightfieldBakeInputs(readText) {
  return assertClosed(importClosure(HEIGHTFIELD_BAKE_ENTRIES, readText)).files
}

export function heightfieldCodeVersion(readText, sha1Hex) {
  return bakeCodeVersion(heightfieldBakeInputs(readText), readText, sha1Hex)
}
