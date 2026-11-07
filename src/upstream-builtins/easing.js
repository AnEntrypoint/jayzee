const PI = Math.PI

function unit(t) {
  if (typeof t !== 'number' || !(t >= 0 && t <= 1)) throw new RangeError('easing takes t in [0, 1], got ' + t)
  return t
}

const reflect = (t) => -2 * t + 2

const outBounce = (t) => {
  const n = 7.5625
  const d = 2.75
  if (t < 1 / d) return n * t * t
  if (t < 2 / d) {
    const u = t - 1.5 / d
    return n * u * u + 0.75
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d
    return n * u * u + 0.9375
  }
  const u = t - 2.625 / d
  return n * u * u + 0.984375
}

const easings = {
  linear: (t) => unit(t),
  easeOutBounce: (t) => outBounce(unit(t)),
  easeInQuad: (t) => unit(t) ** 2,
  easeOutQuad: (t) => 1 - (1 - unit(t)) ** 2,
  easeInOutQuad: (t) => (unit(t) < 0.5 ? 2 * t * t : 1 - reflect(t) ** 2 / 2),
  easeInCubic: (t) => unit(t) ** 3,
  easeOutCubic: (t) => 1 - (1 - unit(t)) ** 3,
  easeInOutCubic: (t) => (unit(t) < 0.5 ? 4 * t ** 3 : 1 - reflect(t) ** 3 / 2),
  easeInQuart: (t) => unit(t) ** 4,
  easeOutQuart: (t) => 1 - (1 - unit(t)) ** 4,
  easeInOutQuart: (t) => (unit(t) < 0.5 ? 8 * t ** 4 : 1 - reflect(t) ** 4 / 2),
  easeInQuint: (t) => unit(t) ** 5,
  easeOutQuint: (t) => 1 - (1 - unit(t)) ** 5,
  easeInOutQuint: (t) => (unit(t) < 0.5 ? 16 * t ** 5 : 1 - reflect(t) ** 5 / 2),
  easeInSine: (t) => 1 - Math.cos((unit(t) * PI) / 2),
  easeOutSine: (t) => Math.sin((unit(t) * PI) / 2),
  easeInOutSine: (t) => (1 - Math.cos(PI * unit(t))) / 2,
  easeInExpo: (t) => (unit(t) === 0 ? 0 : 2 ** (10 * t - 10)),
  easeOutExpo: (t) => (unit(t) === 1 ? 1 : 1 - 2 ** (-10 * t)),
  easeInOutExpo: (t) => {
    unit(t)
    if (t === 0) return 0
    if (t === 1) return 1
    return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2
  },
  easeInCirc: (t) => 1 - Math.sqrt(1 - unit(t) ** 2),
  easeOutCirc: (t) => Math.sqrt(1 - (unit(t) - 1) ** 2),
  easeInOutCirc: (t) => (unit(t) < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - reflect(t) ** 2) + 1) / 2),
}

export const EASING_NAMES = Object.freeze(Object.keys(easings))

export const EASINGS = Object.freeze(easings)
