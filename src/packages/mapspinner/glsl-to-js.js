export class GlslTranspileError extends Error {
  constructor(code, message, line) {
    super(`${code}: ${message}${line ? ` (line ${line})` : ''}`)
    this.name = 'GlslTranspileError'
    this.code = code
    this.line = line ?? null
  }
}

const SCALARS = ['float', 'int', 'bool', 'uint']
const VECTORS = ['vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4']
const SAME_AS_ARGS = ['fract', 'floor', 'ceil', 'abs', 'sign', 'sqrt', 'sin', 'cos', 'tan', 'exp', 'tanh', 'pow', 'min', 'max', 'mod', 'clamp', 'mix', 'step', 'smoothstep', 'normalize']
const TO_FLOAT = ['dot', 'length', 'distance']
const ARITHMETIC = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' }
const COMPARISONS = ['<', '>', '<=', '>=', '==', '!=']
const PRECISIONS = ['highp', 'mediump', 'lowp']
const SWIZZLE = /^[xyzw]{1,4}$|^[rgba]{1,4}$|^[stpq]{1,4}$/
const TOKEN = /\s+|([A-Za-z_]\w*)|((?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)|(\+\+|--|\+=|-=|\*=|\/=|<=|>=|==|!=|&&|\|\||[-+*/<>=!?:;,.(){}[\]])/y

const isVector = (type) => VECTORS.includes(type)
const fail = (code, message, line) => {
  throw new GlslTranspileError(code, message, line)
}

function tokenize(source) {
  if (typeof source !== 'string') fail('glsl-source-not-text', 'the GLSL source must be a string')
  const tokens = []
  let line = 1
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < source.length) {
    const at = TOKEN.lastIndex
    const m = TOKEN.exec(source)
    if (m === null) fail('glsl-bad-character', `unexpected character ${JSON.stringify(source[at])}`, line)
    if (m[1] !== undefined) tokens.push({ kind: 'name', text: m[1], line })
    else if (m[2] !== undefined) tokens.push({ kind: 'number', text: m[2], line })
    else if (m[3] !== undefined) tokens.push({ kind: 'op', text: m[3], line })
    for (const ch of m[0]) if (ch === '\n') line++
  }
  tokens.push({ kind: 'end', text: '', line })
  return tokens
}

export function transpileGlsl(source, options = {}) {
  const runtime = options.runtime ?? 'g'
  const uniformsName = options.uniformsName ?? 'U'
  const factoryName = options.factoryName ?? 'makeHeight'
  const runtimePath = options.runtimePath ?? './glsl-rt.js'
  const tokens = tokenize(source)
  let pos = 0
  const structs = new Map()
  const consts = new Map()
  const uniforms = new Map()
  const functions = new Map()
  const externs = []
  const constLines = []
  const functionLines = []
  let scopes = []

  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const at = (text) => peek().text === text && peek().kind !== 'number'
  const eat = (text) => {
    if (!at(text)) fail('glsl-unexpected-token', `expected ${JSON.stringify(text)}, found ${JSON.stringify(peek().text)}`, peek().line)
    return next()
  }
  const isType = (text) => SCALARS.includes(text) || isVector(text) || structs.has(text)
  const name = () => {
    const t = next()
    if (t.kind !== 'name') fail('glsl-unexpected-token', `expected a name, found ${JSON.stringify(t.text)}`, t.line)
    return t.text
  }
  const skipPrecision = () => {
    while (PRECISIONS.includes(peek().text)) next()
  }
  const typeName = () => {
    skipPrecision()
    const t = next()
    if (!isType(t.text)) fail('glsl-unknown-type', `unknown type ${JSON.stringify(t.text)}`, t.line)
    return t.text
  }
  const lookup = (id, line) => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(id)) return { js: id, type: scopes[i].get(id) }
    if (consts.has(id)) return { js: id, type: consts.get(id) }
    if (uniforms.has(id)) return { js: `${uniformsName}.${id}`, type: uniforms.get(id) }
    return fail('glsl-unknown-name', `${id} is not declared`, line)
  }
  const declare = (id, type, line) => {
    const scope = scopes[scopes.length - 1]
    if (scope.has(id)) fail('glsl-redeclared', `${id} is declared twice in one scope`, line)
    scope.set(id, type)
  }
  const widest = (args) => {
    const vector = args.find((a) => isVector(a.type))
    return vector ? vector.type : args.every((a) => a.type === 'int') ? 'int' : 'float'
  }

  function call(id, args, line) {
    const list = args.map((a) => a.js).join(', ')
    if (isVector(id)) return { js: `${runtime}.${id}(${list})`, type: id }
    if (id === 'float' || id === 'int') return { js: `${runtime}.${id}(${list})`, type: id }
    if (structs.has(id)) {
      const fields = structs.get(id)
      if (fields.length !== args.length) fail('glsl-constructor-arity', `${id} has ${fields.length} fields, the constructor passes ${args.length}`, line)
      return { js: `Object.freeze({ ${fields.map((f, i) => `${f.name}: ${args[i].js}`).join(', ')} })`, type: id }
    }
    if (functions.has(id)) {
      const fn = functions.get(id)
      if (fn.params.length !== args.length) fail('glsl-call-arity', `${id} takes ${fn.params.length} arguments, the call passes ${args.length}`, line)
      return { js: `${id}(${list})`, type: fn.type }
    }
    if (SAME_AS_ARGS.includes(id)) return { js: `${runtime}.${id}(${list})`, type: widest(args) === 'int' ? 'float' : widest(args) }
    if (TO_FLOAT.includes(id)) return { js: `${runtime}.${id}(${list})`, type: 'float' }
    if (id === 'cross') return { js: `${runtime}.cross(${list})`, type: 'vec3' }
    return fail('glsl-unknown-function', `${id} is neither declared nor a supported builtin`, line)
  }

  function primary() {
    const t = next()
    if (t.kind === 'number') return { js: t.text, type: /[.eE]/.test(t.text) ? 'float' : 'int' }
    if (t.text === '(') {
      const inner = ternary()
      eat(')')
      return { js: `(${inner.js})`, type: inner.type }
    }
    if (t.kind !== 'name') fail('glsl-unexpected-token', `unexpected ${JSON.stringify(t.text)}`, t.line)
    if (t.text === 'true' || t.text === 'false') return { js: t.text, type: 'bool' }
    if (isType(t.text) && at('[')) {
      next()
      if (!at(']')) ternary()
      eat(']')
      eat('(')
      const items = argumentList()
      for (const item of items) if (item.type !== t.text) fail('glsl-array-element-type', `an array of ${t.text} holds a ${item.type}`, t.line)
      return { js: `Object.freeze([${items.map((i) => i.js).join(', ')}])`, type: t.text + '[]' }
    }
    if (at('(')) {
      next()
      return call(t.text, argumentList(), t.line)
    }
    return lookup(t.text, t.line)
  }

  function argumentList() {
    const args = []
    if (at(')')) {
      next()
      return args
    }
    for (;;) {
      args.push(ternary())
      if (at(',')) {
        next()
        continue
      }
      eat(')')
      return args
    }
  }

  function postfix() {
    let value = primary()
    for (;;) {
      if (at('.')) {
        const line = next().line
        const field = name()
        if (isVector(value.type)) {
          if (!SWIZZLE.test(field)) fail('glsl-bad-swizzle', `${field} is not a swizzle of ${value.type}`, line)
          value = { js: `${runtime}.sw(${value.js}, '${field}')`, type: field.length === 1 ? (value.type.startsWith('i') ? 'int' : 'float') : (value.type.startsWith('i') ? 'ivec' : 'vec') + field.length }
        } else if (structs.has(value.type)) {
          const found = structs.get(value.type).find((f) => f.name === field)
          if (!found) fail('glsl-unknown-field', `${value.type} has no field ${field}`, line)
          value = { js: `${value.js}.${field}`, type: found.type }
        } else {
          fail('glsl-field-of-scalar', `${field} is read from a ${value.type}`, line)
        }
      } else if (at('[')) {
        const line = next().line
        const index = ternary()
        eat(']')
        if (index.type !== 'int') fail('glsl-index-not-int', `an index must be an int, got ${index.type}`, line)
        if (value.type.endsWith('[]')) value = { js: `${value.js}[${index.js}]`, type: value.type.slice(0, -2) }
        else if (isVector(value.type)) value = { js: `${value.js}[${index.js}]`, type: value.type.startsWith('i') ? 'int' : 'float' }
        else fail('glsl-index-of-scalar', `a ${value.type} cannot be indexed`, line)
      } else {
        return value
      }
    }
  }

  function unary() {
    if (at('-')) {
      next()
      const value = unary()
      return isVector(value.type) ? { js: `${runtime}.neg(${value.js})`, type: value.type } : { js: `-${value.js}`, type: value.type }
    }
    if (at('!')) {
      next()
      return { js: `!${unary().js}`, type: 'bool' }
    }
    return postfix()
  }

  function arithmetic(op, a, b, line) {
    if (structs.has(a.type) || structs.has(b.type) || a.type === 'bool' || b.type === 'bool') fail('glsl-arithmetic-type', `${op} is applied to ${a.type} and ${b.type}`, line)
    if (isVector(a.type) || isVector(b.type)) return { js: `${runtime}.${ARITHMETIC[op]}(${a.js}, ${b.js})`, type: isVector(a.type) ? a.type : b.type }
    if (a.type === 'int' && b.type === 'int') return op === '/' ? { js: `Math.trunc(${a.js} / ${b.js})`, type: 'int' } : { js: `(${a.js} ${op} ${b.js})`, type: 'int' }
    return { js: `(${a.js} ${op} ${b.js})`, type: 'float' }
  }

  function leftAssociative(operators, operand, combine) {
    let left = operand()
    while (peek().kind === 'op' && operators.includes(peek().text)) {
      const t = next()
      left = combine(t.text, left, operand(), t.line)
    }
    return left
  }

  const product = () => leftAssociative(['*', '/'], unary, arithmetic)
  const sum = () => leftAssociative(['+', '-'], product, arithmetic)
  const compare = (op, a, b, line) => {
    if (isVector(a.type) || isVector(b.type)) fail('glsl-vector-comparison', `${op} between vectors is not supported`, line)
    return { js: `(${a.js} ${op === '==' ? '===' : op === '!=' ? '!==' : op} ${b.js})`, type: 'bool' }
  }
  const comparison = () => leftAssociative(COMPARISONS, sum, compare)
  const logical = (op, a, b) => ({ js: `(${a.js} ${op} ${b.js})`, type: 'bool' })
  const conjunction = () => leftAssociative(['&&'], comparison, logical)
  const disjunction = () => leftAssociative(['||'], conjunction, logical)

  function ternary() {
    const condition = disjunction()
    if (!at('?')) return condition
    const line = next().line
    const yes = ternary()
    eat(':')
    const no = ternary()
    if (yes.type !== no.type && !(SCALARS.includes(yes.type) && SCALARS.includes(no.type))) fail('glsl-ternary-types', `the branches are ${yes.type} and ${no.type}`, line)
    return { js: `(${condition.js} ? ${yes.js} : ${no.js})`, type: yes.type === 'int' && no.type === 'float' ? 'float' : yes.type }
  }

  function declaration(pad) {
    const type = typeName()
    const parts = []
    for (;;) {
      const t = peek()
      const id = name()
      if (at('=')) {
        next()
        const value = ternary()
        declare(id, type, t.line)
        parts.push(`${id} = ${value.js}`)
      } else {
        declare(id, type, t.line)
        parts.push(id)
      }
      if (at(',')) {
        next()
        continue
      }
      break
    }
    return `${pad}let ${parts.join(', ')}`
  }

  function assignment(pad) {
    const t = peek()
    const id = name()
    const target = lookup(id, t.line)
    if (target.js !== id) fail('glsl-assign-to-global', `${id} is not a local variable`, t.line)
    if (at('++') || at('--')) return `${pad}${id}${next().text}`
    const op = next()
    if (op.text === '=') return `${pad}${id} = ${ternary().js}`
    if (!['+=', '-=', '*=', '/='].includes(op.text)) fail('glsl-unexpected-token', `expected an assignment, found ${JSON.stringify(op.text)}`, op.line)
    const value = ternary()
    if (isVector(target.type)) return `${pad}${id} = ${runtime}.${ARITHMETIC[op.text[0]]}(${id}, ${value.js})`
    if (isVector(value.type)) fail('glsl-arithmetic-type', `a ${value.type} is assigned into the ${target.type} ${id}`, op.line)
    return `${pad}${id} ${op.text} ${value.js}`
  }

  function simple(pad) {
    skipPrecision()
    return isType(peek().text) && tokens[pos + 1].kind === 'name' ? declaration(pad) : assignment(pad)
  }

  function block(pad, out) {
    eat('{')
    scopes.push(new Map())
    while (!at('}')) statement(pad, out)
    scopes.pop()
    next()
  }

  function body(pad, out) {
    if (at('{')) {
      block(pad, out)
      return
    }
    scopes.push(new Map())
    statement(pad, out)
    scopes.pop()
  }

  function statement(pad, out) {
    const t = peek()
    if (t.text === 'return') {
      next()
      out.push(`${pad}return ${ternary().js}`)
      eat(';')
    } else if (t.text === 'if') {
      next()
      eat('(')
      const condition = ternary()
      eat(')')
      out.push(`${pad}if (${condition.js}) {`)
      body(pad + '  ', out)
      if (at('else')) {
        next()
        out.push(`${pad}} else {`)
        body(pad + '  ', out)
      }
      out.push(`${pad}}`)
    } else if (t.text === 'for') {
      next()
      eat('(')
      scopes.push(new Map())
      const init = simple('')
      eat(';')
      const condition = ternary()
      eat(';')
      const step = assignment('')
      eat(')')
      out.push(`${pad}for (${init}; ${condition.js}; ${step}) {`)
      body(pad + '  ', out)
      scopes.pop()
      out.push(`${pad}}`)
    } else if (t.text === '{') {
      block(pad, out)
    } else {
      out.push(simple(pad))
      eat(';')
    }
  }

  function parameters() {
    eat('(')
    const params = []
    while (!at(')')) {
      if (at('in')) next()
      skipPrecision()
      const type = typeName()
      params.push({ type, name: name() })
      if (at(',')) next()
    }
    next()
    return params
  }

  function topLevel() {
    const t = peek()
    if (t.text === 'struct') {
      next()
      const id = name()
      eat('{')
      const fields = []
      while (!at('}')) {
        const type = typeName()
        fields.push({ type, name: name() })
        eat(';')
      }
      next()
      eat(';')
      structs.set(id, fields)
      return
    }
    if (t.text === 'uniform') {
      next()
      const type = typeName()
      uniforms.set(name(), type)
      eat(';')
      return
    }
    if (t.text === 'const') {
      next()
      const type = typeName()
      const id = name()
      let array = false
      if (at('[')) {
        next()
        if (!at(']')) ternary()
        eat(']')
        array = true
      }
      eat('=')
      const value = ternary()
      eat(';')
      const declared = array ? type + '[]' : type
      if (value.type !== declared && !(SCALARS.includes(value.type) && SCALARS.includes(declared))) fail('glsl-const-type', `${id} is declared ${declared} and initialised with ${value.type}`, t.line)
      if (consts.has(id)) fail('glsl-redeclared', `${id} is declared twice`, t.line)
      consts.set(id, declared)
      constLines.push(`export const ${id} = ${value.js}`)
      return
    }
    const type = typeName()
    const id = name()
    const params = parameters()
    if (functions.has(id)) fail('glsl-redeclared', `function ${id} is declared twice`, t.line)
    functions.set(id, { type, params })
    if (at(';')) {
      next()
      externs.push(id)
      return
    }
    scopes = [new Map(params.map((p) => [p.name, p.type]))]
    const out = [`  function ${id}(${params.map((p) => p.name).join(', ')}) {`]
    eat('{')
    while (!at('}')) statement('    ', out)
    next()
    out.push('  }', '')
    scopes = []
    functionLines.push(...out)
  }

  while (peek().kind !== 'end') topLevel()

  const defined = [...functions.keys()].filter((id) => !externs.includes(id))
  const exported = options.exports ?? defined
  for (const id of exported) if (!defined.includes(id)) fail('glsl-export-unknown', `${id} is exported and never defined`)
  const lines = [`import * as ${runtime} from '${runtimePath}'`, '', ...constLines, '']
  lines.push(`export function ${factoryName}(${[uniformsName, ...externs].join(', ')}) {`, ...functionLines, `  return { ${exported.join(', ')} }`, '}', '')
  return {
    code: lines.join('\n'),
    constants: [...consts.keys()],
    uniforms: [...uniforms.keys()],
    externs,
    functions: defined,
    exports: exported,
    factoryName,
  }
}

export function compileGlsl(source, runtimeModule, options = {}) {
  if (runtimeModule === null || typeof runtimeModule !== 'object') fail('glsl-runtime-missing', 'compileGlsl needs the glsl runtime module')
  const result = transpileGlsl(source, options)
  const runtime = options.runtime ?? 'g'
  const bodyText = result.code
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .map((line) => line.replace(/^export const /, 'const ').replace(/^export function /, 'function '))
    .join('\n')
  const build = new Function(runtime, `${bodyText}\nreturn { ${[result.factoryName, ...result.constants].join(', ')} }`)
  return { ...build(runtimeModule), transpiled: result }
}
