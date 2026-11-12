#!/usr/bin/env node
import { createServer } from 'node:http'
import { createMetricsRoute, isMetricsPath } from '../src/sdk/MetricsRoute.js'
import { createSocketServer } from '../src/sdk/SocketServer.js'
import { createTelemetryRegistry } from '../src/telemetry-pure/registry.js'
import { pack } from '../src/protocol/msgpack.js'

const option = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at === -1 || at + 1 >= process.argv.length ? fallback : process.argv[at + 1]
}

const host = option('--host', '127.0.0.1')
const port = Number(option('--port', '3002'))
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write('jayzee-serve: --port must be an integer from 0 to 65535\n')
  process.exit(2)
}

const telemetry = createTelemetryRegistry()
const handleMetrics = createMetricsRoute({
  registry: telemetry,
  snapshot: () => ({ uptimeSec: Math.floor(process.uptime()), memoryUsage: () => process.memoryUsage() }),
})

const server = createServer((req, res) => {
  if (isMetricsPath(req.url)) {
    handleMetrics(req, res)
    return
  }
  res.writeHead(404)
  res.end()
})
const socket = createSocketServer({
  server,
  env: process.env,
  onMessage: (connection, message) => connection.ws.send(pack(message)),
})

server.listen(port, host, () => {
  process.stdout.write('listening on ' + host + ':' + server.address().port + '\n')
})

let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  socket.close().then(() => server.close(() => process.exit(0)))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
