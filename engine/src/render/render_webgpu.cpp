#include "render_webgpu.h"

#include <emscripten/html5_webgpu.h>
#include <webgpu/webgpu_cpp.h>

#include "../page_cache.h"
#include "../phase_timer.h"

namespace engine::render::webgpu {

namespace {

constexpr char kPropWgsl[] = R"WGSL(
struct Camera {
  planes: array<vec4f, 6>,
  viewProj: mat4x4f,
  eye: vec4f,
  counts: vec4u,
  classRadius: vec4f,
  classMaterial: vec4u,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> inst: array<u32>;
@group(0) @binding(2) var<storage, read> materials: array<u32>;
@group(0) @binding(3) var<storage, read> lights: array<vec4f>;
@group(0) @binding(4) var albedo: texture_2d_array<f32>;

struct PropOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) @interpolate(flat) cls: u32,
};

fn instF(i: u32) -> f32 {
  return bitcast<f32>(inst[i]);
}

fn matF(i: u32) -> f32 {
  return bitcast<f32>(materials[i]);
}

fn clipOf(p: vec4f) -> vec4f {
  return vec4f(p.xy, (p.z + p.w) * 0.5, p.w);
}

fn rotate(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn cubeCorner(vid: u32) -> vec3f {
  let face = vid / 6u;
  let k = vid % 6u;
  let axis = face / 2u;
  let sgn = select(-0.5, 0.5, (face & 1u) == 0u);
  let tu = select(-0.5, 0.5, k == 1u || k == 2u || k == 4u);
  let tv = select(-0.5, 0.5, k == 2u || k == 4u || k == 5u);
  var p = vec3f(0.0);
  p[axis] = sgn;
  p[(axis + 1u) % 3u] = tu;
  p[(axis + 2u) % 3u] = tv;
  return p;
}

fn cubeNormal(vid: u32) -> vec3f {
  let face = vid / 6u;
  var n = vec3f(0.0);
  n[face / 2u] = select(-1.0, 1.0, (face & 1u) == 0u);
  return n;
}

@vertex
fn vsProps(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> PropOut {
  let base = iid * 8u;
  let centre = vec3f(instF(base), instF(base + 1u), instF(base + 2u));
  let q = vec4f(instF(base + 3u), instF(base + 4u), instF(base + 5u), instF(base + 6u));
  let world = centre + rotate(q, cubeCorner(vid));
  var out: PropOut;
  out.clip = clipOf(cam.viewProj * vec4f(world, 1.0));
  out.world = world;
  out.normal = rotate(q, cubeNormal(vid));
  out.cls = inst[base + 7u];
  return out;
}

@fragment
fn fsProps(vin: PropOut) -> @location(0) vec4f {
  let mi = cam.classMaterial[min(vin.cls, 3u)];
  let m = mi * 10u;
  let colour = vec3f(matF(m), matF(m + 1u), matF(m + 2u));
  let layer = materials[m + 9u];
  let texel = vec2i(clamp(fract(vin.world.xz) * 16.0, vec2f(0.0), vec2f(15.0)));
  let albedoColour = textureLoad(albedo, texel, i32(layer), 0).rgb;
  let n = normalize(vin.normal);
  var lit = vec3f(0.2);
  for (var i = 0u; i < cam.counts.x; i = i + 1u) {
    let lp = lights[i * 2u];
    let lc = lights[i * 2u + 1u];
    let d = lp.xyz - vin.world;
    let dist = max(length(d), 1e-6);
    let att = max(0.0, 1.0 - dist / max(lp.w, 1e-6));
    lit = lit + lc.xyz * lc.w * att * max(dot(n, d / dist), 0.0);
  }
  return vec4f(albedoColour * colour * lit, 1.0);
}
)WGSL";

constexpr char kTerrainWgsl[] = R"WGSL(
struct Camera {
  planes: array<vec4f, 6>,
  viewProj: mat4x4f,
  eye: vec4f,
  counts: vec4u,
  classRadius: vec4f,
  classMaterial: vec4u,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> pages: array<u32>;
@group(0) @binding(2) var heights: texture_2d_array<f32>;

struct TerrainOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
};

fn pageF(i: u32) -> f32 {
  return bitcast<f32>(pages[i]);
}

fn clipOf(p: vec4f) -> vec4f {
  return vec4f(p.xy, (p.z + p.w) * 0.5, p.w);
}

@vertex
fn vsTerrain(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> TerrainOut {
  let base = iid * 16u;
  let layer = pages[base];
  let origin = vec3f(pageF(base + 4u), pageF(base + 5u), pageF(base + 6u));
  let uEdge = vec3f(pageF(base + 8u), pageF(base + 9u), pageF(base + 10u));
  let vEdge = vec3f(pageF(base + 12u), pageF(base + 13u), pageF(base + 14u));
  let quad = vid / 6u;
  let k = vid % 6u;
  let cx = quad % 15u;
  let cy = quad / 15u;
  let du = select(0u, 1u, k == 1u || k == 2u || k == 4u);
  let dv = select(0u, 1u, k == 2u || k == 4u || k == 5u);
  let gi = cx + du;
  let gj = cy + dv;
  let h = textureLoad(heights, vec2i(i32(gi), i32(gj)), i32(layer), 0).r;
  let normal = normalize(cross(uEdge, vEdge));
  let world = origin + uEdge * (f32(gi) / 15.0) + vEdge * (f32(gj) / 15.0) + normal * h;
  var out: TerrainOut;
  out.clip = clipOf(cam.viewProj * vec4f(world, 1.0));
  out.world = world;
  out.normal = normal;
  return out;
}

@fragment
fn fsTerrain(vin: TerrainOut) -> @location(0) vec4f {
  let sun = normalize(vec3f(0.4, 1.0, 0.3));
  let lit = 0.25 + 0.75 * max(dot(normalize(vin.normal), sun), 0.0);
  return vec4f(vec3f(0.36, 0.5, 0.28) * lit, 1.0);
}
)WGSL";

constexpr std::uint32_t kPropBindings = 5;
constexpr std::uint32_t kTerrainBindings = 3;
constexpr double kClearRed = 0.05;
constexpr double kClearGreen = 0.07;
constexpr double kClearBlue = 0.10;
constexpr std::uint64_t kCameraBytes = sizeof(Camera);
constexpr std::uint64_t kBodyBytes = static_cast<std::uint64_t>(kBodySlots) * kRecordBytes;
constexpr std::uint64_t kLightBytes = static_cast<std::uint64_t>(kLightSlots) * engine::render::kLightBytes;
constexpr std::uint64_t kMaterialBytes = static_cast<std::uint64_t>(kMaterialSlots) * engine::render::kMaterialBytes;
constexpr std::uint64_t kPageBytes = static_cast<std::uint64_t>(kPageLayers) * kPageRecordBytes;
constexpr std::uint64_t kArgsBytes = static_cast<std::uint64_t>(kArgsWords) * 4;

std::uint8_t whitePixels[kAlbedoBytes];

wgpu::Device device;
wgpu::Queue queue;
wgpu::Surface surface;
wgpu::Buffer cameraBuf;
wgpu::Buffer argsBuf;
wgpu::Buffer lightBuf;
wgpu::Buffer materialBuf;
wgpu::Buffer pageBuf;
wgpu::Buffer instanceBuf[kPropClasses];
wgpu::Texture heightTex;
wgpu::Texture albedoTex;
wgpu::Texture depthTex;
wgpu::TextureView heightView;
wgpu::TextureView albedoView;
wgpu::TextureView depthView;
wgpu::RenderPipeline propPipe;
wgpu::RenderPipeline terrainPipe;
wgpu::BindGroup propGroup[kPropClasses];
wgpu::BindGroup terrainGroup;
wgpu::TextureFormat surfaceFormat = wgpu::TextureFormat::BGRA8Unorm;
bool ready = false;

wgpu::Buffer makeBuffer(std::uint64_t size, wgpu::BufferUsage usage) {
  wgpu::BufferDescriptor desc{};
  desc.size = size;
  desc.usage = usage;
  return device.CreateBuffer(&desc);
}

wgpu::Texture makeTexture(std::uint32_t width, std::uint32_t height, std::uint32_t layers, wgpu::TextureFormat format, wgpu::TextureUsage usage) {
  wgpu::TextureDescriptor desc{};
  desc.size = wgpu::Extent3D{width, height, layers};
  desc.format = format;
  desc.usage = usage;
  desc.dimension = wgpu::TextureDimension::e2D;
  return device.CreateTexture(&desc);
}

wgpu::TextureView makeArrayView(wgpu::Texture texture, std::uint32_t layers) {
  wgpu::TextureViewDescriptor desc{};
  desc.dimension = wgpu::TextureViewDimension::e2DArray;
  desc.arrayLayerCount = layers;
  return texture.CreateView(&desc);
}

wgpu::ShaderModule makeModule(const char* code) {
  wgpu::ShaderModuleWGSLDescriptor source{};
  source.code = code;
  wgpu::ShaderModuleDescriptor desc{};
  desc.nextInChain = &source;
  return device.CreateShaderModule(&desc);
}

wgpu::BindGroupLayoutEntry bufferEntry(std::uint32_t binding, wgpu::ShaderStage visibility, wgpu::BufferBindingType type) {
  wgpu::BindGroupLayoutEntry entry{};
  entry.binding = binding;
  entry.visibility = visibility;
  entry.buffer.type = type;
  return entry;
}

wgpu::BindGroupLayoutEntry arrayTextureEntry(std::uint32_t binding, wgpu::ShaderStage visibility, wgpu::TextureSampleType sample) {
  wgpu::BindGroupLayoutEntry entry{};
  entry.binding = binding;
  entry.visibility = visibility;
  entry.texture.sampleType = sample;
  entry.texture.viewDimension = wgpu::TextureViewDimension::e2DArray;
  return entry;
}

wgpu::BindGroupLayout makeLayout(const wgpu::BindGroupLayoutEntry* entries, std::uint32_t count) {
  wgpu::BindGroupLayoutDescriptor desc{};
  desc.entryCount = count;
  desc.entries = entries;
  return device.CreateBindGroupLayout(&desc);
}

wgpu::PipelineLayout makePipelineLayout(wgpu::BindGroupLayout layout) {
  wgpu::PipelineLayoutDescriptor desc{};
  desc.bindGroupLayoutCount = 1;
  desc.bindGroupLayouts = &layout;
  return device.CreatePipelineLayout(&desc);
}

wgpu::BindGroupEntry bufferBinding(std::uint32_t binding, wgpu::Buffer buffer, std::uint64_t size) {
  wgpu::BindGroupEntry entry{};
  entry.binding = binding;
  entry.buffer = buffer;
  entry.offset = 0;
  entry.size = size;
  return entry;
}

wgpu::BindGroupEntry viewBinding(std::uint32_t binding, wgpu::TextureView view) {
  wgpu::BindGroupEntry entry{};
  entry.binding = binding;
  entry.textureView = view;
  return entry;
}

wgpu::BindGroup makeGroup(wgpu::BindGroupLayout layout, const wgpu::BindGroupEntry* entries, std::uint32_t count) {
  wgpu::BindGroupDescriptor desc{};
  desc.layout = layout;
  desc.entryCount = count;
  desc.entries = entries;
  return device.CreateBindGroup(&desc);
}

void writeBuffer(wgpu::Buffer buffer, std::uint64_t offset, const void* data, std::uint64_t size) {
  ENGINE_RENDER_CALL(queue.WriteBuffer(buffer, offset, data, size));
}

void writeLayers(wgpu::Texture texture, std::uint32_t firstLayer, std::uint32_t layers, const void* pixels, std::uint32_t side, std::uint32_t bytesPerTexel) {
  wgpu::ImageCopyTexture destination{};
  destination.texture = texture;
  destination.origin = wgpu::Origin3D{0, 0, firstLayer};
  wgpu::TextureDataLayout layout{};
  layout.bytesPerRow = side * bytesPerTexel;
  layout.rowsPerImage = side;
  const wgpu::Extent3D size{side, side, layers};
  const std::size_t bytes = static_cast<std::size_t>(side) * side * bytesPerTexel * layers;
  ENGINE_RENDER_CALL(queue.WriteTexture(&destination, pixels, bytes, &layout, &size));
}

int buildPipelines() {
  wgpu::ShaderModule propModule = makeModule(kPropWgsl);
  wgpu::ShaderModule terrainModule = makeModule(kTerrainWgsl);
  if (!propModule || !terrainModule) return engine::kNotConfigured;

  const wgpu::ShaderStage vertexFragment = wgpu::ShaderStage::Vertex | wgpu::ShaderStage::Fragment;
  const wgpu::ShaderStage vertex = wgpu::ShaderStage::Vertex;
  const wgpu::ShaderStage fragment = wgpu::ShaderStage::Fragment;
  wgpu::BindGroupLayoutEntry propEntries[kPropBindings];
  propEntries[0] = bufferEntry(0, vertexFragment, wgpu::BufferBindingType::Uniform);
  propEntries[1] = bufferEntry(1, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  propEntries[2] = bufferEntry(2, fragment, wgpu::BufferBindingType::ReadOnlyStorage);
  propEntries[3] = bufferEntry(3, fragment, wgpu::BufferBindingType::ReadOnlyStorage);
  propEntries[4] = arrayTextureEntry(4, fragment, wgpu::TextureSampleType::UnfilterableFloat);
  wgpu::BindGroupLayout propLayout = makeLayout(propEntries, kPropBindings);
  wgpu::PipelineLayout propPipeLayout = makePipelineLayout(propLayout);

  wgpu::ColorTargetState colour{};
  colour.format = surfaceFormat;
  wgpu::FragmentState propFragment{};
  propFragment.module = propModule;
  propFragment.entryPoint = "fsProps";
  propFragment.targetCount = 1;
  propFragment.targets = &colour;
  wgpu::DepthStencilState depth{};
  depth.format = wgpu::TextureFormat::Depth24Plus;
  depth.depthWriteEnabled = true;
  depth.depthCompare = wgpu::CompareFunction::Less;

  wgpu::RenderPipelineDescriptor propDesc{};
  propDesc.layout = propPipeLayout;
  propDesc.vertex.module = propModule;
  propDesc.vertex.entryPoint = "vsProps";
  propDesc.fragment = &propFragment;
  propDesc.depthStencil = &depth;
  propDesc.primitive.topology = wgpu::PrimitiveTopology::TriangleList;
  propDesc.primitive.cullMode = wgpu::CullMode::None;
  propPipe = device.CreateRenderPipeline(&propDesc);

  wgpu::BindGroupLayoutEntry terrainEntries[kTerrainBindings];
  terrainEntries[0] = bufferEntry(0, vertex, wgpu::BufferBindingType::Uniform);
  terrainEntries[1] = bufferEntry(1, vertex, wgpu::BufferBindingType::ReadOnlyStorage);
  terrainEntries[2] = arrayTextureEntry(2, vertex, wgpu::TextureSampleType::UnfilterableFloat);
  wgpu::BindGroupLayout terrainLayout = makeLayout(terrainEntries, kTerrainBindings);
  wgpu::PipelineLayout terrainPipeLayout = makePipelineLayout(terrainLayout);

  wgpu::ColorTargetState terrainColour{};
  terrainColour.format = surfaceFormat;
  wgpu::FragmentState terrainFragment{};
  terrainFragment.module = terrainModule;
  terrainFragment.entryPoint = "fsTerrain";
  terrainFragment.targetCount = 1;
  terrainFragment.targets = &terrainColour;

  wgpu::RenderPipelineDescriptor terrainDesc{};
  terrainDesc.layout = terrainPipeLayout;
  terrainDesc.vertex.module = terrainModule;
  terrainDesc.vertex.entryPoint = "vsTerrain";
  terrainDesc.fragment = &terrainFragment;
  terrainDesc.depthStencil = &depth;
  terrainDesc.primitive.topology = wgpu::PrimitiveTopology::TriangleList;
  terrainDesc.primitive.cullMode = wgpu::CullMode::None;
  terrainPipe = device.CreateRenderPipeline(&terrainDesc);

  if (!propPipe || !terrainPipe) return engine::kNotConfigured;

  for (std::uint32_t c = 0; c < kPropClasses; ++c) {
    wgpu::BindGroupEntry propBindings[kPropBindings];
    propBindings[0] = bufferBinding(0, cameraBuf, kCameraBytes);
    propBindings[1] = bufferBinding(1, instanceBuf[c], kBodyBytes);
    propBindings[2] = bufferBinding(2, materialBuf, kMaterialBytes);
    propBindings[3] = bufferBinding(3, lightBuf, kLightBytes);
    propBindings[4] = viewBinding(4, albedoView);
    propGroup[c] = makeGroup(propLayout, propBindings, kPropBindings);
  }

  wgpu::BindGroupEntry terrainBindings[kTerrainBindings];
  terrainBindings[0] = bufferBinding(0, cameraBuf, kCameraBytes);
  terrainBindings[1] = bufferBinding(1, pageBuf, kPageBytes);
  terrainBindings[2] = viewBinding(2, heightView);
  terrainGroup = makeGroup(terrainLayout, terrainBindings, kTerrainBindings);

  return (propGroup[0] && terrainGroup) ? engine::kOk : engine::kNotConfigured;
}

}

int init(const char* selector, std::uint32_t width, std::uint32_t height) {
  if (!acceptCreate()) return engine::kRange;
  if (ready) return engine::kOk;

  device = wgpu::Device::Acquire(emscripten_webgpu_get_device());
  if (!device) return engine::kNotConfigured;
  queue = device.GetQueue();

  wgpu::Instance instance = wgpu::CreateInstance();
  wgpu::SurfaceDescriptorFromCanvasHTMLSelector canvas{};
  canvas.selector = selector;
  wgpu::SurfaceDescriptor surfaceDesc{};
  surfaceDesc.nextInChain = &canvas;
  surface = instance.CreateSurface(&surfaceDesc);
  if (!surface) return engine::kNotConfigured;

  wgpu::SurfaceConfiguration config{};
  config.device = device;
  config.format = surfaceFormat;
  config.width = width;
  config.height = height;
  config.presentMode = wgpu::PresentMode::Fifo;
  config.alphaMode = wgpu::CompositeAlphaMode::Opaque;
  surface.Configure(&config);

  cameraBuf = makeBuffer(kCameraBytes, wgpu::BufferUsage::Uniform | wgpu::BufferUsage::CopyDst);
  argsBuf = makeBuffer(kArgsBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::Indirect | wgpu::BufferUsage::CopyDst);
  lightBuf = makeBuffer(kLightBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  materialBuf = makeBuffer(kMaterialBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  pageBuf = makeBuffer(kPageBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  for (std::uint32_t c = 0; c < kPropClasses; ++c) {
    instanceBuf[c] = makeBuffer(kBodyBytes, wgpu::BufferUsage::Storage | wgpu::BufferUsage::CopyDst);
  }

  heightTex = makeTexture(kPageSide, kPageSide, kPageLayers, wgpu::TextureFormat::R32Float, wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::CopyDst);
  albedoTex = makeTexture(kAlbedoSide, kAlbedoSide, kAlbedoLayers, wgpu::TextureFormat::RGBA8Unorm, wgpu::TextureUsage::TextureBinding | wgpu::TextureUsage::CopyDst);
  depthTex = makeTexture(width, height, 1, wgpu::TextureFormat::Depth24Plus, wgpu::TextureUsage::RenderAttachment);
  heightView = makeArrayView(heightTex, kPageLayers);
  albedoView = makeArrayView(albedoTex, kAlbedoLayers);
  depthView = depthTex.CreateView();

  for (std::uint32_t i = 0; i < kAlbedoBytes; ++i) whitePixels[i] = 0xff;
  writeLayers(albedoTex, 0, 1, whitePixels, kAlbedoSide, 4);

  if (buildPipelines() != engine::kOk) return engine::kNotConfigured;

  ready = true;
  return engine::kOk;
}

int frame(const SceneView& scene, const FramePlan& plan, const Camera& camera) {
  if (!ready) return engine::kNotConfigured;

  {
    engine::phase::Scope scope(engine::phase::kUpload);
    writeBuffer(cameraBuf, 0, &camera, kCameraBytes);
    std::uint32_t propArgs[kPropClasses * 4];
    for (std::uint32_t c = 0; c < kPropClasses; ++c) {
      const std::uint32_t count = plan.propCount[c];
      if (count != 0) {
        writeBuffer(instanceBuf[c], 0, plan.propRecords + c * kBodySlots * kRecordWords, static_cast<std::uint64_t>(count) * kRecordBytes);
      }
      propArgs[c * 4 + 0] = kPropVertices;
      propArgs[c * 4 + 1] = count;
      propArgs[c * 4 + 2] = 0;
      propArgs[c * 4 + 3] = 0;
    }
    writeBuffer(argsBuf, kArgsPropWord * 4, propArgs, sizeof propArgs);
    const std::uint32_t terrainArgs[4] = {kPageVertices, plan.pageCount, 0, 0};
    writeBuffer(argsBuf, kArgsTerrainWord * 4, terrainArgs, sizeof terrainArgs);
    writeBuffer(lightBuf, 0, scene.lights, kLightBytes);
    writeBuffer(materialBuf, 0, plan.materialWords, kMaterialBytes);
    writeBuffer(pageBuf, 0, plan.pageRecords, kPageBytes);

    for (std::uint32_t u = 0; u < plan.uploadCount;) {
      const std::uint32_t end = uploadRunEnd(plan, u);
      writeLayers(heightTex, plan.uploadLayer[u], end - u, scene.pages->pageSamples(static_cast<int>(plan.uploadSlot[u])), kPageSide, 4);
      u = end;
    }
    for (std::uint32_t layer = 0; layer < kAlbedoLayers;) {
      if (plan.albedoPending[layer] == 0) {
        layer += 1;
        continue;
      }
      const std::uint32_t end = albedoRunEnd(plan, layer);
      writeLayers(albedoTex, layer, end - layer, scene.albedoPixels + layer * kAlbedoBytes, kAlbedoSide, 4);
      layer = end;
    }
  }

  wgpu::CommandEncoder encoder = ENGINE_RENDER_CALL(device.CreateCommandEncoder());

  wgpu::SurfaceTexture surfaceTexture{};
  wgpu::TextureView target;
  {
    engine::phase::Scope scope(engine::phase::kAcquire);
    ENGINE_RENDER_CALL(surface.GetCurrentTexture(&surfaceTexture));
    target = ENGINE_RENDER_CALL(surfaceTexture.texture.CreateView());
  }

  wgpu::RenderPassColorAttachment colour{};
  colour.view = target;
  colour.loadOp = wgpu::LoadOp::Clear;
  colour.storeOp = wgpu::StoreOp::Store;
  colour.clearValue = wgpu::Color{kClearRed, kClearGreen, kClearBlue, 1.0};
  wgpu::RenderPassDepthStencilAttachment depth{};
  depth.view = depthView;
  depth.depthLoadOp = wgpu::LoadOp::Clear;
  depth.depthStoreOp = wgpu::StoreOp::Store;
  depth.depthClearValue = 1.0f;
  wgpu::RenderPassDescriptor passDesc{};
  passDesc.colorAttachmentCount = 1;
  passDesc.colorAttachments = &colour;
  passDesc.depthStencilAttachment = &depth;

  wgpu::RenderPassEncoder pass = ENGINE_RENDER_CALL(encoder.BeginRenderPass(&passDesc));
  ENGINE_RENDER_CALL(pass.SetPipeline(propPipe));
  for (std::uint32_t c = 0; c < kPropClasses; ++c) {
    ENGINE_RENDER_CALL(pass.SetBindGroup(0, propGroup[c]));
    ENGINE_RENDER_CALL(pass.DrawIndirect(argsBuf, (kArgsPropWord + c * 4) * 4));
  }
  ENGINE_RENDER_CALL(pass.SetPipeline(terrainPipe));
  ENGINE_RENDER_CALL(pass.SetBindGroup(0, terrainGroup));
  ENGINE_RENDER_CALL(pass.DrawIndirect(argsBuf, kArgsTerrainWord * 4));
  ENGINE_RENDER_CALL(pass.End());

  wgpu::CommandBuffer commands = ENGINE_RENDER_CALL(encoder.Finish());
  {
    engine::phase::Scope scope(engine::phase::kSubmit);
    ENGINE_RENDER_CALL(queue.Submit(1, &commands));
  }
  return engine::kOk;
}

}
