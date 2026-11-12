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
#include "render/render_webgpu.h"
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
  terrain::PageLod pageLods[kMaxPageLayers];
  LightSlot lights[kLightSlots];
  LightSlot relLights[kLightSlots];
  double lightPositions[kLightSlots * 3];
  FrameOrigin origin;
  MaterialSlot materials[kMaterialSlots];
  std::uint8_t albedoReady[kAlbedoLayers];
  std::uint8_t albedoPixels[kAlbedoLayers * kAlbedoBytes];
  std::uint8_t* bodyClass;
  std::uint32_t bodySlots;
  const MaterialSlot* boundMaterials;
  std::uint32_t boundCount;
  std::uint32_t lightCount;
  std::uint64_t plannedStamp;
  std::uint32_t propsPlanned;
  std::uint32_t planPropsAlways;
};

constexpr std::uint64_t kDigestPrime = 0x9e3779b97f4a7c15ull;

std::uint32_t classDigest(const std::uint8_t* classes, std::uint32_t count) {
  std::uint64_t digest = count;
  std::uint32_t at = 0;
  for (; at + 8 <= count; at += 8) {
    std::uint64_t word;
    std::memcpy(&word, classes + at, 8);
    digest = (digest ^ word) * kDigestPrime;
  }
  for (; at < count; ++at) digest = (digest ^ classes[at]) * kDigestPrime;
  return static_cast<std::uint32_t>(digest ^ (digest >> 32));
}

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

void initState(RenderState& state, std::uint32_t* propRecords, std::uint8_t* bodyClass, std::uint32_t bodySlots) {
  std::memset(&state.plan, 0, sizeof state.plan);
  state.plan.propRecords = propRecords;
  state.plan.bodySlots = bodySlots;
  state.bodyClass = bodyClass;
  state.bodySlots = bodySlots;
  std::memset(propRecords, 0, static_cast<std::size_t>(kPropClasses) * bodySlots * kRecordBytes);
  resetPlan(state.plan);
  std::memset(&state.camera, 0, sizeof state.camera);
  for (std::uint32_t c = 0; c < kPropClasses; ++c) state.camera.classMaterial[c] = c;
  std::memset(state.placements, 0, sizeof state.placements);
  for (std::uint32_t slot = 0; slot < kMaxPageLayers; ++slot) state.pageLods[slot] = terrain::PageLod{0, 0, terrain::kNoParent};
  std::memset(state.lights, 0, sizeof state.lights);
  std::memset(state.lightPositions, 0, sizeof state.lightPositions);
  const MaterialSlot fallback = ownDefaultMaterial();
  for (std::uint32_t m = 0; m < kMaterialSlots; ++m) state.materials[m] = fallback;
  std::memset(state.albedoReady, 0, sizeof state.albedoReady);
  std::memset(state.albedoPixels, 0xff, kAlbedoBytes);
  state.albedoReady[0] = 1;
  state.plan.albedoPending[0] = 1;
  std::memset(state.bodyClass, kNoClass, bodySlots);
  state.boundMaterials = state.materials;
  state.boundCount = kMaterialSlots;
  state.lightCount = 0;
  state.plannedStamp = 0;
  state.propsPlanned = 0;
  state.planPropsAlways = 0;
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

static_assert(sizeof(rnd::RenderState) <= engine::budget::kRenderFixedBytes);
static_assert((rnd::kPropClasses + 1) * rnd::kRecordBytes + 1 <= engine::budget::kRenderBytesPerBody);

extern "C" {

EMSCRIPTEN_KEEPALIVE int engine_render_init(std::uint32_t backend) {
  if (!rnd::isBackendValue(backend)) return engine::kRange;
  const std::uint32_t bodySlots = engine::world().bodyCapacity();
  if (bodySlots == 0) return engine::kNotConfigured;
  if (rnd::renderState == nullptr) {
    if (!rnd::acceptCreate()) return engine::kRange;
    rnd::RenderState* state = static_cast<rnd::RenderState*>(engine::arena::carve(sizeof(rnd::RenderState), alignof(rnd::RenderState)));
    std::uint32_t* propRecords = static_cast<std::uint32_t*>(engine::arena::carve(static_cast<std::size_t>(rnd::kPropClasses) * bodySlots * rnd::kRecordBytes, alignof(std::uint32_t)));
    std::uint8_t* bodyClass = static_cast<std::uint8_t*>(engine::arena::carve(bodySlots, alignof(std::uint8_t)));
    if (state == nullptr || propRecords == nullptr || bodyClass == nullptr) return engine::kRange;
    rnd::initState(*state, propRecords, bodyClass, bodySlots);
    rnd::renderState = state;
  }
  if (bodySlots > rnd::renderState->bodySlots) return engine::kRange;
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

}

namespace engine::render {

namespace {

SceneView sceneOf(RenderState& state) {
  SceneView scene{};
  scene.transforms = engine::world().transforms();
  scene.bodyCount = engine::world().bodyCapacity() < state.bodySlots ? engine::world().bodyCapacity() : state.bodySlots;
  scene.bodyClass = state.bodyClass;
  scene.pages = &engine::planet::state().pages;
  scene.placements = state.placements;
  scene.pageLods = state.pageLods;
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
  scene.albedoLayerOf = albedoLayerOfHandle;
  scene.bodyStamp = state.planPropsAlways != 0 ? ~counters().frames : (static_cast<std::uint64_t>(engine::world().poseEpoch()) << 32) | classDigest(state.bodyClass, scene.bodyCount);
  scene.skipProps = false;
  return scene;
}

}

}

extern "C" {

EMSCRIPTEN_KEEPALIVE int engine_render_frame() {
  if (rnd::renderState == nullptr || rnd::counters().ready == 0) return engine::kNotConfigured;
  rnd::RenderState& state = *rnd::renderState;
  rnd::counters().apiCalls = 0;
  rnd::counters().vegetationDraws = 0;
  rnd::counters().vegetationInstances = 0;
  rnd::SceneView scene = rnd::sceneOf(state);
  const bool drawsEveryBody = rnd::counters().backend == static_cast<std::uint32_t>(rnd::BackendKind::kWebGpu);
  scene.skipProps = drawsEveryBody && state.planPropsAlways == 0 && state.propsPlanned != 0 && state.plannedStamp == scene.bodyStamp;
  if (rnd::propBudget().limit != rnd::kNoPropBudget) scene.skipProps = false;
  {
    engine::phase::Scope scope(engine::phase::kPlan);
    rnd::planFrame(scene, state.camera, state.plan);
  }
  if (!scene.skipProps) {
    state.plannedStamp = scene.bodyStamp;
    state.propsPlanned = 1;
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

EMSCRIPTEN_KEEPALIVE int engine_render_refresh_props() {
  if (rnd::renderState == nullptr || rnd::counters().ready == 0) return engine::kNotConfigured;
  rnd::RenderState& state = *rnd::renderState;
  const rnd::SceneView scene = rnd::sceneOf(state);
  rnd::planProps(scene, state.camera, state.plan);
  state.plannedStamp = scene.bodyStamp;
  state.propsPlanned = 1;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE int engine_render_set_prop_plan(std::uint32_t always) {
  if (rnd::renderState == nullptr) return engine::kNotConfigured;
  rnd::renderState->planPropsAlways = always != 0 ? 1u : 0u;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE std::uint64_t engine_render_prop_plans() {
  return rnd::counters().propPlans;
}

EMSCRIPTEN_KEEPALIVE int engine_render_set_prop_budget(std::uint32_t limit) {
  rnd::setPropBudget(limit);
  if (rnd::renderState != nullptr) rnd::renderState->propsPlanned = 0;
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_prop_budget() {
  return rnd::propBudget().limit;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_prop_cutoff_bins() {
  return rnd::propBudget().bins;
}

EMSCRIPTEN_KEEPALIVE float engine_render_prop_cutoff_squared() {
  if (rnd::renderState == nullptr || rnd::renderState->camera.counts[rnd::kCameraCutoffFlagWord] == 0) return 0.0f;
  return rnd::renderState->camera.eye[rnd::kCameraCutoffWord];
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_props_in_frustum() {
  return rnd::counters().propsInFrustum;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_props_shed() {
  return rnd::counters().propsShed;
}

EMSCRIPTEN_KEEPALIVE float* engine_render_camera() {
  return rnd::renderState == nullptr ? nullptr : reinterpret_cast<float*>(&rnd::renderState->camera);
}

EMSCRIPTEN_KEEPALIVE std::uint8_t* engine_render_body_classes() {
  return rnd::renderState == nullptr ? nullptr : rnd::renderState->bodyClass;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_body_slots() {
  return rnd::renderState == nullptr ? 0 : rnd::renderState->bodySlots;
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

EMSCRIPTEN_KEEPALIVE int engine_render_set_page_lod(std::uint32_t slot, std::uint32_t level, std::int32_t parentSlot, std::uint32_t quadrant) {
  if (rnd::renderState == nullptr || slot >= rnd::pageLayers()) return engine::kRange;
  if (level >= engine::terrain::kMaxLevels || quadrant > engine::terrain::kQuadrantMask) return engine::kRange;
  if (parentSlot >= static_cast<std::int32_t>(rnd::pageLayers()) || parentSlot == static_cast<std::int32_t>(slot)) return engine::kRange;
  const std::uint16_t parent = parentSlot < 0 ? engine::terrain::kNoParent : static_cast<std::uint16_t>(parentSlot);
  rnd::renderState->pageLods[slot] = engine::terrain::PageLod{static_cast<std::uint8_t>(level), static_cast<std::uint8_t>(quadrant), parent};
  return engine::kOk;
}

EMSCRIPTEN_KEEPALIVE int engine_terrain_lod_configure(std::uint32_t pageBudget, std::uint32_t levels, double fullDetailAltitude) {
  return engine::terrain::configure(pageBudget, levels, fullDetailAltitude) ? engine::kOk : engine::kRange;
}

EMSCRIPTEN_KEEPALIVE const engine::terrain::LodState* engine_terrain_lod_select(double altitude) {
  return &engine::terrain::select(altitude);
}

EMSCRIPTEN_KEEPALIVE const engine::terrain::LodState* engine_terrain_lod_state() {
  return &engine::terrain::state();
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_pages_placed() {
  return rnd::counters().pagesPlaced;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t engine_render_pages_shed() {
  return rnd::counters().pagesShed;
}

EMSCRIPTEN_KEEPALIVE const std::uint32_t* engine_render_page_records() {
  return rnd::renderState == nullptr ? nullptr : rnd::renderState->plan.pageRecords;
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

EMSCRIPTEN_KEEPALIVE int engine_render_set_present_mode(std::uint32_t mode) {
  rnd::webgpu::setPresentMode(mode);
  return engine::kOk;
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
