export function plain(value) {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value, (key, v) => (v instanceof Map ? [...v] : v)))
}

export function attempt(fn) {
  try {
    return { ok: true, value: plain(fn()) }
  } catch (error) {
    return { ok: false, name: error.name, message: error.message, reasonCode: error.reasonCode ?? null, code: error.code ?? null }
  }
}

export function scenarioDifference(expected, actual) {
  if (expected.name !== actual.name) return 'name ' + actual.name + ' != ' + expected.name
  const eb = JSON.stringify(expected.build ?? null), ab = JSON.stringify(actual.build ?? null)
  if (eb !== ab) return 'build ' + ab + ' != spoint ' + eb
  if (expected.trace.length !== actual.trace.length) return 'step count ' + actual.trace.length + ' != spoint ' + expected.trace.length
  for (let i = 0; i < expected.trace.length; i++) {
    const want = JSON.stringify(expected.trace[i]), got = JSON.stringify(actual.trace[i])
    if (want !== got) return 'step ' + i + ' (' + expected.trace[i].label + '): jayzee ' + got + ' spoint ' + want
  }
  return null
}
