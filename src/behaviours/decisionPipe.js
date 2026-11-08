export class DecisionPipeError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'DecisionPipeError'
    this.code = code
  }
}

const QUESTION_TYPES = ['boolean', 'choice', 'score']

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

const isWeight = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0

export function validateQuestions(questions) {
  if (!isPlainObject(questions) || Object.keys(questions).length === 0) {
    throw new DecisionPipeError('no-questions', 'questions must be a non-empty object keyed by name')
  }
  for (const [name, q] of Object.entries(questions)) {
    if (!isPlainObject(q) || !QUESTION_TYPES.includes(q.type)) {
      throw new DecisionPipeError('bad-type', `question "${name}" needs type boolean, choice or score`)
    }
    if (q.type === 'choice' && (!isPlainObject(q.criteria) || Object.keys(q.criteria).length === 0)) {
      throw new DecisionPipeError('no-criteria', `choice question "${name}" needs criteria keyed by option`)
    }
    if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length === 0)) {
      throw new DecisionPipeError('no-criteria', `score question "${name}" needs ordered criteria steps`)
    }
  }
  return questions
}

const sumProbabilities = (probabilities) => Object.values(probabilities).reduce((acc, p) => acc + p, 0)

const weightedAnswer = (name, label, options, raw) => {
  const probs = isPlainObject(raw?.probabilities) ? raw.probabilities : null
  if (!probs || options.some((o) => !isWeight(probs[o]))) {
    throw new DecisionPipeError('malformed-answer', `${label} answer "${name}" needs a finite non-negative probability per option`)
  }
  const probabilities = Object.fromEntries(options.map((o) => [o, probs[o]]))
  if (!(sumProbabilities(probabilities) > 0)) {
    throw new DecisionPipeError('malformed-answer', `${label} answer "${name}" has no probability mass`)
  }
  return { options, probabilities }
}

export function normalizeAnswers(raw, questions) {
  if (!isPlainObject(raw)) throw new DecisionPipeError('malformed-answer', 'answers must be an object')
  const out = {}
  for (const [name, q] of Object.entries(questions)) {
    const a = raw[name]
    if (q.type === 'boolean') {
      if (!isPlainObject(a) || typeof a.probability !== 'number' || !(a.probability >= 0 && a.probability <= 1)) {
        throw new DecisionPipeError('malformed-answer', `boolean answer "${name}" needs probability in [0,1]`)
      }
      out[name] = a
    } else if (q.type === 'choice') {
      out[name] = weightedAnswer(name, 'choice', Object.keys(q.criteria), a)
    } else {
      out[name] = weightedAnswer(name, 'score', q.criteria, a)
    }
  }
  return out
}

export function sampleAnswer(answer, roll) {
  if (typeof answer.probability === 'number') return roll < answer.probability
  const total = sumProbabilities(answer.probabilities)
  let cursor = roll * total
  for (const option of answer.options) {
    cursor -= answer.probabilities[option]
    if (cursor < 0) return option
  }
  return answer.options[answer.options.length - 1]
}

const drawRoll = (random) => {
  const roll = random()
  if (!(roll >= 0 && roll < 1)) throw new DecisionPipeError('bad-roll', 'random() must return a number in [0,1)')
  return roll
}

export function createDecisionPipe({ ask, random }) {
  if (typeof ask !== 'function') throw new DecisionPipeError('no-backend', 'ask must be a function')
  if (typeof random !== 'function') throw new DecisionPipeError('no-random', 'random must be a function')
  return async function decide({ state, questions }) {
    validateQuestions(questions)
    let raw
    try {
      raw = await ask({ state, questions })
    } catch (err) {
      return { ok: false, error: { code: 'ask-failed', message: String(err?.message ?? err) } }
    }
    let normalized
    try {
      normalized = normalizeAnswers(raw, questions)
    } catch (err) {
      return { ok: false, error: { code: err.code ?? 'malformed-answer', message: err.message } }
    }
    const sampled = {}
    for (const [name, answer] of Object.entries(normalized)) sampled[name] = sampleAnswer(answer, drawRoll(random))
    return { ok: true, data: { answers: sampled, probabilities: normalized } }
  }
}
