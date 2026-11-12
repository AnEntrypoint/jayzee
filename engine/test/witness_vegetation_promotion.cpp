#include <cmath>
#include <cstdint>
#include <cstring>
#include <memory>

#include "arena.h"
#include "harness.h"
#include "vegetation.h"
#include "world.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

constexpr float kFieldOrigin = -128.0f;
constexpr float kFieldCellSize = 8.0f;
constexpr std::uint32_t kCapacity = 64;
constexpr std::uint32_t kTightCapacity = 4;
constexpr std::uint32_t kTickRate = 60;
constexpr float kSphereRadius = 0.5f;
constexpr float kUnitScale = 1.0f;
constexpr float kFireHeight = 2.0f;
constexpr float kHighHeight = 5.0f;
constexpr float kRockHeight = 0.6f;
constexpr float kStartX = -5.0f;
constexpr float kFireSpeed = 10.0f;
constexpr std::uint32_t kFireTicks = 60;
constexpr std::uint32_t kTrunks = 3;
constexpr float kTrunkSpacing = 16.0f;
constexpr std::uint32_t kPromotionCap = 2;
constexpr std::uint32_t kWideCap = 8;
constexpr float kStopMin = -1.0f;
constexpr float kStopMax = -0.8f;
constexpr float kPassClearance = 3.0f;
constexpr float kAnchorTolerance = 1.0e-5f;

struct Outcome {
  std::uint32_t promoted;
  std::uint32_t refusals;
  std::uint32_t live;
  std::uint32_t firstPromotionTick;
  PromotedRow rows[kMaxPromotedInstances];
  double anchors[kMaxPromotedInstances][3];
  double spheres[kTrunks][3];
  std::uint64_t carves;
};

float trunkZ(std::uint32_t index) {
  return static_cast<float>(index) * kTrunkSpacing;
}

std::uint32_t instanceOf(float x, float z) {
  const vegetation::Field& field = vegetation::state();
  const std::uint32_t ix = static_cast<std::uint32_t>(std::floor((x - kFieldOrigin) / kFieldCellSize));
  const std::uint32_t iz = static_cast<std::uint32_t>(std::floor((z - kFieldOrigin) / kFieldCellSize));
  return (iz * field.cellsPerSide + ix) * field.instancesPerCell;
}

void plantTrunks(std::uint32_t cls) {
  vegetation::configure(vegetation::state(), kFieldOrigin, kFieldCellSize);
  for (std::uint32_t i = 0; i < kTrunks; ++i) vegetation::place(vegetation::state(), 0.0f, 0.0f, trunkZ(i), 0.0f, kUnitScale, cls);
}

std::unique_ptr<World> makeWorld(std::uint32_t capacity) {
  std::unique_ptr<World> w = std::make_unique<World>();
  w->bind(engine::test::witnessCapacity());
  w->configure(Config{capacity, kTickRate, 0.0f, 0.0f, kSphereRadius, 0.0f, 10});
  w->attachVegetation();
  return w;
}

std::int64_t fire(World& w, float y, float z) {
  const double position[3] = {kStartX, y, z};
  const double velocity[3] = {kFireSpeed, 0.0, 0.0};
  return w.spawn(position, velocity);
}

double xOf(const World& w, std::int64_t handle) {
  return w.positions()[(static_cast<std::uint32_t>(handle) & kSlotMask) * 3];
}

Outcome volley(std::uint32_t capacity, std::uint32_t cap, float height) {
  Outcome out{};
  std::unique_ptr<World> w = makeWorld(capacity);
  w->setVegetationPromotion(cap);
  std::int64_t handles[kTrunks];
  for (std::uint32_t i = 0; i < kTrunks; ++i) handles[i] = fire(*w, height, trunkZ(i));
  const std::uint64_t carvesBefore = engine::arena::carves();
  for (std::uint32_t tick = 0; tick < kFireTicks; ++tick) {
    w->step(1);
    if (out.firstPromotionTick == 0 && w->promotedInstances() > 0) {
      out.firstPromotionTick = tick + 1;
      for (std::uint32_t i = 0; i < w->promotedInstances(); ++i) {
        const std::uint32_t slot = w->promotedRows()[i].handle & kSlotMask;
        for (int k = 0; k < 3; ++k) out.anchors[i][k] = w->positions()[slot * 3 + k];
      }
    }
  }
  out.carves = engine::arena::carves() - carvesBefore;
  out.promoted = w->promotedInstances();
  out.refusals = w->promotionRefusals();
  out.live = w->count();
  for (std::uint32_t i = 0; i < out.promoted; ++i) out.rows[i] = w->promotedRows()[i];
  for (std::uint32_t i = 0; i < kTrunks; ++i) {
    for (int k = 0; k < 3; ++k) out.spheres[i][k] = w->positions()[(static_cast<std::uint32_t>(handles[i]) & kSlotMask) * 3 + k];
  }
  w->restoreVegetation();
  return out;
}

void promotionOff() {
  plantTrunks(vegetation::kClassTrunk);
  std::unique_ptr<World> w = makeWorld(kCapacity);
  const std::uint32_t bodies = w->physicsBodies();
  const std::int64_t handle = fire(*w, kFireHeight, trunkZ(0));
  w->step(kFireTicks);
  check(w->promotionCap() == 0 && w->promotedInstances() == 0 && w->promotionRefusals() == 0 && w->physicsBodies() == bodies + 1,
        "promotion: off by default, a sphere that touches a trunk promotes nothing and adds no body");
  check(xOf(*w, handle) >= kStopMin && xOf(*w, handle) <= kStopMax, "promotion: with promotion off the trunk stops the sphere as before");
  check(w->setVegetationPromotion(kMaxPromotedInstances + 1) == kRange && w->setVegetationPromotion(kMaxPromotedInstances) == kOk,
        "promotion: a cap over the fixed 64 rows is refused and the full 64 is accepted");
}

void cappedVolley() {
  plantTrunks(vegetation::kClassTrunk);
  const Outcome first = volley(kCapacity, kPromotionCap, kFireHeight);
  observe("promotion: tick of the first promotion", static_cast<double>(first.firstPromotionTick));
  observe("promotion: refusals over one second at a cap of 2 with 3 touched trunks", static_cast<double>(first.refusals));
  check(first.promoted == kPromotionCap, "promotion: three touched trunks under a cap of 2 promote exactly 2 instances");
  check(first.refusals >= 1, "promotion: the touch beyond the cap is counted as a refusal");
  check(first.live == kTrunks + kPromotionCap, "promotion: each promoted instance takes one body from the pool, and the refused one takes none");
  check(first.rows[0].instance == instanceOf(0.0f, trunkZ(0)) && first.rows[1].instance == instanceOf(0.0f, trunkZ(1)),
        "promotion: the rows name the touched instances in instance order");
  bool anchored = true;
  for (std::uint32_t i = 0; i < kPromotionCap; ++i) {
    anchored = anchored && std::abs(first.anchors[i][0]) <= kAnchorTolerance && std::abs(first.anchors[i][1] - kFireHeight) <= kAnchorTolerance &&
               std::abs(first.anchors[i][2] - trunkZ(i)) <= kAnchorTolerance;
  }
  check(anchored, "promotion: the pooled body is placed on the trunk axis at the height of the touch");
  check(first.spheres[2][0] >= kStopMin && first.spheres[2][0] <= kStopMax, "promotion: the refused trunk stays static and stops its sphere");
  check(first.carves == 0, "promotion: promoting carves nothing from the arena");

  plantTrunks(vegetation::kClassTrunk);
  const Outcome second = volley(kCapacity, kPromotionCap, kFireHeight);
  check(std::memcmp(first.rows, second.rows, sizeof first.rows) == 0 && std::memcmp(first.spheres, second.spheres, sizeof first.spheres) == 0 &&
            first.refusals == second.refusals && first.firstPromotionTick == second.firstPromotionTick,
        "promotion: two runs agree bit for bit on the rows, the refusals and the sphere positions");
}

void staticShapeIgnoresPromoted() {
  plantTrunks(vegetation::kClassTrunk);
  std::unique_ptr<World> w = makeWorld(kCapacity);
  w->setVegetationPromotion(kPromotionCap);
  fire(*w, kFireHeight, trunkZ(0));
  w->step(kFireTicks);
  check(w->promotedInstances() == 1, "promotion: one touched trunk is promoted");
  const vegetation::Instance& inst = vegetation::state().instances[instanceOf(0.0f, trunkZ(0))];
  check((inst.cls & vegetation::kPromotedBit) != 0, "promotion: the promoted instance carries the promoted mark in the field");
  const std::int64_t high = fire(*w, kHighHeight, trunkZ(0));
  const std::int64_t control = fire(*w, kHighHeight, trunkZ(1));
  w->step(kFireTicks);
  observe("promotion: x of a sphere fired through the promoted trunk above the pooled body", xOf(*w, high));
  check(xOf(*w, high) >= kPassClearance, "promotion: the static shape ignores the promoted instance, so a later sphere passes where the trunk stood");
  check(w->promotedInstances() == kPromotionCap, "promotion: the control sphere touches the next trunk and promotes it");
  static_cast<void>(control);

  const std::uint32_t liveBefore = w->count();
  check(w->restoreVegetation() == kOk && w->promotedInstances() == 0 && w->count() == liveBefore - kPromotionCap,
        "promotion: restore returns the pooled bodies and empties the rows");
  check((inst.cls & vegetation::kPromotedBit) == 0 && inst.cls == vegetation::kClassTrunk, "promotion: restore clears the mark on the instance");
  const std::int64_t again = fire(*w, kHighHeight, trunkZ(0));
  w->step(kFireTicks);
  check(xOf(*w, again) >= kStopMin && xOf(*w, again) <= kStopMax, "promotion: after restore the trunk is static again and stops a sphere");
  w->restoreVegetation();
}

void poolExhaustion() {
  plantTrunks(vegetation::kClassTrunk);
  const Outcome tight = volley(kTightCapacity, kWideCap, kFireHeight);
  observe("promotion: refusals over one second with one free pool body and 3 touched trunks", static_cast<double>(tight.refusals));
  check(tight.promoted == kTightCapacity - kTrunks && tight.live == kTightCapacity && tight.refusals >= 1,
        "promotion: with one free body in the pool only one instance is promoted and the rest are refused, not allocated");
  check(tight.carves == 0, "promotion: the refusals carve nothing from the arena");
}

void rockPromotion() {
  plantTrunks(vegetation::kClassRock);
  const Outcome rock = volley(kCapacity, kWideCap, kRockHeight);
  bool centred = rock.promoted == kTrunks;
  for (std::uint32_t i = 0; i < rock.promoted; ++i) {
    centred = centred && std::abs(rock.anchors[i][0]) <= kAnchorTolerance && std::abs(rock.anchors[i][1] - kRockHeight) <= kAnchorTolerance &&
              std::abs(rock.anchors[i][2] - trunkZ(i)) <= kAnchorTolerance;
  }
  check(centred, "promotion: three touched rocks under a cap of 8 are all promoted, each body at the rock centre");
  check(rock.refusals == 0, "promotion: under the cap nothing is refused");

  plantTrunks(vegetation::kClassPass);
  const Outcome pass = volley(kCapacity, kWideCap, kRockHeight);
  check(pass.promoted == 0 && pass.refusals == 0 && pass.spheres[0][0] >= kPassClearance, "promotion: a pass-through instance is never promoted");
}

void explicitPromotion() {
  plantTrunks(vegetation::kClassTrunk);
  std::unique_ptr<World> w = makeWorld(kCapacity);
  const std::uint32_t first = instanceOf(0.0f, trunkZ(0));
  const std::uint32_t second = instanceOf(0.0f, trunkZ(1));
  const std::uint64_t carvesBefore = engine::arena::carves();
  const std::int64_t handle = w->promoteVegetation(second);
  check(w->promotionCap() == 0 && handle >= 0 && w->promotedInstances() == 1 && w->promotedRows()[0].instance == second &&
            w->promotedRows()[0].handle == static_cast<std::uint32_t>(handle) && w->count() == 1,
        "promotion: an instance promoted by index takes one pooled body and one row, with the touch policy off");
  const std::uint32_t slot = static_cast<std::uint32_t>(handle) & kSlotMask;
  check(std::abs(w->positions()[slot * 3]) <= kAnchorTolerance && std::abs(w->positions()[slot * 3 + 1] - 3.0) <= kAnchorTolerance &&
            std::abs(w->positions()[slot * 3 + 2] - trunkZ(1)) <= kAnchorTolerance,
        "promotion: a trunk promoted by index starts its body at the middle of the trunk axis");
  check(w->promoteVegetation(second) == kBadId && w->promoteVegetation(first + 1) == kBadId && w->promotedInstances() == 1,
        "promotion: promoting an instance twice, or an index that holds no instance, is refused and takes no body");
  const vegetation::Instance* row = vegetation::instanceRow(vegetation::state(), second);
  check(row != nullptr && (row->cls & vegetation::kPromotedBit) != 0 && vegetation::instanceRow(vegetation::state(), first + 1) == nullptr,
        "promotion: the instance row is readable by index and carries the mark");
  const std::int64_t through = fire(*w, kHighHeight, trunkZ(1));
  const std::int64_t stopped = fire(*w, kHighHeight, trunkZ(0));
  w->step(kFireTicks);
  check(xOf(*w, through) >= kPassClearance && xOf(*w, stopped) >= kStopMin && xOf(*w, stopped) <= kStopMax,
        "promotion: the instance promoted by index no longer stops a sphere, and its unpromoted neighbour still does");
  check(engine::arena::carves() == carvesBefore, "promotion: promoting by index carves nothing from the arena");
  w->restoreVegetation();
  check(w->promotedInstances() == 0 && (row->cls & vegetation::kPromotedBit) == 0, "promotion: restore clears an instance promoted by index");
  bool filled = true;
  for (std::uint32_t i = 0; i < kTrunks; ++i) filled = filled && w->promoteVegetation(instanceOf(0.0f, trunkZ(i))) >= 0;
  check(filled && w->promotedInstances() == kTrunks, "promotion: three instances promoted by index hold three rows in call order");
  w->restoreVegetation();
}

}

void vegetationPromotion() {
  promotionOff();
  cappedVolley();
  staticShapeIgnoresPromoted();
  poolExhaustion();
  rockPromotion();
  explicitPromotion();
  vegetation::configure(vegetation::state(), kFieldOrigin, kFieldCellSize);
}

}
