const PREFIX = 'sections/builtin-'
const SUFFIX = '.md'

export function isBuiltinFile(file) {
  return file.startsWith(PREFIX) && file.endsWith(SUFFIX)
}

export function builtinNameOf(file) {
  return file.slice(PREFIX.length, -SUFFIX.length)
}

export function bindBuiltinBodies(sections, digestOf, expectedDigests) {
  const modules = []
  const seen = new Set()
  for (const section of sections.filter((item) => isBuiltinFile(item.file))) {
    const expected = expectedDigests[section.file]
    if (!expected) throw new Error('builtin body has no pinned digest: ' + section.file)
    if (digestOf(section.bytes) !== expected) throw new Error('builtin body does not match its pinned digest: ' + section.file)
    const name = builtinNameOf(section.file)
    if (seen.has(name)) throw new Error('builtin module listed twice: ' + name)
    seen.add(name)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(section.bytes)
    modules.push({ name, file: section.file, text, bytes: section.bytes.length })
  }
  return modules
}

export function builtinBody(modules, name) {
  return modules.find((module) => module.name === name) ?? null
}
