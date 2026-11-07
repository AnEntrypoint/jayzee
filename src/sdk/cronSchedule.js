const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 6 },
]

const FIELD_PART = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/

export class CronSyntaxError extends Error {
  constructor(reasonCode, detail) {
    super(`[cron] ${reasonCode}: ${detail}`)
    this.name = 'CronSyntaxError'
    this.reasonCode = reasonCode
  }
}

function parseField(text, field) {
  const values = new Set()
  for (const part of text.split(',')) {
    const match = FIELD_PART.exec(part)
    if (!match) throw new CronSyntaxError('bad-field', `${field.name}: ${part}`)
    const step = match[3] === undefined ? 1 : Number(match[3])
    if (!(step >= 1)) throw new CronSyntaxError('bad-step', `${field.name}: ${part}`)
    const low = match[1] === '*' ? field.min : Number(match[1])
    const high = match[2] !== undefined ? Number(match[2]) : match[1] === '*' || match[3] !== undefined ? field.max : low
    if (low < field.min || high > field.max || low > high) {
      throw new CronSyntaxError('out-of-range', `${field.name}: ${part}`)
    }
    for (let value = low; value <= high; value += step) values.add(value)
  }
  return { values, wildcard: text === '*' }
}

export function parseCron(expr) {
  if (typeof expr !== 'string') throw new CronSyntaxError('not-a-string', typeof expr)
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== FIELDS.length) throw new CronSyntaxError('field-count', expr)
  const [minute, hour, dayOfMonth, month, dayOfWeek] = FIELDS.map((field, index) => parseField(parts[index], field))
  return {
    expr,
    minute: minute.values,
    hour: hour.values,
    dayOfMonth: dayOfMonth.values,
    month: month.values,
    dayOfWeek: dayOfWeek.values,
    domRestricted: !dayOfMonth.wildcard,
    dowRestricted: !dayOfWeek.wildcard,
  }
}

export function cronMatches(cron, date) {
  if (!cron.minute.has(date.getUTCMinutes())) return false
  if (!cron.hour.has(date.getUTCHours())) return false
  if (!cron.month.has(date.getUTCMonth() + 1)) return false
  const dayOfMonthOk = cron.dayOfMonth.has(date.getUTCDate())
  const dayOfWeekOk = cron.dayOfWeek.has(date.getUTCDay())
  if (cron.domRestricted && cron.dowRestricted) return dayOfMonthOk || dayOfWeekOk
  return dayOfMonthOk && dayOfWeekOk
}

export function parseCrons(entries) {
  const seen = new Set()
  return entries.map(({ name, schedule }) => {
    if (seen.has(name)) throw new CronSyntaxError('duplicate-name', name)
    seen.add(name)
    return { name, cron: parseCron(schedule) }
  })
}

export function dueCrons(crons, nowMs) {
  const minute = new Date(Math.floor(nowMs / 60000) * 60000)
  return crons.filter(entry => cronMatches(entry.cron, minute)).map(entry => entry.name)
}
