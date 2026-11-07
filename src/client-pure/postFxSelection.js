export const POST_FX_PASSES = Object.freeze([
  'ssao-compute', 'ssao-composite',
  'bloom-compute', 'bloom-composite',
  'ssr-compute', 'ssr-composite',
  'fsr1-compute', 'fsr1-composite',
])

export function dprIsDownscaled(dpr, windowDevicePixelRatio = null) {
  if (windowDevicePixelRatio === null) return false
  if (dpr == null) return false
  const scale = typeof dpr === 'object' ? +dpr.scale : +dpr / (windowDevicePixelRatio || 1)
  return Number.isFinite(scale) && scale < 0.999
}

export function postFxPassEnabled(pass, get, ctx, windowDevicePixelRatio = null) {
  const on = key => get(key) === true
  switch (pass) {
    case 'ssao-compute': return on('ssao') && !!ctx.ssao
    case 'ssao-composite': return on('ssao') && !!ctx.ssao && ctx.res.ssaoComputed === ctx.frameId
    case 'bloom-compute': return on('bloom') && !!ctx.bloom
    case 'bloom-composite': return on('bloom') && !!ctx.bloom && ctx.res.bloomComputed === ctx.frameId
    case 'ssr-compute': return on('ssr') && !!ctx.ssr && on('ssao')
    case 'ssr-composite': return on('ssr') && !!ctx.ssr && ctx.res.ssrComputed === ctx.frameId
    case 'fsr1-compute': return on('fsr1') && !!ctx.fsr1 && dprIsDownscaled(get('dpr'), windowDevicePixelRatio)
    case 'fsr1-composite': return on('fsr1') && !!ctx.fsr1 && ctx.res.fsr1Computed === ctx.frameId
    default: throw new Error(`[post-fx] unknown pass '${pass}'`)
  }
}

export function enabledPostFxPasses(get, ctx, windowDevicePixelRatio = null) {
  return POST_FX_PASSES.filter(pass => postFxPassEnabled(pass, get, ctx, windowDevicePixelRatio))
}
