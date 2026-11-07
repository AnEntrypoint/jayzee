export function isDevHmrEnabled(env = process.env) {
  return !env.SPOINT_NO_WATCH && env.NODE_ENV !== 'production' && env.SPOINT_HMR !== '0'
}
