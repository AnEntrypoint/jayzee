import http from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { createRequire } from "node:module"

const ROOT = normalize(new URL("../..", import.meta.url).pathname)
const PORT = Number(process.env.PLAYER_WEBGPU_PORT || 8802)
const CHROMIUM = process.env.CHROMIUM || "/usr/lib/chromium/chromium.real"
const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE
if (!PLAYWRIGHT) throw new Error("set PLAYWRIGHT_CORE to the path of a playwright-core index.mjs")
const { chromium } = await import(PLAYWRIGHT)
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".glb": "model/gltf-binary" }
const srv = http.createServer(async (q, s) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(q.url, "http://x").pathname)))
  if (!path.startsWith(ROOT)) { s.statusCode = 403; s.end(); return }
  try {
    const body = await readFile(path)
    s.setHeader("content-type", TYPES[extname(path)] || "application/octet-stream")
    s.end(body)
  } catch { s.statusCode = 404; s.end("not found") }
})
await new Promise((res) => srv.listen(PORT, "127.0.0.1", res))
const errors = []
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,UseSkiaRenderer,WebGPUService", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"] })
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
  page.on("pageerror", (e) => errors.push("pageerror " + e.message))
  page.on("console", (m) => { if (m.type() === "error") errors.push("console " + m.text().slice(0, 300)) })
  page.on("response", (r) => { if (r.status() >= 400) errors.push(r.status() + " " + r.url()) })
  await page.goto("http://127.0.0.1:" + PORT + "/scripts/browser/player-webgpu.html?r=1")
  const gpu = await page.evaluate(async () => { if (!navigator.gpu) return "no navigator.gpu"; const a = await navigator.gpu.requestAdapter(); return a ? "adapter" : "no adapter" })
  await page.waitForFunction(() => window.playerWebgpuResult, null, { timeout: 90000 }).catch((e) => errors.push("wait " + e.message.slice(0, 120)))
  const out = await page.evaluate(() => window.playerWebgpuResult ?? null)
  console.log(JSON.stringify({ gpu, out, errors }, null, 1))
  if (!out || !out.ok) process.exitCode = 1
} finally {
  await browser.close()
  srv.close()
}
