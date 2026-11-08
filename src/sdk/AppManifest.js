export const KNOWN_EDITOR_PROP_TYPES = Object.freeze([
  'string', 'number', 'boolean', 'select', 'vec3', 'color',
  'textarea', 'entity-reference', 'object-select', 'range',
])

export const VALID_SPDX = Object.freeze([
  'MIT', 'CC0-1.0', 'Apache-2.0', 'GPL-3.0', 'LGPL-3.0',
  'MPL-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'Unlicense', 'ISC',
])

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function checkRequiredStrings(manifest, errors) {
  for (const field of ['name', 'version', 'title', 'description', 'license', 'entry']) {
    if (typeof manifest[field] !== 'string' || !manifest[field]) {
      errors.push(`missing or empty required field: ${field}`)
    }
  }
}

function checkAuthor(author, errors) {
  if (author === undefined) return
  if (!isPlainObject(author)) {
    errors.push('author must be an object { name } or omitted')
    return
  }
  if (typeof author.name !== 'string' || !author.name) {
    errors.push('author.name is required when author is present')
  }
  if (author.nostr !== undefined && typeof author.nostr !== 'string') {
    errors.push('author.nostr must be a hex pubkey string if present')
  }
}

function checkEditorProp(field, prop, errors) {
  if (!isPlainObject(prop)) {
    errors.push(`editorProps.${field} must be an object`)
    return
  }
  if (typeof prop.type !== 'string' || !KNOWN_EDITOR_PROP_TYPES.includes(prop.type)) {
    errors.push(`editorProps.${field}.type must be one of: ${KNOWN_EDITOR_PROP_TYPES.join(', ')}`)
  }
  if (typeof prop.label !== 'string' || !prop.label) {
    errors.push(`editorProps.${field}.label is required`)
  }
  if (prop.type === 'select' && (!Array.isArray(prop.options) || prop.options.length === 0)) {
    errors.push(`editorProps.${field} (select) requires a non-empty options array`)
  }
  if (prop.type === 'range' && (typeof prop.min !== 'number' || typeof prop.max !== 'number')) {
    errors.push(`editorProps.${field} (range) requires min and max numbers`)
  }
}

function checkEditorProps(editorProps, errors) {
  if (editorProps === undefined) return
  if (!isPlainObject(editorProps)) {
    errors.push('editorProps must be an object')
    return
  }
  for (const [field, prop] of Object.entries(editorProps)) {
    checkEditorProp(field, prop, errors)
  }
}

function checkTags(tags, errors) {
  if (tags === undefined) return
  if (!Array.isArray(tags)) {
    errors.push('tags must be an array of strings')
    return
  }
  if (tags.some(tag => typeof tag !== 'string' || !tag)) {
    errors.push('tags must be an array of strings')
  }
}

function checkCompatibility(compatibility, errors) {
  if (compatibility === undefined) return
  if (!isPlainObject(compatibility) || typeof compatibility.spoint !== 'string' || !compatibility.spoint) {
    errors.push('compatibility.spoint semver range is required')
  }
}

export function validateManifest(manifest) {
  if (!isPlainObject(manifest)) {
    return { valid: false, errors: ['manifest must be an object'] }
  }

  const errors = []
  checkRequiredStrings(manifest, errors)

  if (typeof manifest.name === 'string' && manifest.name && !NAME_PATTERN.test(manifest.name)) {
    errors.push(`name must be lowercase alphanumeric + hyphens: "${manifest.name}"`)
  }
  if (typeof manifest.version === 'string' && manifest.version && !VERSION_PATTERN.test(manifest.version)) {
    errors.push(`version must be semver: "${manifest.version}"`)
  }
  if (typeof manifest.license === 'string' && manifest.license && !VALID_SPDX.includes(manifest.license)) {
    errors.push(`license must be a known SPDX id: "${manifest.license}" (known: ${VALID_SPDX.join(', ')})`)
  }

  checkAuthor(manifest.author, errors)
  checkEditorProps(manifest.editorProps, errors)

  if (manifest.requires !== undefined && !isPlainObject(manifest.requires)) {
    errors.push('requires must be an object')
  }
  if (manifest.dependencies !== undefined && !isPlainObject(manifest.dependencies)) {
    errors.push('dependencies must be an object')
  }
  checkTags(manifest.tags, errors)
  checkCompatibility(manifest.compatibility, errors)

  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
