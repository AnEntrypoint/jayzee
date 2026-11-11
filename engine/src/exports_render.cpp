#include <cmath>
#include <cstdint>
#include <cstring>

#include <emscripten/emscripten.h>
#include <emscripten/html5.h>

#include "arena.h"
#include "page_cache.h"
#include "phase_timer.h"
#include "physics_origin.h"
#include "planet_frame.h"
#include "render/render_backend.h"
#include "render/render_frame.h"
#include "render/render_webgl2.h"
#include "render/render_webgpu.h"
#include "textures.h"
#include "world.h"

namespace engine::render {

namespace {

constexpr char kCanvasSelector[] = "#engine-canvas";

struct RenderState {
  FramePlan plan;
  Camera camera;
  PagePlacement placements[kMaxPageLayers];
  LightSlot lights[kLightSlots];
  LightSlot relLights[kLightSlots];
  double lightPositions[kLightSlots * 3];
  FrameOrigin origin;
  MaterialSlot materials[kMaterialSlots];
  std::uint8_t albedoReady[kAlbedoLayers];
  std::uint8_t albedoPixels[kAlbedoLayers * kAlbedoBytes];
  std::uint8_t bodyClass[kBodySlots];
  const MaterialSlot* boundMaterials;
  std::uint32_t boundCount;
  std::uint32_t lightCount;
};

RenderState* renderState = nullptr;

std::int32_t albedoLayerOfHandle(double handle) {
  return engine::textures::layer(handle);
}

MaterialSlot ownDefaultMaterial() {
  MaterialSlot material{};
  material.colour[0] = 0.8f;
  material.colour[1] = 0.8f;
  material.colour[2] = 0.8f;
  material.colour[3] = 1.0f;
  material.roughness = 0.6f;
  return material;
}

void initState(RenderState& state) {
  std::memset(&state.plan, 0, sizeof state.plan);
  resetPlan(state.plan);
  std::memset(&state.camera, 0, sizeof state.camera);
  for (std::uint32_t c = 0; c < kPropClasses; ++c) state.camera.classMaterial[c] = c;
  std::memset(state.placements, 0, sizeof state.placements);
  std::memset(state.lights, 0, sizeof state.lights);
  std::memset(state.lightPositions, 0, sizeof state.lightPositions);
  const MaterialSlot fallback = ownDefaultMaterial();
  for (std::uint32_t m = 0; m < kMaterialSlots; ++m) state.materials[m] = fallback;
  std::memset(state.albedoReady, 0, sizeof state.albedoReady);
  std::memset(state.albedoPixels, 0xff, kAlbedoBytes);
  state.albedoReady[0] = 1;
  state.plan.albedoPending[0] = 1;
  std::memset(state.bodyClass, kNoClass, sizeof state.bodyClass);
  state.boundMaterials = state.materials;
  state.boundCount = kMaterialSlots;
  state.lightCount = 0;
}

}

const char* backendName(std::uint32_t value) {
  return value == static_cast<std::uint32_t>(BackendKind::kWebGpu) ? "webgpu" : "webgl2";
}

int initBackend(BackendKind kind, std::uint32_t width, std::uint32_t height) {
  if (kind == BackendKind::kWebGpu) return webgpu::init(kCanvasSelector, width, height);
  return webgl2::init(kCanvasSelector, width, height);
}

int frameBackend(const SceneView& scene, const FramePlan& plan, const Camera& camera) {
  if (counters().backend == static_cast<std::uint32_t>(BackendKind::kWebGpu)) return webgpu::frame(scene, plan, camera);
  return webgl2::frame(scene, plan, camera);
}

}

namespace rnd = engine::render;

static_assert(sizeof(rnd::RenderState) <= engine::budget::kRenderBytes);

extern "C" {

EMSCRIPTEN_KEEPALIVE int engine_render_init(std::uint32_t backend) {
  if (!rnd::isBackendValue(backend)) return engine::kRange;
  if (engine::world().bodyCapacity() > rnd::kBodySlots) return engine::kRange;
  if (rnd::renderState == nullptr) {
    if (!rnd::acceptCreate()) return engine::kRange;
    rnd::renderState = static_cast<rnd::RenderState*>(engine::arena::carve(sizeof(rnd::RenderState), alignof(rnd::RenderState)));
    if (rnd::renderState == nullptr) return engine::kRange;
    rnd::initState(*rnd::renderState);
  }
  int width = 0;
  int height = 0;
  emscripten_get_canvas_element_size(rnd::kCanvasSelector, &width, &height);
  if (width <= 0 || height <= 0) return engine::kNotConfigured;
  const int status = rnd::initBackend(static_cast<rnd::BackendKind>(backend), static_cast<std::uint32_t>(width), static_cast<std::uint32_t>(height));
  rnd::counters().backend = backend;
  rnd::counters().ready = status == engine::kOk ? 1u : 0u;
  return status;
}

EMSCRIPTEN_KEEPALIVE int engine_render_seal() {
  if (rnd::counters().ready == 0) return engine::kNotConfigured;
  rnd::counters().sealed = 1;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE int engine_render_frame() {
  if (rnd::renderState == nullptr || rnd::counters().ready == 0) return engine::kNotConfigured;
  rnd::RenderState& state = *rnd::renderState;
  rnd::counters().apiCalls = 0;
  rnd::counters().vegetationDraws = 0;
  rnd::counters().vegetationInstances = 0;
  rnd::SceneView scene{};
  scene.transforms = engine::world().transforms();
  scene.bodyCount = engine::world().bodyCapacity();
  scene.bodyClass = state.bodyClass;
  scene.pages = &engine::planet::state().pages;
  scene.placements = state.placements;
  scene.materials = state.boundMaterials;
  scene.materialCount = state.boundCount;
  scene.origin = state.origin;
  const engine::PhysicsOrigin& bodyOrigin = engine::physicsOrigin();
  scene.bodyOrigin = rnd::FrameOrigin{bodyOrigin.x, bodyOrigin.y, bodyOrigin.z};
  for (std::uint32_t i = 0; i < state.lightCount && i < rnd::kLightSlots; ++i) {
    const rnd::LightSlot& light = state.lights[i];
    const double absolute[3] = {state.lightPositions[i * 3], state.lightPositions[i * 3 + 1], state.lightPositions[i * 3 + 2]};
    float rel[3];
    rnd::relativeOf(absolute, state.origin, rel);
    rnd::LightSlot& out = state.relLights[i];
    out = light;
    out.position[0] = rel[0];
    out.position[1] = rel[1];
    out.position[2] = rel[2];
  }
  scene.lights = state.relLights;
  scene.lightCount = state.lightCount;
  scene.albedoReady = state.albedoReady;
  scene.albedoPixels = state.albedoPixels;
  scene.albedoLayerOf = rnd::albedoLayerOfHandle;
  {
    engine::phase::Scope scope(engine::phase::kPlan);
    rnd::planFrame(scene, state.camera, state.plan);
  }
  int status = engine::kOk;
  {
    engine::phase::Scope scope(engine::phase::kBackend);
    status = rnd::frameBackend(scene, state.plan, state.camera);
  }
  if (status == engine::kOk) std::memset(state.plan.albedoPending, 0, sizeof state.plan.albedoPending);
  rnd::counters().apiCallsLast = rnd::counters().apiCalls;
  rnd::counters().frames += 1;
  return status;
}

EMSCRIPTEN_KEEPALIVE float* engine_render_camera() {
  return rnd::renderState == nullptr ? nullptr : reinterpret_cast<float*>(&rnd::renderState->camera);
}

EMSCRIPTEN_KEEPALIVE std::uint8_t* engine_render_body_classes() {
  return rnd::renderState == nullptr ? nullptr : rnd::renderState->bodyClass;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t* engine_render_placements() {
  return rnd::renderState == nullptr ? nullptr : reinterpret_cast<std::uint32_t*>(rnd::renderState->placements);
}

EMSCRIPTEN_KEEPALIVE float* engine_render_lights() {
  return rnd::renderState == nullptr ? nullptr : reinterpret_cast<float*>(rnd::renderState->lights);
}

EMSCRIPTEN_KEEPALIVE double* engine_render_light_positions() {
  return rnd::renderState == nullptr ? nullptr : rnd::renderState->lightPositions;
}

EMSCRIPTEN_KEEPALIVE int engine_render_set_light_count(std::uint32_t count) {
  if (rnd::renderState == nullptr || count > rnd::kLightSlots) return engine::kRange;
  rnd::renderState->lightCount = count;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t* engine_render_material_table() {
  return rnd::renderState == nullptr ? nullptr : reinterpret_cast<std::uint32_t*>(rnd::renderState->materials);
}

EMSCRIPTEN_KEEPALIVE int engine_render_bind_materials(const void* table, std::uint32_t count) {
  if (rnd::renderState == nullptr || count > rnd::kMaterialSlots) return engine::kRange;
  if (table == nullptr) {
    rnd::renderState->boundMaterials = rnd::renderState->materials;
    rnd::renderState->boundCount = rnd::kMaterialSlots;
    return engine::kOk;
  }
  rnd::renderState->boundMaterials = static_cast<const rnd::MaterialSlot*>(table);
  rnd::renderState->boundCount = count;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE std::uint8_t* engine_render_albedo_staging() {
  return rnd::renderState == nullptr ? nullptr : rnd::renderState->albedoPixels;
}

EMSCRIPTEN_KEEPALIVE int engine_render_commit_albedo(std::uint32_t layer) {
  if (rnd::renderState == nullptr || layer == 0 || layer >= rnd::kAlbedoLayers) return engine::kRange;
  rnd::renderState->albedoReady[layer] = 1;
  rnd::renderState->plan.albedoPending[layer] = 1;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE int engine_render_set_origin(double x, double y, double z) {
  if (rnd::renderState == nullptr) return engine::kNotConfigured;
  if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) return engine::kRange;
  const int status = engine::world().follow(x, y, z);
  if (status != engine::kOk) return status;
  rnd::renderState->origin = rnd::FrameOrigin{x, y, z};
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE int engine_render_place_page(std::uint32_t slot, double ox, double oy, double oz, float ux, float uy, float uz, float vx, float vy,
                                                  float vz) {
  if (rnd::renderState == nullptr || slot >= rnd::pageLayers()) return engine::kRange;
  rnd::PagePlacement& placement = rnd::renderState->placements[slot];
  placement.origin[0] = ox;
  placement.origin[1] = oy;
  placement.origin[2] = oz;
  placement.uEdge[0] = ux;
  placement.uEdge[1] = uy;
  placement.uEdge[2] = uz;
  placement.vEdge[0] = vx;
  placement.vEdge[1] = vy;
  placement.vEdge[2] = vz;
  placement.placed = 1;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE int engine_render_unplace_page(std::uint32_t slot) {
  if (rnd::renderState == nullptr || slot >= rnd::pageLayers()) return engine::kRange;
  rnd::renderState->placements[slot].placed = 0;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE int engine_render_mark_page(std::uint32_t slot) {
  if (rnd::renderState == nullptr || slot >= rnd::pageLayers()) return engine::kRange;
  rnd::renderState->plan.dirty[slot] = 1;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_backend() {
  return rnd::counters().backend;
}

EMSCRIPTEN_KEEPALIVE int engine_render_set_model_path(std::uint32_t mode) {
  if (mode != rnd::kModelPathForward && mode != rnd::kModelPathVisibility) return engine::kRange;
  rnd::modelSettings().path = mode;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_model_path() {
  return rnd::modelSettings().path;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_model_path_effective() {
  return rnd::counters().modelPath;
}

EMSCRIPTEN_KEEPALIVE int engine_render_set_occlusion(std::uint32_t on) {
  rnd::modelSettings().occlusion = on != 0 ? 1u : 0u;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_occlusion() {
  return rnd::modelSettings().occlusion;
}

EMSCRIPTEN_KEEPALIVE void engine_render_set_count_readback(std::uint32_t on) {
  rnd::counters().countReadback = on != 0 ? 1u : 0u;
}

EMSCRIPTEN_KEEPALIVE int engine_render_cull_ready() {
  if (rnd::counters().cullFresh == 0) return 0;
  rnd::counters().cullFresh = 0;
  return 1;
}

EMSCRIPTEN_KEEPALIVE const std::uint32_t* engine_render_cull_counts() {
  static std::uint32_t words[4];
  words[0] = rnd::counters().cullPassA;
  words[1] = rnd::counters().cullCandidates;
  words[2] = rnd::counters().cullPassB;
  words[3] = static_cast<std::uint32_t>(rnd::counters().frames);
  return words;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_api_calls_last_frame() {
  return rnd::counters().apiCallsLast;
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_render_frames() {
  return rnd::counters().frames;
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_render_checksum() {
  return rnd::counters().checksum;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_visible(std::uint32_t cls) {
  return cls < rnd::kPropClasses ? rnd::counters().visible[cls] : 0u;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_vegetation_draws() {
  return rnd::counters().vegetationDraws;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_vegetation_instances() {
  return rnd::counters().vegetationInstances;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_pages() {
  return rnd::counters().pages;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_uploads() {
  return rnd::counters().uploads;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_light_count() {
  return rnd::counters().lights;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_creates_after_seal() {
  return rnd::counters().createsAfterSeal;
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_render_allocations_since_warmup() {
  return engine::allocationsSinceWarmup() + rnd::counters().createsAfterSeal;
}

}
