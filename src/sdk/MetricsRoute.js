import { metricsResponse } from '../telemetry-pure/metricsRoute.js'

export const METRICS_PATH = '/metrics'

export function createMetricsRoute({ registry, snapshot }) {
  if (typeof registry?.render !== 'function') throw new TypeError('createMetricsRoute needs a registry with render()')
  if (typeof snapshot !== 'function') throw new TypeError('createMetricsRoute needs a snapshot function')
  return function handleMetricsRoute(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end('method not allowed')
      return
    }
    const response = metricsResponse({ remoteAddress: req.socket?.remoteAddress, registry, snapshot })
    const body = Buffer.from(response.body, 'utf8')
    res.writeHead(response.status, { ...response.headers, 'Content-Length': body.length, 'Cache-Control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}

export const isMetricsPath = (url) => {
  if (typeof url !== 'string') return false
  const query = url.indexOf('?')
  return (query === -1 ? url : url.slice(0, query)) === METRICS_PATH
}
