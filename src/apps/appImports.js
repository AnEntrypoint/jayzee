export const ENGINE_ALIASES = Object.freeze({
  '@spoint/ecs': '/node_modules/@spoint/ecs/src/index.js',
  'three': '/node_modules/three/build/three.module.js',
})

const escapeForPattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const localImportPattern = (aliases) => {
  const specifiers = [String.raw`\.[^'"]+`, String.raw`\/[^'"]+`, ...Object.keys(aliases).map(escapeForPattern)]
  return new RegExp(String.raw`((?:from|import)\s*)(['"])(` + specifiers.join('|') + String.raw`)\2`, 'g')
}

export function localSpecifiers(source, aliases = ENGINE_ALIASES) {
  const found = new Set()
  for (const match of source.matchAll(localImportPattern(aliases))) {
    if (!Object.hasOwn(aliases, match[3])) found.add(match[3])
  }
  return [...found]
}

export function engineAliasUrls(origin, aliases = ENGINE_ALIASES) {
  return Object.fromEntries(Object.entries(aliases).map(([specifier, path]) => [specifier, origin + path]))
}

export function rewriteLocalSpecifiers(source, urlBySpecifier, aliases = ENGINE_ALIASES) {
  return source.replace(localImportPattern(aliases), (whole, prefix, quote, specifier) =>
    urlBySpecifier[specifier] ? `${prefix}${quote}${urlBySpecifier[specifier]}${quote}` : whole
  )
}
