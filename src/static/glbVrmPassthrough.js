export const VRM0_EXTENSION_NAME = 'VRM'
export const VRMC_EXTENSION_NAME = 'VRMC_vrm'

const copyOf = (value) => JSON.parse(JSON.stringify(value))

export const makeVrmPassthrough = (extensionName) => {
  if (typeof extensionName !== 'string' || extensionName.length === 0) throw new TypeError('a VRM passthrough needs an extension name')
  let stored
  return {
    extensionName,
    read(jsonDoc) {
      const extensionDef = jsonDoc.json.extensions?.[extensionName]
      if (extensionDef === undefined) return this
      stored = copyOf(extensionDef)
      return this
    },
    write(jsonDoc) {
      if (stored === undefined) return this
      const { json } = jsonDoc
      json.extensions = json.extensions || {}
      json.extensions[extensionName] = copyOf(stored)
      return this
    },
    held() {
      return stored === undefined ? undefined : copyOf(stored)
    },
  }
}

export const vrm0Passthrough = () => makeVrmPassthrough(VRM0_EXTENSION_NAME)

export const vrmcPassthrough = () => makeVrmPassthrough(VRMC_EXTENSION_NAME)
