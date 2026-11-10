#include "render_frame.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "../planet_frame.h"

namespace engine::render {

namespace {

constexpr std::uint64_t kFnvOffset = 0xcbf29ce484222325ull;
constexpr std::uint64_t kFnvPrime = 0x100000001b3ull;

Counters state{};
ModelSettings settings{kModelPathVisibility, 1u};

std::uint32_t bitsOf(float value) {
  std::uint32_t bits;
  std::memcpy(&bits, &value, sizeof bits);
  return bits;
}

std::uint64_t mixWord(std::uint64_t hash, std::uint32_t word) {
  return (hash ^ word) * kFnvPrime;
}

void extractPlanes(const float* viewProj, float planes[6][4]) {
  float rows[4][4];
  for (int r = 0; r < 4; ++r) {
    for (int c = 0; c < 4; ++c) rows[r][c] = viewProj[c * 4 + r];
  }
  for (int c = 0; c < 4; ++c) {
    planes[0][c] = rows[3][c] + rows[0][c];
    planes[1][c] = rows[3][c] - rows[0][c];
    planes[2][c] = rows[3][c] + rows[1][c];
    planes[3][c] = rows[3][c] - rows[1][c];
    planes[4][c] = rows[3][c] + rows[2][c];
    planes[5][c] = rows[3][c] - rows[2][c];
  }
  for (int p = 0; p < 6; ++p) {
    const float length = std::sqrt(planes[p][0] * planes[p][0] + planes[p][1] * planes[p][1] + planes[p][2] * planes[p][2]);
    const float scale = length > 0.0f ? 1.0f / length : 0.0f;
    for (int c = 0; c < 4; ++c) planes[p][c] *= scale;
  }
}

bool inFrustum(const float planes[6][4], const float* centre, float radius) {
  for (int p = 0; p < 6; ++p) {
    const float distance = planes[p][0] * centre[0] + planes[p][1] * centre[1] + planes[p][2] * centre[2] + planes[p][3];
    if (distance < -radius) return false;
  }
  return true;
}

std::uint32_t firstFreeLayer(const FramePlan& plan) {
  for (std::uint32_t layer = 0; layer < pageLayers(); ++layer) {
    if (plan.layerSlot[layer] == kNoLayer) return layer;
  }
  return kNoLayer;
}

void releaseSlot(FramePlan& plan, std::uint32_t slot) {
  const std::uint32_t layer = plan.slotLayer[slot];
  if (layer != kNoLayer) {
    plan.layerSlot[layer] = kNoLayer;
    plan.slotLayer[slot] = kNoLayer;
  }
  plan.dirty[slot] = 0;
}

void writePageRecord(FramePlan& plan, std::uint32_t index, const PagePlacement& placement, std::uint32_t layer, const FrameOrigin& origin) {
  std::uint32_t* out = plan.pageRecords + index * kPageRecordWords;
  std::memset(out, 0, kPageRecordBytes);
  out[0] = layer;
  const double pageOrigin[3] = {placement.origin[0], placement.origin[1], placement.origin[2]};
  float rel[3];
  relativeOf(pageOrigin, origin, rel);
  for (int k = 0; k < 3; ++k) {
    out[4 + k] = bitsOf(rel[k]);
    out[8 + k] = bitsOf(placement.uEdge[k]);
    out[12 + k] = bitsOf(placement.vEdge[k]);
  }
}

void syncPages(const SceneView& scene, FramePlan& plan) {
  plan.uploadCount = 0;
  plan.pageCount = 0;
  for (std::uint32_t slot = 0; slot < pageLayers(); ++slot) {
    const bool resident = scene.pages->state(static_cast<int>(slot)) == planet::PageState::kResident;
    if (!resident) {
      releaseSlot(plan, slot);
      continue;
    }
    if (plan.slotLayer[slot] == kNoLayer) {
      const std::uint32_t layer = firstFreeLayer(plan);
      if (layer == kNoLayer) continue;
      plan.slotLayer[slot] = layer;
      plan.layerSlot[layer] = slot;
      plan.dirty[slot] = 1;
    }
    if (plan.dirty[slot] != 0) {
      plan.dirty[slot] = 0;
      plan.uploadSlot[plan.uploadCount] = slot;
      plan.uploadLayer[plan.uploadCount] = plan.slotLayer[slot];
      plan.uploadCount += 1;
    }
    if (scene.placements[slot].placed != 0) {
      writePageRecord(plan, plan.pageCount, scene.placements[slot], plan.slotLayer[slot], scene.origin);
      plan.pageCount += 1;
    }
  }
}

MaterialSlot defaultMaterial() {
  MaterialSlot material{};
  material.colour[0] = 0.8f;
  material.colour[1] = 0.8f;
  material.colour[2] = 0.8f;
  material.colour[3] = 1.0f;
  material.roughness = 0.6f;
  return material;
}

}

Counters& counters() {
  return state;
}

ModelSettings& modelSettings() {
  return settings;
}

void countCall() {
  state.apiCalls += 1;
}

bool acceptCreate() {
  if (state.sealed != 0) {
    state.createsAfterSeal += 1;
    return false;
  }
  return true;
}

std::uint32_t pageLayers() {
  return std::min(kMaxPageLayers, static_cast<std::uint32_t>(planet::state().pages.pageSlotCount()));
}

void resetPlan(FramePlan& plan) {
  for (std::uint32_t layer = 0; layer < pageLayers(); ++layer) {
    plan.slotLayer[layer] = kNoLayer;
    plan.layerSlot[layer] = kNoLayer;
    plan.dirty[layer] = 0;
  }
  for (std::uint32_t layer = 0; layer < kAlbedoLayers; ++layer) plan.albedoPending[layer] = 0;
  plan.uploadCount = 0;
  plan.pageCount = 0;
  plan.checksum = 0;
  for (std::uint32_t c = 0; c < kPropClasses; ++c) plan.propCount[c] = 0;
}

std::uint32_t uploadRunEnd(const FramePlan& plan, std::uint32_t start) {
  std::uint32_t end = start + 1;
  while (end < plan.uploadCount && plan.uploadSlot[end] == plan.uploadSlot[end - 1] + 1 && plan.uploadLayer[end] == plan.uploadLayer[end - 1] + 1) end += 1;
  return end;
}

std::uint32_t albedoRunEnd(const FramePlan& plan, std::uint32_t start) {
  std::uint32_t end = start + 1;
  while (end < kAlbedoLayers && plan.albedoPending[end] != 0) end += 1;
  return end;
}

void resolveMaterials(const MaterialSlot* table, std::uint32_t count, const std::uint8_t* albedoReady, std::int32_t (*albedoLayerOf)(double handle), std::uint32_t* words) {
  const MaterialSlot fallback = defaultMaterial();
  for (std::uint32_t m = 0; m < kMaterialSlots; ++m) {
    MaterialSlot material = m < count ? table[m] : fallback;
    std::int32_t layer = 0;
    if (material.albedo != 0 && albedoLayerOf != nullptr) layer = albedoLayerOf(static_cast<double>(material.albedo));
    if (layer < 0 || layer >= static_cast<std::int32_t>(kAlbedoLayers) || albedoReady[layer] == 0) layer = 0;
    material.albedo = static_cast<std::uint32_t>(layer);
    std::memcpy(words + m * kMaterialWords, &material, kMaterialBytes);
  }
}

void planFrame(const SceneView& scene, Camera& camera, FramePlan& plan) {
  extractPlanes(camera.viewProj, camera.planes);
  for (std::uint32_t c = 0; c < kPropClasses; ++c) camera.classRadius[c] = kPropRadius;
  const std::uint32_t lights = scene.lightCount < kLightSlots ? scene.lightCount : kLightSlots;
  camera.counts[0] = lights;
  camera.counts[1] = scene.bodyCount;
  camera.counts[2] = 0;
  camera.counts[3] = 0;

  for (std::uint32_t c = 0; c < kPropClasses; ++c) plan.propCount[c] = 0;
  std::uint64_t hash = kFnvOffset;
  for (std::uint32_t i = 0; i < scene.bodyCount; ++i) {
    std::uint32_t out[kRecordWords];
    const Transform& t = scene.transforms[i];
    const float body[3] = {t.x, t.y, t.z};
    float rel[3];
    relativeOfBody(body, scene.bodyOrigin, scene.origin, rel);
    const float words[kRecordWords - 1] = {rel[0], rel[1], rel[2], t.qx, t.qy, t.qz, t.qw};
    for (std::uint32_t k = 0; k < kRecordWords - 1; ++k) out[k] = bitsOf(words[k]);
    const std::uint32_t cls = scene.bodyClass[i];
    out[kRecordWords - 1] = cls;
    for (std::uint32_t k = 0; k < kRecordWords; ++k) hash = mixWord(hash, out[k]);
    if (cls >= kPropClasses) continue;
    if (!inFrustum(camera.planes, rel, kPropRadius)) continue;
    const std::uint32_t index = plan.propCount[cls];
    plan.propCount[cls] = index + 1;
    std::memcpy(plan.propRecords + (cls * kBodySlots + index) * kRecordWords, out, kRecordBytes);
  }
  plan.checksum = hash;

  syncPages(scene, plan);
  resolveMaterials(scene.materials, scene.materialCount, scene.albedoReady, scene.albedoLayerOf, plan.materialWords);

  state.checksum = hash;
  state.uploads = plan.uploadCount;
  state.pages = plan.pageCount;
  state.lights = lights;
  for (std::uint32_t c = 0; c < kPropClasses; ++c) state.visible[c] = plan.propCount[c];
}

}
