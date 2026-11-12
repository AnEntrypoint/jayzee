#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

#include "harness.h"
#include "render/render_frame.h"

namespace engine::witness {

namespace {

namespace rnd = engine::render;

constexpr std::uint64_t kExpectedChecksum = 0xa867dd42811cab96ull;
constexpr std::uint32_t kExpectedVisible[rnd::kPropClasses] = {2767, 2776, 2767, 2761};

rnd::FramePlan plan;
rnd::Camera camera;
constexpr std::uint32_t kWitnessBodySlots = 12288;
Transform transforms[kWitnessBodySlots];
std::uint8_t classes[kWitnessBodySlots];
std::uint32_t propStorage[rnd::kPropClasses * kWitnessBodySlots * rnd::kRecordWords];
rnd::MaterialSlot materials[1];
std::uint8_t albedoReady[rnd::kAlbedoLayers];
std::uint8_t albedoPixels[rnd::kAlbedoLayers * rnd::kAlbedoBytes];
planet::PageCache pages;

std::int32_t noAlbedoLayer(double) {
  return -1;
}

void normalise(float* v) {
  const float l = std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  const float s = l > 0.0f ? 1.0f / l : 1.0f;
  v[0] *= s;
  v[1] *= s;
  v[2] *= s;
}

void lookAt(const float* eye, float* out) {
  float z[3] = {eye[0], eye[1], eye[2]};
  normalise(z);
  float x[3] = {z[2], 0.0f, -z[0]};
  normalise(x);
  const float y[3] = {z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]};
  const float tx = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  const float ty = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  const float tz = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  const float view[16] = {x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, tx, ty, tz, 1};
  std::memcpy(out, view, sizeof view);
}

void perspective(float fovY, float aspect, float zNear, float zFar, float* out) {
  const float f = 1.0f / std::tan(fovY / 2.0f);
  const float nf = 1.0f / (zNear - zFar);
  const float proj[16] = {f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (zFar + zNear) * nf, -1, 0, 0, 2 * zFar * zNear * nf, 0};
  std::memcpy(out, proj, sizeof proj);
}

void multiply(const float* p, const float* v, float* out) {
  for (int c = 0; c < 4; ++c) {
    for (int r = 0; r < 4; ++r) {
      float sum = 0.0f;
      for (int k = 0; k < 4; ++k) sum += p[k * 4 + r] * v[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
}

void buildScene(std::uint32_t frame) {
  for (std::uint32_t i = 0; i < kWitnessBodySlots; ++i) {
    transforms[i] = Transform{static_cast<float>(i % 100) * 0.6f - 30.0f, 1.0f + static_cast<float>(i % 5), static_cast<float>(i / 100) * 0.6f - 30.0f, 0.0f, 0.0f, 0.0f, 1.0f};
    classes[i] = static_cast<std::uint8_t>(i % rnd::kPropClasses);
  }
  const float angle = static_cast<float>(frame) * 0.01f;
  const float eye[3] = {std::sin(angle) * 60.0f, 25.0f, std::cos(angle) * 60.0f};
  float view[16];
  float proj[16];
  lookAt(eye, view);
  perspective(1.0471975512f, 1.0f, 0.1f, 500.0f, proj);
  multiply(proj, view, camera.viewProj);
  camera.eye[0] = eye[0];
  camera.eye[1] = eye[1];
  camera.eye[2] = eye[2];
  camera.eye[3] = 1.0f;
}

constexpr std::uint32_t kBudget = 2000;
constexpr std::uint32_t kBudgetInBand = 2100;
constexpr std::uint32_t kBudgetWide = 4000;
constexpr std::uint32_t kOrbitFrames = 120;
constexpr std::uint64_t kFnvOffset = 0xcbf29ce484222325ull;
constexpr std::uint64_t kFnvPrime = 0x100000001b3ull;

float everyDistance[kWitnessBodySlots];
float sortedDistance[kWitnessBodySlots];

std::uint32_t keptTotal() {
  std::uint32_t total = 0;
  for (std::uint32_t c = 0; c < rnd::kPropClasses; ++c) total += plan.propCount[c];
  return total;
}

float recordDistanceSquared(std::uint32_t cls, std::uint32_t index) {
  float rel[3];
  std::memcpy(rel, plan.propRecords + (cls * plan.bodySlots + index) * rnd::kRecordWords, sizeof rel);
  const float dx = rel[0] - camera.eye[0];
  const float dy = rel[1] - camera.eye[1];
  const float dz = rel[2] - camera.eye[2];
  return dx * dx + dy * dy + dz * dz;
}

std::uint32_t collectDistances(float* out) {
  std::uint32_t count = 0;
  for (std::uint32_t c = 0; c < rnd::kPropClasses; ++c) {
    for (std::uint32_t i = 0; i < plan.propCount[c]; ++i) out[count++] = recordDistanceSquared(c, i);
  }
  return count;
}

std::uint64_t keptDigest() {
  std::uint64_t hash = kFnvOffset;
  for (std::uint32_t c = 0; c < rnd::kPropClasses; ++c) {
    hash = (hash ^ plan.propCount[c]) * kFnvPrime;
    const std::uint32_t* words = plan.propRecords + c * plan.bodySlots * rnd::kRecordWords;
    for (std::uint32_t w = 0; w < plan.propCount[c] * rnd::kRecordWords; ++w) hash = (hash ^ words[w]) * kFnvPrime;
  }
  return hash;
}

std::uint32_t binsBelow(const float* distances, std::uint32_t count, std::uint32_t bin) {
  std::uint32_t below = 0;
  for (std::uint32_t i = 0; i < count; ++i) below += rnd::propBudgetBin(distances[i]) < bin ? 1 : 0;
  return below;
}

void propBudgetWitness(const rnd::SceneView& scene) {
  using engine::test::check;
  using engine::test::observe;

  const rnd::Counters& counters = rnd::counters();
  const std::uint32_t inFrustum = keptTotal();
  check(rnd::propBudget().limit == rnd::kNoPropBudget && rnd::propBudget().bins == rnd::kPropBudgetBins,
        "prop budget: the default is no limit with the cutoff past the last distance band");
  check(counters.propsShed == 0 && counters.propsInFrustum == inFrustum, "prop budget: with no limit nothing is shed and every prop in the frustum is planned");
  const std::uint32_t every = collectDistances(everyDistance);
  std::memcpy(sortedDistance, everyDistance, sizeof(float) * every);
  std::sort(sortedDistance, sortedDistance + every);
  const std::uint32_t boundaryBin = rnd::propBudgetBin(sortedDistance[kBudget - 1]);
  const std::uint32_t nearerThanBoundary = binsBelow(everyDistance, every, boundaryBin);
  observe("prop budget props in the frustum", static_cast<double>(inFrustum));
  observe("prop budget boundary band", static_cast<double>(boundaryBin));
  observe("prop budget distance of the last prop inside the budget", std::sqrt(static_cast<double>(sortedDistance[kBudget - 1])));
  check(inFrustum > kBudgetWide, "prop budget: the witness frustum holds more props than every budget used");

  const std::uint64_t carvesBefore = engine::arena::carves();
  rnd::setPropBudget(kBudget);
  rnd::planProps(scene, camera, plan);
  const std::uint32_t kept = keptTotal();
  const std::uint32_t settledBins = rnd::propBudget().bins;
  const std::uint64_t settledDigest = keptDigest();
  observe("prop budget kept under the budget", static_cast<double>(kept));
  observe("prop budget shed under the budget", static_cast<double>(counters.propsShed));
  observe("prop budget carried cutoff band", static_cast<double>(settledBins));
  check(kept == kBudget, "prop budget: with more props in the frustum than the budget the plan keeps exactly the budget");
  check(counters.propsShed == inFrustum - kept && counters.propsInFrustum == inFrustum, "prop budget: the shed counter is the props in the frustum less the props kept");
  check(plan.checksum == kExpectedChecksum, "prop budget: the pose checksum covers every body and does not change under a budget");
  static float keptDistance[kWitnessBodySlots];
  const std::uint32_t keptCount = collectDistances(keptDistance);
  std::uint32_t farthestKeptBin = 0;
  for (std::uint32_t i = 0; i < keptCount; ++i) farthestKeptBin = std::max(farthestKeptBin, rnd::propBudgetBin(keptDistance[i]));
  check(settledBins == boundaryBin && farthestKeptBin <= boundaryBin, "prop budget: no kept prop lies in a distance band beyond the band of the last prop a full sort would keep");
  check(binsBelow(keptDistance, keptCount, boundaryBin) == nearerThanBoundary, "prop budget: every prop in a nearer distance band than the boundary is kept");

  rnd::writePropCutoff(camera);
  check(camera.counts[rnd::kCameraCutoffFlagWord] == 1 && camera.eye[rnd::kCameraCutoffWord] == rnd::propCutoffSquared(settledBins),
        "prop cutoff: under a budget the camera carries the cutoff flag and the squared distance where the cutoff band starts");
  std::uint32_t shaderShown = 0;
  std::uint32_t ruleMismatches = 0;
  for (std::uint32_t i = 0; i < every; ++i) {
    const bool inside = everyDistance[i] < camera.eye[rnd::kCameraCutoffWord];
    shaderShown += inside ? 1 : 0;
    if (inside != (rnd::propBudgetBin(everyDistance[i]) < settledBins)) ruleMismatches += 1;
  }
  observe("prop cutoff distance in metres carried to the shader", std::sqrt(static_cast<double>(camera.eye[rnd::kCameraCutoffWord])));
  observe("prop cutoff props the shader rule shows", static_cast<double>(shaderShown));
  check(ruleMismatches == 0, "prop cutoff: a squared distance below the carried cutoff is exactly a distance band below the cutoff band, for every prop in the frustum");
  check(shaderShown == nearerThanBoundary && shaderShown <= kBudget && shaderShown > kBudget / 2,
        "prop cutoff: the shader rule shows every prop nearer than the boundary band and none in it, so it stays inside the budget");

  rnd::planProps(scene, camera, plan);
  check(keptDigest() == settledDigest && rnd::propBudget().bins == settledBins, "prop budget: planning the same frame again keeps the same records and the same cutoff");

  rnd::setPropBudget(kBudgetInBand);
  rnd::planProps(scene, camera, plan);
  observe("prop budget kept at a budget 5 percent larger", static_cast<double>(keptTotal()));
  check(rnd::propBudget().bins == settledBins && keptTotal() >= kBudget && keptTotal() <= kBudgetInBand,
        "prop budget: a budget 5 percent larger stays inside the hysteresis band, so the cutoff holds and only the boundary band fills");

  rnd::setPropBudget(kBudgetWide);
  rnd::planProps(scene, camera, plan);
  const std::uint32_t wideBins = rnd::propBudget().bins;
  const std::uint32_t wideKept = keptTotal();
  observe("prop budget carried cutoff band at twice the budget", static_cast<double>(wideBins));
  observe("prop budget kept at twice the budget", static_cast<double>(wideKept));
  check(wideBins > settledBins && wideKept <= kBudgetWide && wideKept > kBudgetWide - (kBudgetWide >> rnd::kPropBudgetHeadroomShift),
        "prop budget: doubling the budget moves the cutoff out and keeps more than seven eighths of the new budget");

  rnd::setPropBudget(kBudget);
  rnd::planProps(scene, camera, plan);
  check(rnd::propBudget().bins == settledBins && keptDigest() == settledDigest, "prop budget: back at the first budget the cutoff and the kept records return to the first result");

  std::uint32_t most = 0;
  std::uint32_t least = kWitnessBodySlots;
  std::uint32_t cutoffMoves = 0;
  bool shedAdds = true;
  std::uint32_t lastBins = rnd::propBudget().bins;
  bool cutoffCarried = true;
  std::uint32_t mostShown = 0;
  std::uint32_t leastShown = kWitnessBodySlots;
  for (std::uint32_t frame = 0; frame < kOrbitFrames; ++frame) {
    buildScene(600 + frame);
    rnd::planFrame(scene, camera, plan);
    const std::uint32_t now = keptTotal();
    most = std::max(most, now);
    least = std::min(least, now);
    shedAdds = shedAdds && counters.propsShed + now == counters.propsInFrustum;
    if (rnd::propBudget().bins != lastBins) cutoffMoves += 1;
    lastBins = rnd::propBudget().bins;
    const std::uint32_t orbitKept = collectDistances(keptDistance);
    std::uint32_t orbitShown = 0;
    for (std::uint32_t i = 0; i < orbitKept; ++i) orbitShown += keptDistance[i] < camera.eye[rnd::kCameraCutoffWord] ? 1 : 0;
    cutoffCarried = cutoffCarried && camera.counts[rnd::kCameraCutoffFlagWord] == 1 && camera.eye[rnd::kCameraCutoffWord] == rnd::propCutoffSquared(lastBins);
    mostShown = std::max(mostShown, orbitShown);
    leastShown = std::min(leastShown, orbitShown);
  }
  observe("prop cutoff most props the shader rule shows over the orbit", static_cast<double>(mostShown));
  observe("prop cutoff least props the shader rule shows over the orbit", static_cast<double>(leastShown));
  check(cutoffCarried && mostShown <= kBudget && leastShown > kBudget / 2,
        "prop cutoff: over the orbit every frame carries the cutoff of its plan, and the shader rule shows at most the budget and more than half of it");
  observe("prop budget most kept over the orbit", static_cast<double>(most));
  observe("prop budget least kept over the orbit", static_cast<double>(least));
  observe("prop budget cutoff moves over the orbit", static_cast<double>(cutoffMoves));
  check(most <= kBudget && least > kBudget - (kBudget >> rnd::kPropBudgetHeadroomShift) && shedAdds,
        "prop budget: over a 120 frame orbit the kept count never exceeds the budget and never falls to seven eighths of it");
  check(cutoffMoves <= kOrbitFrames / 8, "prop budget: the carried cutoff moves on fewer than one frame in eight of the orbit");
  check(engine::arena::carves() == carvesBefore, "prop budget: the budgeted plans carve nothing from the arena");

  rnd::setPropBudget(rnd::kNoPropBudget);
  buildScene(599);
  rnd::planFrame(scene, camera, plan);
  bool restored = plan.checksum == kExpectedChecksum && counters.propsShed == 0;
  for (std::uint32_t c = 0; c < rnd::kPropClasses; ++c) restored = restored && plan.propCount[c] == kExpectedVisible[c];
  check(restored && rnd::propBudget().bins == rnd::kPropBudgetBins, "prop budget: clearing the budget restores the recorded visible counts and sheds nothing");
  check(camera.counts[rnd::kCameraCutoffFlagWord] == 0 && camera.eye[rnd::kCameraCutoffWord] == 0.0f, "prop cutoff: with no budget the camera carries no cutoff flag and a zero cutoff word");
}

}

void phase10Plan() {
  using engine::test::check;
  using engine::test::observe;
  using engine::test::observeHex;

  buildScene(599);
  for (std::uint32_t layer = 0; layer < rnd::kAlbedoLayers; ++layer) albedoReady[layer] = 0;
  std::memset(albedoPixels, 0, sizeof albedoPixels);
  std::memset(materials, 0, sizeof materials);

  rnd::SceneView scene{};
  scene.transforms = transforms;
  scene.bodyCount = kWitnessBodySlots;
  scene.bodyClass = classes;
  scene.pages = &pages;
  scene.materials = materials;
  scene.materialCount = 1;
  scene.albedoReady = albedoReady;
  scene.albedoPixels = albedoPixels;
  scene.albedoLayerOf = noAlbedoLayer;

  plan.propRecords = propStorage;
  plan.bodySlots = kWitnessBodySlots;
  rnd::resetPlan(plan);
  rnd::planFrame(scene, camera, plan);

  observeHex("phase 10 plan checksum", plan.checksum);
  for (std::uint32_t c = 0; c < rnd::kPropClasses; ++c) observe("phase 10 visible class", static_cast<double>(plan.propCount[c]));
  check(plan.checksum == kExpectedChecksum, "phase 10: the frame checksum is the value recorded before the plan layout change");
  bool counts = true;
  for (std::uint32_t c = 0; c < rnd::kPropClasses; ++c) counts = counts && plan.propCount[c] == kExpectedVisible[c];
  check(counts, "phase 10: the visible count per class matches the recorded values");
  propBudgetWitness(scene);
}

}
