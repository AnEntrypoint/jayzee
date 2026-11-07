const DEFAULT_BUS = 'Music'
const GAIN_MIN = 0
const GAIN_MAX = 2

const SHORT_WORDS = Object.freeze(['bd', 'sn', 'hh', 'cp', 'kick', 'snare', 'hat', 'clap', 'ride', 'tom', 'piano', 'pad', 'bass', 'bell', 'pluck', 'resolve'])
const SYNTHS = Object.freeze(['sawtooth', 'square', 'sine', 'triangle'])
const PITCHED = Object.freeze([
  'vsco_piano', 'vsco_piano_alt', 'vsco_harp', 'vsco_glock', 'vsco_xylo', 'vsco_marimba_loud',
  'vsco_cellos', 'vsco_cellos_spicc', 'vsco_cellos_sus_vib', 'vsco_cellos_trem',
  'vsco_violins_pizz', 'vsco_violins_spicc', 'vsco_violins_sus_vib', 'vsco_violins_trem',
  'vsco_violin_pizz', 'vsco_violin_spicc', 'vsco_violin_trem', 'vsco_violin_vib',
  'vsco_violas_pizz', 'vsco_violas_spicc', 'vsco_violas_sus_vib', 'vsco_violas_trem',
  'vsco_contrabass_pizz', 'vsco_contrabass_spicc', 'vsco_contrabass_sus_nv', 'vsco_contrabass_sus_vib', 'vsco_contrabass_trem',
  'vsco_flute', 'vsco_flute_stac', 'vsco_flute_sus_nv', 'vsco_flute_sus_vib',
  'vsco_piccolo_stac', 'vsco_piccolo_sus',
  'vsco_oboe', 'vsco_oboe_sus', 'vsco_oboe_vib',
  'vsco_clarinet', 'vsco_clarinet_stac',
  'vsco_bassoon_stac', 'vsco_bassoon_sus', 'vsco_bassoon_vib',
  'vsco_horn_mute', 'vsco_horn_stac', 'vsco_horn_sus',
  'vsco_trumpet_stac', 'vsco_trumpet_sus', 'vsco_trumpet_sus_vib', 'vsco_trumpet_harmonmute', 'vsco_trumpet_strmute',
  'vsco_trombone_stac', 'vsco_trombone_sus', 'vsco_trombone_vib',
  'vsco_tuba_stac', 'vsco_tuba_sus',
  'vsco_organ', 'vsco_timpani',
])
const ONE_SHOT_PREFIXES = Object.freeze(['bd_', 'sn_', 'hat_', 'ride_', 'drum_', 'elec_', 'perc_', 'tabla_', 'glitch_', 'bass_', 'guit_', 'ambi_', 'loop_', 'vinyl_'])
const INSTRUMENT_WORDS = Object.freeze(['harp', 'violins', 'violin', 'violas', 'cellos', 'contrabass', 'flute', 'piccolo', 'oboe', 'clarinet', 'bassoon', 'horn', 'trumpet', 'trombone', 'tuba', 'glock', 'xylo', 'marimba', 'organ', 'timpani'])

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

export const validateAudio = (audio) => {
  if (!audio || typeof audio !== 'object') throw new TypeError('vibe audio is { kind, script, params, gain, bus, paused }')
  if (audio.kind !== 'vibe') throw new RangeError('kind is vibe')
  if (!isFiniteNumber(audio.gain) || audio.gain < GAIN_MIN || audio.gain > GAIN_MAX) throw new RangeError('gain is required and ranges from 0 to 2')
  if (audio.paused !== undefined && typeof audio.paused !== 'boolean') throw new TypeError('paused takes a boolean')
  const bus = audio.bus ?? DEFAULT_BUS
  if (bus !== DEFAULT_BUS) throw new RangeError('bus ' + bus + ' has no documented behaviour in savi; only the default Music bus is accepted')
  return { gain: audio.gain, paused: audio.paused === true, bus }
}

export const setBpm = (n) => {
  if (!isFiniteNumber(n) || n <= 0) throw new RangeError('setBpm takes a positive number of beats per minute')
  return n
}

export const setCps = (n) => {
  if (!isFiniteNumber(n) || n <= 0) throw new RangeError('setCps takes a positive number of cycles per second')
  return n
}

export const setSwing = (amount) => {
  if (!isFiniteNumber(amount) || amount < 0) throw new RangeError('setSwing takes a finite amount of zero or more; the range is not stated in savi')
  return amount
}

export const resolveSample = (name) => {
  if (typeof name !== 'string' || name === '') throw new TypeError('a sample name is a non-empty string')
  if (SHORT_WORDS.includes(name)) return { kind: 'short', name }
  if (SYNTHS.includes(name)) return { kind: 'synth', name }
  if (PITCHED.includes(name)) return { kind: 'pitched', name }
  const prefix = ONE_SHOT_PREFIXES.find((p) => name.startsWith(p) && name.length > p.length)
  if (prefix) return { kind: 'one-shot', name }
  if (INSTRUMENT_WORDS.includes(name)) return { kind: 'silent', name, dm: 'vibe.sample.unknown' }
  throw new RangeError('sample ' + name + ' is not in the documented families; the full manifest is not in this repo, so refused as a scoped negative')
}

export const pattern = () => {
  throw new RangeError('the pattern language (mini, note, stack, operators, arrange) has names only in savi; refused as a scoped negative')
}

export const VIBE_NAMES = Object.freeze(['pattern', 'setBpm', 'setCps', 'setSwing', 'validateAudio', 'resolveSample'])
export const VIBE_DEFAULT_BUS = DEFAULT_BUS
export const VIBE_GAIN_RANGE = Object.freeze([GAIN_MIN, GAIN_MAX])
