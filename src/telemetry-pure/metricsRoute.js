const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

export const isLoopbackAddress = (remote) => LOOPBACK_ADDRESSES.has(remote)

export function metricsResponse({ remoteAddress, registry, snapshot }) {
  if (!isLoopbackAddress(remoteAddress)) return { status: 403, headers: {}, body: 'forbidden' }
  return { status: 200, headers: { 'Content-Type': METRICS_CONTENT_TYPE }, body: registry.render(snapshot()) }
}
