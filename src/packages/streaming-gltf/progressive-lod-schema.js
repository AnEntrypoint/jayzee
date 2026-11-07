export const PROGRESSIVE_LOD_ROOT_SCHEMA = 'glTF.EP_progressive_lod.schema.json'
export const PROGRESSIVE_LOD_SCHEMA_NAMES = [
  PROGRESSIVE_LOD_ROOT_SCHEMA,
  'mesh.EP_progressive_lod.schema.json',
  'texture.EP_progressive_lod.schema.json',
  'lod.EP_progressive_lod.schema.json',
]

const TYPE_TESTS = {
  integer: (value) => Number.isInteger(value),
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  string: (value) => typeof value === 'string',
  boolean: (value) => typeof value === 'boolean',
  null: (value) => value === null,
  array: (value) => Array.isArray(value),
  object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
}

function resolveReference(schema, schemasByName) {
  let current = schema
  while (current && typeof current.$ref === 'string') {
    current = schemasByName[current.$ref]
    if (!current) throw new Error(`unresolved schema reference ${schema.$ref}`)
  }
  return current
}

function checkNumber(schema, value, path, errors) {
  if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`)
  if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`)
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: not above ${schema.exclusiveMinimum}`)
}

function checkArray(schema, value, path, errors, schemasByName) {
  if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`)
  if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`)
  if (schema.items) {
    value.forEach((item, index) => checkNode(schema.items, item, `${path}[${index}]`, errors, schemasByName))
  }
}

function checkObject(schema, value, path, errors, schemasByName) {
  const properties = schema.properties || {}
  for (const name of schema.required || []) {
    if (!Object.hasOwn(value, name)) errors.push(`${path}.${name}: required`)
  }
  for (const [name, subSchema] of Object.entries(properties)) {
    if (Object.hasOwn(value, name)) checkNode(subSchema, value[name], `${path}.${name}`, errors, schemasByName)
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key}: not allowed`)
    }
  }
}

function checkNode(schemaIn, value, path, errors, schemasByName) {
  const schema = resolveReference(schemaIn, schemasByName)
  if (schema.type !== undefined) {
    const types = [].concat(schema.type)
    if (!types.some((type) => TYPE_TESTS[type](value))) {
      errors.push(`${path}: expected ${types.join(' or ')}`)
      return
    }
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not one of ${schema.enum.join(', ')}`)
  if (typeof value === 'number') checkNumber(schema, value, path, errors)
  if (Array.isArray(value)) checkArray(schema, value, path, errors, schemasByName)
  if (TYPE_TESTS.object(value)) checkObject(schema, value, path, errors, schemasByName)
}

export function createSchemaValidator(schemasByName) {
  for (const name of PROGRESSIVE_LOD_SCHEMA_NAMES) {
    if (!schemasByName[name]) throw new Error(`missing schema ${name}`)
  }
  return {
    validate(value) {
      const errors = []
      checkNode(schemasByName[PROGRESSIVE_LOD_ROOT_SCHEMA], value, '$', errors, schemasByName)
      return { ok: errors.length === 0, errors }
    },
  }
}
