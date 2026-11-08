import { canon } from './canon.mjs'

const hosts = [
  ['no host', undefined],
  ['null host', null],
  ['empty host', {}],
  ['a host that is a number', 5],
  ['valid arrays and numbers', {
    __poolDispLo: [0.1, 0.2, 0.3, 0.4],
    __poolDispHi: [0.5, 0.6, 0.7, 0.8],
    __poolSpecExpRough: 10,
    __poolSpecExpSharp: 100,
    __poolSlope0: 0.05,
    __poolSlope1: 0.5,
    __poolCover: 0.3,
    __wetness: 0.5,
  }],
  ['wrong lengths', { __poolDispLo: [1, 2, 3], __poolDispHi: [1, 2, 3, 4, 5] }],
  ['non-finite entries', { __poolDispLo: [1, NaN, 3, 4], __poolDispHi: [1, 2, Infinity, 4] }],
  ['string entries and a string array', { __poolDispLo: ['1', '2', '3', '4'], __poolDispHi: 'abcd' }],
  ['negative zero and extremes', { __poolCover: -0, __poolSpecExpRough: -0, __poolSpecExpSharp: 1e308, __poolSlope0: -1e-300, __poolSlope1: 5e-324 }],
  ['coerced numbers', { __poolSpecExpRough: '12', __poolSpecExpSharp: '', __poolSlope0: true, __poolSlope1: null, __poolCover: [0.25] }],
  ['NaN and Infinity numbers', { __poolSpecExpRough: NaN, __poolSpecExpSharp: Infinity, __poolSlope0: -Infinity, __poolCover: 'x' }],
  ['wetness below zero', { __wetness: -1 }],
  ['wetness above one', { __wetness: 2.5 }],
  ['wetness as a string', { __wetness: '0.25' }],
  ['wetness null', { __wetness: null }],
  ['wetness NaN', { __wetness: NaN }],
  ['wetness -0', { __wetness: -0 }],
]

export const runPoolParamsScenario = (api) => {
  const poolParams = []
  const wetness = []
  for (const [label, host] of hosts) {
    poolParams.push([label, canon(api.resolvePoolParams(host))])
    wetness.push([label, canon(api.resolveWetness(host))])
  }
  return { poolParams, wetness }
}

export const HOST_LABELS = hosts.map(([label]) => label)
