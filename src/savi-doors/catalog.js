const HTTP_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const ESCAPED_PIPE = '\\|'
const PIPE_MARK = '‖'
const HEADER_DOOR = 'Door'
const COLUMNS = 5

const cellsOf = (line) => {
  const marked = line.split(ESCAPED_PIPE).join(PIPE_MARK)
  return marked
    .slice(1, marked.lastIndexOf('|'))
    .split('|')
    .map((cell) => cell.trim().split(PIPE_MARK).join(ESCAPED_PIPE))
}

export const statusOf = (text) => {
  if (text.startsWith('exercised')) return 'exercised'
  if (text.startsWith('documented')) return 'documented'
  return 'other'
}

export function parseDoorCatalog(text) {
  const doors = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue
    const cells = cellsOf(line)
    if (cells[0] === HEADER_DOOR) continue
    if (cells.length !== COLUMNS) throw new Error('door catalog row has ' + cells.length + ' cells, expected ' + COLUMNS + ': ' + cells[0])
    const [door, method, path, detail, source] = cells
    doors.push({ door, method, path, state: statusOf(detail), detail, source })
  }
  return doors
}

export function summarizeDoors(doors) {
  const count = (state) => doors.filter((door) => door.state === state).length
  const withoutVerb = doors.filter((door) => !HTTP_VERBS.has(door.method)).map((door) => door.door)
  return {
    total: doors.length,
    exercised: count('exercised'),
    documented: count('documented'),
    other: count('other'),
    withVerb: doors.length - withoutVerb.length,
    withoutVerb,
  }
}
