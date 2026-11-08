import { defineHeightSpec, OCTAVE_ROTATION_COS, OCTAVE_ROTATION_SIN } from './height-spec.js'

export class Raw {
  constructor(v) { this.v = v }
}

const isVec = Array.isArray

export function createEagerOps({ precision = 'f64', carves = [], params, hpfFace, hpfRes }) {
  if (precision !== 'f64' && precision !== 'f32') throw new RangeError("jsgen: precision must be 'f64' or 'f32', got " + JSON.stringify(precision))
  const f32 = precision === 'f32'
  const F = f32 ? Math.fround : (x) => x
  const lit = (n) => (f32 && !Number.isInteger(n) ? Math.fround(n) : n)
  const V = (x) => {
    if (x instanceof Raw) return x.v
    if (typeof x === 'number') return lit(x)
    return x
  }
  const S = (x) => {
    if (x instanceof Raw) return x
    if (typeof x === 'number') return lit(x)
    if (isVec(x)) return x.map(S)
    return x
  }
  const lanes = (a, b) => (isVec(a) ? a.length : isVec(b) ? b.length : 0)
  const lane = (v, i) => (isVec(v) ? V(v[i]) : V(v))
  const laneS = (v, i) => (isVec(v) ? S(v[i]) : S(v))
  const map1 = (f) => (a) => (isVec(a) ? a.map((x) => f(V(x))) : f(V(a)))
  const map2 = (f) => (a, b) => {
    const n = lanes(a, b)
    if (n === 0) return f(V(a), V(b))
    const out = new Array(n)
    for (let i = 0; i < n; i++) out[i] = f(lane(a, i), lane(b, i))
    return out
  }
  const map3 = (f) => (a, b, c) => {
    const n = Math.max(lanes(a, b), isVec(c) ? c.length : 0)
    if (n === 0) return f(V(a), V(b), V(c))
    const out = new Array(n)
    for (let i = 0; i < n; i++) out[i] = f(lane(a, i), lane(b, i), lane(c, i))
    return out
  }
  const add = map2((x, y) => F(x + y))
  const sub = map2((x, y) => F(x - y))
  const mul = map2((x, y) => F(x * y))
  const div = map2((x, y) => F(x / y))
  const dot = (a, b) => {
    let s = F(V(a[0]) * V(b[0]))
    for (let i = 1; i < a.length; i++) s = F(s + F(V(a[i]) * V(b[i])))
    return s
  }
  const ops = {
    v3: (x, y, z) => [S(x), S(y), S(z)],
    x: (v) => v[0],
    y: (v) => v[1],
    z: (v) => v[2],
    swz: (v, s) => [...s].map((c) => v['xyzw'.indexOf(c)]),
    add,
    sub,
    mul,
    div,
    neg: map1((x) => F(-x)),
    floor: map1((x) => F(Math.floor(x))),
    fract: (a) => (isVec(a) ? a.map((x) => new Raw(V(x) - Math.floor(V(x)))) : new Raw(V(a) - Math.floor(V(a)))),
    abs: map1((x) => F(Math.abs(x))),
    pow: map2((x, y) => F(Math.pow(x, y))),
    max: map2((x, y) => F(Math.max(x, y))),
    min: map2((x, y) => F(Math.min(x, y))),
    clamp: map3((x, lo, hi) => F(Math.min(Math.max(x, lo), hi))),
    mix: (a, b, t) => add(a, mul(sub(b, a), t)),
    dot,
    normalize: (a) => {
      const l = F(Math.sqrt(dot(a, a)) || 1)
      return a.map((x) => F(V(x) / l))
    },
    sin: map1((x) => F(Math.sin(x))),
    cos: map1((x) => F(Math.cos(x))),
    gt: (a, b) => V(a) > V(b),
    lt: (a, b) => V(a) < V(b),
    ge: (a, b) => V(a) >= V(b),
    and: (a, b) => a && b,
    not: (a) => !a,
    sel: (c, a, b) => {
      if (isVec(a) || isVec(b)) {
        const n = lanes(a, b)
        const out = new Array(n)
        for (let i = 0; i < n; i++) out[i] = c ? laneS(a, i) : laneS(b, i)
        return out
      }
      return c ? S(a) : S(b)
    },
    let: (x) => x,
    u32: (x) => (V(x) | 0) >>> 0,
    umul: (a, b) => Math.imul(V(a), V(b)) >>> 0,
    uxor: (a, b) => (V(a) ^ V(b)) >>> 0,
    ushr: (a, n) => V(a) >>> n,
    ufloat: (a) => (f32 ? F(V(a)) : V(a)),
    octaveRotation: (i) => [OCTAVE_ROTATION_COS[i], OCTAVE_ROTATION_SIN[i]],
    carve: (i) => {
      const c = carves[i]
      return [[new Raw(c.dir[0]), new Raw(c.dir[1]), new Raw(c.dir[2])], new Raw(c.innerChord2), new Raw(c.outerChord2), new Raw(c.targetH)]
    },
    param: (name) => {
      const v = params[name]
      if (typeof v !== 'number') throw new TypeError('jsgen: param ' + name + ' must be a number, got ' + v)
      return lit(v)
    },
    hpfTexel: (face, x, y) => {
      const buf = hpfFace(V(face))
      const o = (V(y) * hpfRes + V(x)) * 4
      return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]
    },
    fold: (count, init, body) => {
      let state = init.map(S)
      for (let i = 0; i < count; i++) state = body(i, state).map(S)
      return state
    },
    fn: (name, inputs, type, impl) => {
      if (type !== 'float' || inputs.length !== 1 || inputs[0][1] !== 'vec3') throw new TypeError('jsgen: fn ' + name + ' must be (vec3) -> float')
      return (p) => S(impl(p.map(S)))
    },
  }
  return { ops, V }
}

export function createHeightEval({ hashVersion, carves = [], precision = 'f64', params, hpfFace, hpfRes }) {
  const { ops, V } = createEagerOps({ precision, carves, params, hpfFace, hpfRes })
  const spec = defineHeightSpec(ops, { hashVersion, carveCount: carves.length })
  return (dx, dy, dz) => V(spec.composeHeight([new Raw(dx), new Raw(dy), new Raw(dz)]))
}
