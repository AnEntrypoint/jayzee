import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectCdp } from './cdp-client.mjs'
import { projectDebugPort } from './page-witness.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outPath = resolve(root, process.argv[2] ?? 'build/diag/gpu-backend.json')
const debugPort = projectDebugPort(root)
if (debugPort === null) throw new Error('no project playwriter browser: .playwriter/debug-port is missing')
const AUX_KEYS = ['skiaBackendType', 'hardwareSupportsVulkan', 'glRenderer', 'glVersion', 'displayType', 'passthroughCmdDecoder', 'glImplementationParts', 'sandboxed', 'inProcessGpu']
const FEATURE_KEYS = ['vulkan', 'webgpu', 'webgl', 'opengl', 'webgpu_on_vk_via_gl_interop', 'skia_graphite']

const client = await connectCdp(debugPort, { sendTimeoutMs: 60000 })
try {
  const [version, info] = await Promise.all([client.send('Browser.getVersion', {}), client.send('SystemInfo.getInfo', {})])
  const gpu = info.gpu ?? {}
  const aux = gpu.auxAttributes ?? {}
  const features = gpu.featureStatus ?? {}
  const out = {
    product: version.product,
    devices: gpu.devices ?? [],
    aux: Object.fromEntries(AUX_KEYS.filter((key) => key in aux).map((key) => [key, aux[key]])),
    featureStatus: Object.fromEntries(FEATURE_KEYS.filter((key) => key in features).map((key) => [key, features[key]])),
    vulkanEnabled: features.vulkan === 'enabled_on' && aux.hardwareSupportsVulkan === true,
    webgpuEnabled: features.webgpu === 'enabled',
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
  console.log(JSON.stringify(out, null, 1))
} finally {
  client.close()
}
