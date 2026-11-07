const FIELDS = ['id', 'name', 'description', 'content']

export function parseSkillJson(text) {
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object') throw new Error('skill json is not an object')
  for (const field of FIELDS) {
    if (typeof parsed[field] !== 'string') throw new Error('skill json field ' + field + ' is not a string')
  }
  return parsed
}

export function bindSkills(indexRows, manifest, readFile, digestOf) {
  const entries = new Map(manifest.map((entry) => [entry.name, entry]))
  return indexRows.map((row) => {
    const jsonName = row.id + '.json'
    const mdName = row.id + '.md'
    const jsonEntry = entries.get(jsonName)
    const mdEntry = entries.get(mdName)
    if (!jsonEntry || !mdEntry) throw new Error('skill ' + row.id + ' has no json or md entry in the manifest')
    const jsonBytes = readFile(jsonName)
    const mdBytes = readFile(mdName)
    if (!jsonBytes || !mdBytes) throw new Error('skill ' + row.id + ' has a missing body')
    for (const [name, bytes, entry] of [[jsonName, jsonBytes, jsonEntry], [mdName, mdBytes, mdEntry]]) {
      if (bytes.length !== entry.size) throw new Error('skill file ' + name + ' is ' + bytes.length + ' bytes, manifest says ' + entry.size)
      if (digestOf(bytes) !== entry.sha256) throw new Error('skill file ' + name + ' does not match its manifest sha256')
    }
    const json = parseSkillJson(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes))
    const body = new TextDecoder('utf-8', { fatal: true }).decode(mdBytes)
    if (json.id !== row.id) throw new Error('skill json id ' + json.id + ' is not ' + row.id)
    if (json.name !== row.name) throw new Error('skill ' + row.id + ' json name differs from the index')
    if (json.description !== row.description) throw new Error('skill ' + row.id + ' json description differs from the index')
    if (json.content !== body) throw new Error('skill ' + row.id + ' json content is not its md body')
    return { id: row.id, name: row.name, description: row.description, body, bytes: mdBytes.length }
  })
}

export function skillById(skills, id) {
  return skills.find((skill) => skill.id === id) ?? null
}

export function totalBodyBytes(skills) {
  return skills.reduce((sum, skill) => sum + skill.bytes, 0)
}
