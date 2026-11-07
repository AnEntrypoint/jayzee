const HEADER = 'id'
const COLUMNS = 4
const SHA256 = /^[0-9a-f]{64}$/

const cellsOf = (line) => line.slice(1, line.lastIndexOf('|')).split('|').map((cell) => cell.trim())

export function parseSkillIndex(text) {
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue
    const cells = cellsOf(line)
    if (cells[0] === HEADER) continue
    if (cells.length !== COLUMNS) throw new Error('skill index row has ' + cells.length + ' cells, expected ' + COLUMNS + ': ' + cells[0])
    const [id, name, description, bytes] = cells
    const size = Number(bytes)
    if (!Number.isInteger(size) || size < 0) throw new Error('skill index bytes is not a count: ' + bytes)
    rows.push({ id, name, description, bytes: size })
  }
  return rows
}

export function parseManifest(text) {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha256, size, name] = line.split(' ')
      const count = Number(size)
      if (!SHA256.test(sha256) || !Number.isInteger(count) || count < 0 || !name) throw new Error('manifest line is malformed: ' + line)
      return { sha256, size: count, name }
    })
}

export function summarizeSkills(index, manifest) {
  const entries = new Map(manifest.map((entry) => [entry.name, entry]))
  return {
    served: index.length,
    entries: manifest.length,
    json: manifest.filter((entry) => entry.name.endsWith('.json')).length,
    md: manifest.filter((entry) => entry.name.endsWith('.md')).length,
    missingJson: index.filter((row) => !entries.has(row.id + '.json')).map((row) => row.id),
    missingMd: index.filter((row) => !entries.has(row.id + '.md')).map((row) => row.id),
    byteColumnOffsets: index
      .filter((row) => entries.get(row.id + '.md')?.size !== row.bytes)
      .map((row) => ({ id: row.id, indexBytes: row.bytes, fileBytes: entries.get(row.id + '.md')?.size ?? null })),
  }
}
