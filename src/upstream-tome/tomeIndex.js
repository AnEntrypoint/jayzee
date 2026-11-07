const HEADER = 'Heading'
const COLUMNS = 4
const BUILTIN_PREFIX = 'sections/builtin-'

const cellsOf = (line) => line.slice(1, line.lastIndexOf('|')).split('|').map((cell) => cell.trim())

export function parseTomeIndex(text) {
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue
    const cells = cellsOf(line)
    if (cells[0] === HEADER) continue
    if (cells.length !== COLUMNS) throw new Error('tome index row has ' + cells.length + ' cells, expected ' + COLUMNS + ': ' + cells[0])
    const [heading, file, bytes, source] = cells
    const size = Number(bytes)
    if (!Number.isInteger(size) || size < 0) throw new Error('tome index bytes is not a count: ' + bytes)
    rows.push({ heading, file, bytes: size, source })
  }
  return rows
}

export function summarizeTome(rows) {
  const counts = new Map()
  for (const row of rows) counts.set(row.heading, (counts.get(row.heading) ?? 0) + 1)
  return {
    rows: rows.length,
    distinctHeadings: counts.size,
    repeatedHeadings: [...counts].filter(([, n]) => n > 1).map(([heading]) => heading),
    distinctFiles: new Set(rows.map((row) => row.file)).size,
    builtin: rows.filter((row) => row.file.startsWith(BUILTIN_PREFIX)).length,
    totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
  }
}
