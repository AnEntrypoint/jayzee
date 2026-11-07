const ENGINE_ROW = /\| builtin\/([a-z0-9-]+) \|/

export function builtinNamesFromEngine(text) {
  const names = []
  for (const line of text.split('\n')) {
    const match = ENGINE_ROW.exec(line)
    if (match) names.push(match[1])
  }
  return names
}

export function builtinNamesFromTome(rows) {
  return rows
    .filter((row) => row.file.startsWith('sections/builtin-') && row.file.endsWith('.md'))
    .map((row) => row.file.slice('sections/builtin-'.length, -'.md'.length))
}

export function compareNameSets(left, right) {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return {
    onlyLeft: [...leftSet].filter((name) => !rightSet.has(name)),
    onlyRight: [...rightSet].filter((name) => !leftSet.has(name)),
    duplicatesLeft: left.length - leftSet.size,
    duplicatesRight: right.length - rightSet.size,
  }
}
