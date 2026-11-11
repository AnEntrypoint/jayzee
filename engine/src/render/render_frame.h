#ifndef ENGINE_RENDER_FRAME_H
#define ENGINE_RENDER_FRAME_H

#include <cstdint>

#include "camera_relative.h"

#include "../budget.h"
#include "../page_cache.h"
#include "../world.h"

namespace engine::render {

constexpr std::uint32_t kPropClasses = 4;
constexpr std::uint32_t kBodySlots = budget::kTopTierBodies;
constexpr std::uint32_t kRecordWords = 8;
constexpr std::uint32_t kRecordBytes = kRecordWords * 4;
constexpr std::uint32_t kPropVertices = 36;
constexpr std::uint32_t kMaxPageLayers = planet::kMaxRenderedPages;
constexpr std::uint32_t kPageSide = planet::kPageSide;
constexpr std::uint32_t kPageQuads = kPageSide - 1;
constexpr std::uint32_t kPageVertices = 6 * kPageQuads * kPageQuads;
constexpr std::uint32_t kPageRecordWords = 16;
constexpr std::uint32_t kPageRecordBytes = kPageRecordWords * 4;
constexpr std::uint32_t kMaterialSlots = 256;
constexpr std::uint32_t kMaterialWords = 10;
constexpr std::uint32_t kMaterialBytes = kMaterialWords * 4;
constexpr std::uint32_t kAlbedoLayers = 64;
constexpr std::uint32_t kAlbedoSide = 16;
constexpr std::uint32_t kAlbedoBytes = kAlbedoSide * kAlbedoSide * 4;
constexpr std::uint32_t kLightSlots = 256;
constexpr std::uint32_t kLightBytes = 32;
constexpr std::uint32_t kNoLayer = 0xffffffffu;
constexpr std::uint32_t kNoClass = 0xffu;
constexpr std::uint32_t kArgsWords = 20;
constexpr std::uint32_t kArgsPropWord = 0;
constexpr std::uint32_t kArgsTerrainWord = 16;
constexpr float kPropRadius = 0.8660254f;

struct MaterialSlot {
  float colour[4];
  float roughness;
  float metallic;
  float emissive[3];
  std::uint32_t albedo;
};

struct LightSlot {
  float position[3];
  float radius;
  float colour[3];
  float intensity;
};

struct PagePlacement {
  double origin[3];
  float uEdge[3];
  float vEdge[3];
  std::uint32_t placed;
};

struct Camera {
  float planes[6][4];
  float viewProj[16];
  float eye[4];
  std::uint32_t counts[4];
  float classRadius[4];
  std::uint32_t classMaterial[4];
};

static_assert(sizeof(MaterialSlot) == 40);
static_assert(sizeof(LightSlot) == 32);
static_assert(sizeof(PagePlacement) == 56);
static_assert(sizeof(Camera) == 224);
static_assert(sizeof(Transform) == 28);

struct FramePlan {
  std::uint32_t slotLayer[kMaxPageLayers];
  std::uint32_t layerSlot[kMaxPageLayers];
  std::uint8_t dirty[kMaxPageLayers];
  std::uint8_t albedoPending[kAlbedoLayers];
  std::uint32_t uploadSlot[kMaxPageLayers];
  std::uint32_t uploadLayer[kMaxPageLayers];
  std::uint32_t uploadCount;
  std::uint32_t pageRecords[kMaxPageLayers * kPageRecordWords];
  std::uint32_t pageCount;
  std::uint32_t propRecords[kPropClasses * kBodySlots * kRecordWords];
  std::uint32_t propCount[kPropClasses];
  std::uint32_t materialWords[kMaterialSlots * kMaterialWords];
  std::uint64_t checksum;
};

struct SceneView {
  const Transform* transforms;
  std::uint32_t bodyCount;
  const std::uint8_t* bodyClass;
  const planet::PageCache* pages;
  const PagePlacement* placements;
  const MaterialSlot* materials;
  std::uint32_t materialCount;
  const LightSlot* lights;
  std::uint32_t lightCount;
  const std::uint8_t* albedoReady;
  const std::uint8_t* albedoPixels;
  std::int32_t (*albedoLayerOf)(double handle);
  FrameOrigin origin;
  FrameOrigin bodyOrigin;
};

constexpr std::uint32_t kModelPathForward = 0;
constexpr std::uint32_t kModelPathVisibility = 1;
constexpr std::uint32_t kTriangleBits = 7;
constexpr std::uint32_t kTriangleMask = (1u << kTriangleBits) - 1u;
constexpr std::uint32_t kNoVisibility = 0;

constexpr std::uint32_t visibilityId(std::uint32_t cluster, std::uint32_t triangle) {
  return ((cluster << kTriangleBits) | triangle) + 1u;
}

constexpr std::uint32_t visibilityCluster(std::uint32_t id) {
  return (id - 1u) >> kTriangleBits;
}

constexpr std::uint32_t visibilityTriangle(std::uint32_t id) {
  return (id - 1u) & kTriangleMask;
}

struct ModelSettings {
  std::uint32_t path;
  std::uint32_t occlusion;
};

struct Counters {
  std::uint64_t frames;
  std::uint64_t checksum;
  std::uint32_t apiCalls;
  std::uint32_t apiCallsLast;
  std::uint32_t uploads;
  std::uint32_t pages;
  std::uint32_t lights;
  std::uint32_t visible[kPropClasses];
  std::uint32_t backend;
  std::uint32_t ready;
  std::uint32_t sealed;
  std::uint32_t createsAfterSeal;
  std::uint32_t modelPath;
  std::uint32_t cullPassA;
  std::uint32_t cullCandidates;
  std::uint32_t cullPassB;
  std::uint32_t vegetationDraws;
  std::uint32_t vegetationInstances;
  std::uint32_t cullFresh;
  std::uint32_t countReadback;
};

Counters& counters();
ModelSettings& modelSettings();
void countCall();
bool acceptCreate();
std::uint32_t pageLayers();
void resetPlan(FramePlan& plan);
void planFrame(const SceneView& scene, Camera& camera, FramePlan& plan);
void resolveMaterials(const MaterialSlot* table, std::uint32_t count, const std::uint8_t* albedoReady, std::int32_t (*albedoLayerOf)(double handle), std::uint32_t* words);
std::uint32_t uploadRunEnd(const FramePlan& plan, std::uint32_t start);
std::uint32_t albedoRunEnd(const FramePlan& plan, std::uint32_t start);

}

#define ENGINE_RENDER_CALL(expr) (::engine::render::countCall(), (expr))

#endif
