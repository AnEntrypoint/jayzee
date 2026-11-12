#include <sys/wait.h>
#include <unistd.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

#include "arena.h"
#include "harness.h"
#include "model_pool.h"
#include "render/render_frame.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

constexpr std::uint32_t kSlots = 8;
constexpr std::uint32_t kVertices = 8;
constexpr std::uint32_t kStride = 12;
constexpr std::uint32_t kCoarse = 384;
constexpr std::uint32_t kMiddle = 768;
constexpr std::uint32_t kFine = 1536;
constexpr std::uint32_t kIndices = kCoarse + kMiddle + kFine;
constexpr std::uint32_t kLods = 3;
constexpr std::uint32_t kHidden = kLods;
constexpr float kPixelsPerUnit = 1000.0f;
constexpr double kNear = 20.0;
constexpr std::uint32_t kJitterFrames = 200;
constexpr std::uint32_t kSweepFrames = 400;
constexpr std::uint32_t kLooseBudget = 7000;
constexpr std::uint32_t kTightBudget = 3000;
constexpr std::uint32_t kWideBudget = 20000;
constexpr std::uint32_t kViewportHeight = 720;
constexpr float kHalfFov = 0.52359877f;

alignas(16) std::uint8_t gLodStorage[160 * 1024];
std::uint32_t gLodIndices[kIndices];
models::Range gLodRuns[models::kMaxClustersPerSlot];
const models::Layout kLodLayout{kSlots, kVertices, kIndices, kStride};
const std::uint32_t kLodCounts[kLods] = {kCoarse, kMiddle, kFine};

void everyPlane(float planes[6][4]) {
  for (int p = 0; p < 6; ++p) {
    for (int c = 0; c < 4; ++c) planes[p][c] = 0.0f;
    planes[p][3] = 1.0f;
  }
}

double load(bool lods) {
  alignas(16) std::uint8_t vertices[kVertices * kStride];
  for (std::uint32_t v = 0; v < kVertices; ++v) {
    const float position[3] = {(v & 1u) != 0 ? 1.0f : -1.0f, (v & 2u) != 0 ? 1.0f : -1.0f, (v & 4u) != 0 ? 1.0f : -1.0f};
    std::memcpy(vertices + v * kStride, position, sizeof position);
  }
  for (std::uint32_t i = 0; i < kIndices; ++i) gLodIndices[i] = i % kVertices;
  const double handle = models::acquire(kVertices, kIndices);
  if (handle <= 0.0 || models::upload(handle, vertices, kVertices, gLodIndices, kIndices) != kOk) return 0.0;
  if (lods && models::setLods(handle, kLodCounts, kLods) != kOk) return 0.0;
  models::clearDirty(static_cast<std::uint32_t>(models::slotOf(handle)));
  return handle;
}

double radiusOf() {
  return 2.0 * std::sqrt(3.0);
}

double distanceFor(double level) {
  return 2.0 * radiusOf() * kPixelsPerUnit / (models::kLodFullPixels / std::pow(2.0, level));
}

void eyeAt(std::uint32_t slot, double distance, double eye[3]) {
  float offset[3];
  models::modelOffset(slot, offset);
  eye[0] = offset[0];
  eye[1] = offset[1];
  eye[2] = offset[2] + distance;
}

std::uint32_t levelAt(std::uint32_t slot, double level) {
  double eye[3];
  eyeAt(slot, distanceFor(level), eye);
  models::selectLods(eye, kPixelsPerUnit);
  return models::slotLodLevel(slot);
}

std::uint32_t drawnIndices() {
  float planes[6][4];
  everyPlane(planes);
  const double origin[3] = {0.0, 0.0, 0.0};
  std::uint32_t total = 0;
  for (std::uint32_t slot = 0; slot < models::slotCount(); ++slot) {
    if (!models::slotReady(slot)) continue;
    const std::uint32_t runs = models::visibleRuns(slot, planes, gLodRuns, nullptr, origin);
    for (std::uint32_t r = 0; r < runs; ++r) total += gLodRuns[r].indexCount;
  }
  return total;
}

bool runIs(std::uint32_t slot, std::uint32_t first, std::uint32_t count) {
  float planes[6][4];
  everyPlane(planes);
  const double origin[3] = {0.0, 0.0, 0.0};
  const std::uint32_t runs = models::visibleRuns(slot, planes, gLodRuns, nullptr, origin);
  if (count == 0) return runs == 0;
  return runs == 1 && gLodRuns[0].firstIndex == slot * kIndices + first && gLodRuns[0].indexCount == count;
}

void rangesAndDefaults() {
  const double plain = load(false);
  check(plain > 0.0, "model lod: a slot loads with no lod ranges");
  const std::uint32_t slot = static_cast<std::uint32_t>(models::slotOf(plain));
  double eye[3];
  eyeAt(slot, 5000.0, eye);
  const models::LodStats& idle = models::selectLods(eye, kPixelsPerUnit);
  check(idle.passes == 0 && models::slotLodCount(slot) == 1 && models::slotLodLevel(slot) == models::kLodUnset && models::indexBudget() == models::kNoIndexBudget,
        "model lod: with no lod ranges and no budget the selection does nothing, however small the model is on screen");
  check(runIs(slot, 0, kIndices), "model lod: a slot with no lod ranges draws its whole index range, as before");

  const std::uint32_t none[1] = {kIndices};
  const std::uint32_t five[5] = {384, 384, 384, 384, 1152};
  const std::uint32_t ragged[2] = {381, kIndices - 381};
  const std::uint32_t notTriangles[2] = {384, kIndices - 385};
  const std::uint32_t short2[2] = {384, 384};
  const std::uint32_t empty[2] = {kIndices, 0};
  check(models::setLods(plain, none, 0) == kRange && models::setLods(plain, five, 5) == kRange && models::setLods(plain, nullptr, 1) == kRange,
        "model lod: no ranges, more than 4 ranges and a null list are refused");
  check(models::setLods(plain, ragged, 2) == kRange, "model lod: a range that does not end on a cluster boundary is refused");
  check(models::setLods(plain, notTriangles, 2) == kRange && models::setLods(plain, short2, 2) == kRange && models::setLods(plain, empty, 2) == kRange,
        "model lod: ranges that are not whole triangles, do not sum to the slot's indices, or are empty are refused");
  check(models::setLods(plain + 1.0, kLodCounts, kLods) == kBadId, "model lod: a stale handle is refused");
  check(models::setLods(plain, kLodCounts, kLods) == kOk && models::slotLodCount(slot) == kLods, "model lod: three ranges, coarse to fine, are accepted");
  check(models::slotLodIndices(slot, 0) == kFine && models::slotLodIndices(slot, 1) == kMiddle && models::slotLodIndices(slot, 2) == kCoarse &&
            models::slotLodIndices(slot, kHidden) == 0,
        "model lod: level 0 is the finest range and the last level is the coarsest");
  check(runIs(slot, kCoarse + kMiddle, kFine), "model lod: before any selection a slot with lod ranges draws its finest range");
  check(models::setLods(plain, none, 1) == kOk && models::slotLodCount(slot) == 1 && runIs(slot, 0, kIndices),
        "model lod: one range returns the slot to a single whole range");
  check(models::release(plain) == kOk, "model lod: the slot releases");
}

void screenSize() {
  const double handle = load(true);
  const std::uint32_t slot = static_cast<std::uint32_t>(models::slotOf(handle));
  double eye[3];
  eyeAt(slot, kNear, eye);
  observe("model lod: projected diameter in pixels at 20 m", models::slotPixels(slot, eye, kPixelsPerUnit));
  check(std::fabs(models::slotPixels(slot, eye, kPixelsPerUnit) - 2.0 * radiusOf() * kPixelsPerUnit / kNear) < 0.01,
        "model lod: the projected diameter is twice the bounding radius times the pixels per unit over the distance");
  models::selectLods(eye, kPixelsPerUnit);
  check(models::slotLodLevel(slot) == 0 && runIs(slot, kCoarse + kMiddle, kFine), "model lod: a model larger than the full-detail size draws its finest range");
  check(levelAt(slot, 1.5) == 1 && runIs(slot, kCoarse, kMiddle), "model lod: at a size ratio of 2 to the power 1.5 the middle range is drawn");
  check(levelAt(slot, 2.5) == 2 && runIs(slot, 0, kCoarse), "model lod: at a size ratio of 2 to the power 2.5 the coarsest range is drawn");
  check(levelAt(slot, 9.0) == 2 && runIs(slot, 0, kCoarse), "model lod: with no budget a far model keeps its coarsest range and is never hidden");
  check(levelAt(slot, 0.0) == 0, "model lod: back at full size the finest range returns");

  check(levelAt(slot, 1.2) == 0, "model lod: hysteresis holds the finer level until the ratio passes the step by a quarter level");
  check(levelAt(slot, 1.3) == 1, "model lod: past the band the level coarsens");
  check(levelAt(slot, 0.8) == 1, "model lod: hysteresis holds the coarser level until the ratio falls a quarter level below the step");
  check(levelAt(slot, 0.7) == 0, "model lod: below the band the level refines");
  std::uint32_t flips = 0;
  for (std::uint32_t frame = 0; frame < kJitterFrames; ++frame) {
    double jitter[3];
    eyeAt(slot, distanceFor(frame % 2 == 0 ? 0.85 : 1.15), jitter);
    flips += models::selectLods(jitter, kPixelsPerUnit).changed;
  }
  check(flips == 0 && models::slotLodLevel(slot) == 0, "model lod: 200 frames jittering across the step inside the band change no level from the finer side");
  levelAt(slot, 1.5);
  for (std::uint32_t frame = 0; frame < kJitterFrames; ++frame) {
    double jitter[3];
    eyeAt(slot, distanceFor(frame % 2 == 0 ? 0.85 : 1.15), jitter);
    flips += models::selectLods(jitter, kPixelsPerUnit).changed;
  }
  check(flips == 0 && models::slotLodLevel(slot) == 1, "model lod: and none from the coarser side");
  check(models::setLodFullPixels(0.0f) == false && models::setLodFullPixels(128.0f) && levelAt(slot, 0.9) == 0 && models::setLodFullPixels(models::kLodFullPixels),
        "model lod: halving the full-detail size keeps the finer level one level longer");
  check(models::release(handle) == kOk, "model lod: the slot releases");
}

void indexBudget() {
  double handles[kSlots];
  bool loaded = true;
  for (std::uint32_t i = 0; i < kSlots; ++i) {
    handles[i] = load(true);
    loaded = loaded && handles[i] > 0.0;
  }
  check(loaded && models::liveCount() == kSlots, "model lod: eight slots load with three ranges each");
  const double eye[3] = {0.0, 0.0, 0.0};
  const std::uint64_t carves = engine::arena::carves();
  const models::LodStats& stats = models::selectLods(eye, kPixelsPerUnit);
  check(stats.cost == kSlots * kFine && stats.demand == kSlots * kFine && stats.bias == 0.0f && stats.shed == 0 && drawnIndices() == stats.cost,
        "model lod: with no budget eight near models draw their finest ranges, 12288 indices");

  models::setIndexBudget(kLooseBudget);
  models::selectLods(eye, kPixelsPerUnit);
  observe("model lod: bias under a 7000 index budget", stats.bias);
  observe("model lod: cost under a 7000 index budget", stats.cost);
  check(stats.cost == kSlots * kMiddle && stats.bias == 1.25f && stats.shed == 0 && stats.passes == 6 && drawnIndices() == stats.cost && stats.cost <= kLooseBudget,
        "model lod: a 7000 index budget raises the bias a level and the hysteresis band, 1.25, so every model draws its middle range, 6144 indices, and none is hidden");
  std::uint32_t changes = 0;
  for (std::uint32_t frame = 0; frame < kJitterFrames; ++frame) changes += models::selectLods(eye, kPixelsPerUnit).changed;
  check(changes == 0 && stats.bias == 1.25f, "model lod: the choice under the budget is stable over 200 frames");

  models::setIndexBudget(kTightBudget);
  models::selectLods(eye, kPixelsPerUnit);
  observe("model lod: models hidden under a 3000 index budget", stats.shed);
  check(stats.cost == 7 * kCoarse && stats.shed == 1 && stats.bias == models::kLodMaxBias && drawnIndices() == stats.cost && stats.cost <= kTightBudget,
        "model lod: a 3000 index budget coarsens every model and hides the one that still does not fit, 2688 indices");
  check(models::slotLodLevel(kSlots - 1) == kHidden && runIs(kSlots - 1, 0, 0) && models::slotClusterWindow(kSlots - 1) == 0,
        "model lod: the hidden model has no run and an empty cluster window");
  check(models::slotClusterWindow(0) == 1u && models::slotClusterWindow(1) == 1u, "model lod: a model at its coarsest range has the cluster window 0 to 1");

  std::uint32_t over = 0;
  std::uint32_t mismatched = 0;
  std::uint32_t worst = 0;
  models::setIndexBudget(kLooseBudget);
  for (std::uint32_t frame = 0; frame < kSweepFrames; ++frame) {
    const double t = static_cast<double>(frame) / kSweepFrames;
    const double sweep[3] = {8.0 * std::sin(t * 12.0), 0.0, -18.0 + 600.0 * (t < 0.5 ? t : 1.0 - t)};
    const models::LodStats& now = models::selectLods(sweep, kPixelsPerUnit);
    const std::uint32_t drawn = drawnIndices();
    if (drawn > kLooseBudget) over += 1;
    if (drawn != now.cost) mismatched += 1;
    if (drawn > worst) worst = drawn;
  }
  observe("model lod: most indices drawn in any frame of the sweep under a 7000 index budget", worst);
  check(over == 0 && mismatched == 0, "model lod: over a 400 frame camera sweep out to 300 m and back the drawn indices never pass the budget and equal the reported cost");

  models::setIndexBudget(kWideBudget);
  for (std::uint32_t frame = 0; frame < 16; ++frame) models::selectLods(eye, kPixelsPerUnit);
  check(stats.bias == 0.0f && stats.cost == kSlots * kFine && drawnIndices() == stats.cost, "model lod: when the budget is raised the bias relaxes step by step to zero and the finest ranges return");

  models::setIndexBudget(kTightBudget);
  models::selectLods(eye, kPixelsPerUnit);
  models::setIndexBudget(models::kNoIndexBudget);
  models::selectLods(eye, kPixelsPerUnit);
  check(stats.bias == 0.0f && stats.cost == kSlots * kFine && models::slotLodLevel(kSlots - 1) == 0, "model lod: clearing the budget returns every model, the hidden one included, to its finest range");

  models::setIndexBudget(kLooseBudget);
  check(models::release(handles[0]) == kOk, "model lod: one model unloads");
  const double late = load(true);
  const std::uint32_t lateSlot = static_cast<std::uint32_t>(models::slotOf(late));
  models::markDirty(late);
  models::selectLods(eye, kPixelsPerUnit);
  check(models::slotLodLevel(lateSlot) == models::kLodUnset && stats.slots == kSlots - 1, "model lod: a model whose upload is not complete costs nothing and is given no level");
  models::clearDirty(lateSlot);
  models::selectLods(eye, kPixelsPerUnit);
  check(stats.slots == kSlots && drawnIndices() == stats.cost && stats.cost <= kLooseBudget, "model lod: once uploaded it joins the selection under the same budget");
  models::setIndexBudget(models::kNoIndexBudget);
  check(engine::arena::carves() == carves, "model lod: selection carves nothing from the arena");

  render::Camera camera{};
  const float c = std::cos(kHalfFov);
  const float s = std::sin(kHalfFov);
  const float bottom[4] = {0.0f, c, -s, 0.0f};
  const float top[4] = {0.0f, -c, -s, 0.0f};
  std::memcpy(camera.planes[2], bottom, sizeof bottom);
  std::memcpy(camera.planes[3], top, sizeof top);
  const float expected = 0.5f * kViewportHeight / std::tan(kHalfFov);
  observe("model lod: pixels per unit at one unit of distance for a 60 degree view 720 pixels high", render::pixelsPerUnit(camera, kViewportHeight));
  check(std::fabs(render::pixelsPerUnit(camera, kViewportHeight) - expected) < 0.01f, "model lod: the frame reads the pixels per unit from the camera's top and bottom planes");
  const render::FrameOrigin origin{1000.0, 0.0, 0.0};
  camera.eye[0] = -1000.0f;
  camera.eye[2] = static_cast<float>(distanceFor(1.5) * expected / kPixelsPerUnit) - 20.0f;
  render::selectModelLods(camera, origin, kViewportHeight);
  bool middle = true;
  for (std::uint32_t slot = 2; slot < 6; ++slot) middle = middle && models::slotLodLevel(slot) == 1;
  check(middle, "model lod: the frame selection adds the frame origin to the camera eye and picks the level by projected size");
}

void modelLodChild() {
  check(models::bind(gLodStorage, sizeof gLodStorage, kLodLayout) == kOk, "model lod: the pool binds eight slots of seven clusters");
  rangesAndDefaults();
  screenSize();
  indexBudget();
}

}

void modelLod() {
  std::fflush(stdout);
  const int before = engine::test::failureCount();
  const pid_t child = fork();
  if (child == 0) {
    modelLodChild();
    std::fflush(stdout);
    _exit(engine::test::failureCount() == before ? 0 : 1);
  }
  int status = -1;
  const bool waited = child > 0 && waitpid(child, &status, 0) == child;
  check(waited && WIFEXITED(status) && WEXITSTATUS(status) == 0, "model lod: the run in its own process, with its own pool, ends with no failure");
}

}
