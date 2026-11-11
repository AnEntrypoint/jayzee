#include <chrono>
#include <cmath>
#include <cstdint>
#include <limits>
#include <memory>

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
constexpr std::uint32_t kTickRate = 60;
constexpr float kSphereRadius = 0.5f;
constexpr float kGravity = -9.81f;
constexpr float kYaw = 0.0f;
constexpr float kUnitScale = 1.0f;
constexpr float kOversizeScale = 2.5f;
constexpr float kSphereHeight = 2.0f;
constexpr float kRockSphereHeight = 0.6f;
constexpr float kSphereStartX = -5.0f;
constexpr float kFireSpeed = 10.0f;
constexpr std::uint32_t kFireTicks = 60;
constexpr float kTrunkStopMin = -1.0f;
constexpr float kTrunkStopMax = -0.8f;
constexpr float kRockStopMin = -1.3f;
constexpr float kRockStopMax = -1.0f;
constexpr float kPassClearance = 3.0f;
constexpr float kControlOffset = 3.0f;
constexpr float kLegacyTrunkRadius = 0.4f;
constexpr float kLegacyTrunkHalfCylinder = 2.6f;
constexpr float kLegacyTrunkCentreHeight = 3.0f;
constexpr std::uint32_t kDropSpheres = 40;
constexpr std::uint32_t kDropTicks = 180;
constexpr float kDropHeight = 20.0f;
constexpr float kDropOrigin = -100.0f;
constexpr float kDropSpacing = 5.0f;
constexpr std::uint32_t kDropColumns = 8;
constexpr double kDropTolerance = 0.05;
constexpr std::uint32_t kCostSpheres = 4;
constexpr std::uint32_t kCostTicks = 120;
constexpr std::uint32_t kCostCapacity = 8;
constexpr float kCostOrigin = -20.0f;
constexpr float kCostSpacing = 5.0f;
constexpr float kCostHeight = 20.0f;

int fieldSide() {
  return static_cast<int>(vegetation::state().cellsPerSide);
}

std::uint32_t trunkCount() {
  return vegetation::state().cellsPerSide * vegetation::state().cellsPerSide;
}

std::uint32_t cellFill() {
  return vegetation::state().instancesPerCell;
}

std::unique_ptr<World> makeWorld(float gravity, std::uint32_t capacity, Status& status) {
  std::unique_ptr<World> w = std::make_unique<World>();
  w->bind(engine::test::witnessCapacity());
  status = w->configure(Config{capacity, kTickRate, gravity, 0.0f, kSphereRadius, 0.0f, 10});
  return w;
}

void resetField() {
  vegetation::configure(vegetation::state(), kFieldOrigin, kFieldCellSize);
}

int placeInstance(float x, float y, float z, float scale, std::uint32_t cls) {
  return vegetation::place(vegetation::state(), x, y, z, kYaw, scale, cls);
}

float cellCentre(int index) {
  return kFieldOrigin + (static_cast<float>(index) + 0.5f) * kFieldCellSize;
}

std::uint32_t fillTrunkGrid() {
  resetField();
  std::uint32_t placed = 0;
  for (int iz = 0; iz < fieldSide(); ++iz) {
    for (int ix = 0; ix < fieldSide(); ++ix) {
      if (placeInstance(cellCentre(ix), 0.0f, cellCentre(iz), kUnitScale, vegetation::kClassTrunk) == kOk) placed += 1;
    }
  }
  return placed;
}

std::uint32_t addLegacyTrunks(World& w) {
  std::uint32_t added = 0;
  for (int iz = 0; iz < fieldSide(); ++iz) {
    for (int ix = 0; ix < fieldSide(); ++ix) {
      const double trunk[5] = {cellCentre(ix), kLegacyTrunkCentreHeight, cellCentre(iz), kLegacyTrunkRadius, kLegacyTrunkHalfCylinder};
      if (w.addTrunk(trunk) == kOk) added += 1;
    }
  }
  return added;
}

std::int64_t fire(World& w, float x, float y, float z, float vx) {
  const double position[3] = {x, y, z};
  const double velocity[3] = {vx, 0.0f, 0.0f};
  return w.spawn(position, velocity);
}

void placementRefusals() {
  resetField();
  std::uint32_t filled = 0;
  for (std::uint32_t i = 0; i < cellFill(); ++i) {
    if (placeInstance(kFieldOrigin + 4.0f, 0.0f, kFieldOrigin + 4.0f, kUnitScale, vegetation::kClassTrunk) == kOk) filled += 1;
  }
  check(filled == cellFill(), "phase 6: a cell takes 32 trees");
  check(placeInstance(kFieldOrigin + 4.0f, 0.0f, kFieldOrigin + 4.0f, kUnitScale, vegetation::kClassTrunk) == kFull,
        "phase 6: a full cell refuses a 33rd tree with kFull");
  const std::uint64_t placed = vegetation::state().placed;
  check(placed == cellFill(), "phase 6: the placed count is 32 after the refusal");
  check(placeInstance(kFieldOrigin - 1.0f, 0.0f, 0.0f, kUnitScale, vegetation::kClassTrunk) == kRange,
        "phase 6: a placement west of the field is refused with kRange");
  check(placeInstance(kFieldOrigin + static_cast<float>(fieldSide()) * kFieldCellSize, 0.0f, 0.0f, kUnitScale,
                      vegetation::kClassTrunk) == kRange,
        "phase 6: a placement on the far edge of the field is refused with kRange");
  check(placeInstance(0.0f, 0.0f, kFieldOrigin - 0.5f, kUnitScale, vegetation::kClassTrunk) == kRange,
        "phase 6: a placement north of the field is refused with kRange");
  check(placeInstance(0.0f, 0.0f, 0.0f, kOversizeScale, vegetation::kClassTrunk) == kRange,
        "phase 6: an oversized scale is refused with kRange");
  check(placeInstance(0.0f, 0.0f, 0.0f, 0.0f, vegetation::kClassTrunk) == kRange, "phase 6: a zero scale is refused with kRange");
  check(placeInstance(0.0f, 0.0f, 0.0f, kUnitScale, vegetation::kClassPass + 1) == kRange,
        "phase 6: an unknown collision class is refused with kRange");
  check(placeInstance(std::numeric_limits<float>::quiet_NaN(), 0.0f, 0.0f, kUnitScale, vegetation::kClassTrunk) == kRange,
        "phase 6: a NaN coordinate is refused with kRange");
  check(vegetation::state().placed == placed, "phase 6: refused placements leave the placed count unchanged");
}

void oneBodyForTrunks() {
  check(fillTrunkGrid() == trunkCount(), "phase 6: 1024 trunks fill the field, one per cell");
  check(vegetation::state().placed == trunkCount(), "phase 6: the field holds 1024 trunks");
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(0.0f, kCapacity, status);
  check(status == kOk, "phase 6: a vegetation world configures");
  const std::uint32_t before = w->physicsBodies();
  check(w->attachVegetation() == kOk, "phase 6: the field attaches to the world");
  const std::uint32_t after = w->physicsBodies();
  check(after - before == 1, "phase 6: the field adds one physics body for 1024 trunks");
  check(w->attachVegetation() == kOk && w->physicsBodies() == after, "phase 6: attaching again adds no body");
}

void legacyTrunks() {
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(0.0f, kCapacity, status);
  const std::uint32_t before = w->physicsBodies();
  const std::uint32_t added = addLegacyTrunks(*w);
  check(added == trunkCount(), "phase 6: one body per tree accepts 1024 trunks");
  check(w->physicsBodies() - before == trunkCount(), "phase 6: one body per tree adds 1024 physics bodies");
}

void trunkScenarios() {
  resetField();
  check(placeInstance(0.0f, 0.0f, 0.0f, kUnitScale, vegetation::kClassTrunk) == kOk, "phase 6: a trunk is placed at the origin");
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(0.0f, kCapacity, status);
  check(w->attachVegetation() == kOk, "phase 6: the trunk field attaches");
  check(fire(*w, kSphereStartX, kSphereHeight, 0.0f, kFireSpeed) == 0, "phase 6: the fired sphere takes slot 0");
  w->step(kFireTicks);
  const double stopX = w->positions()[0];
  observe("phase 6: fired sphere x after 1 s, trunk at x = 0", stopX);
  check(stopX >= kTrunkStopMin && stopX <= kTrunkStopMax, "phase 6: a sphere fired into a trunk stops at its surface");

  std::unique_ptr<World> control = makeWorld(0.0f, kCapacity, status);
  control->attachVegetation();
  fire(*control, kSphereStartX, kSphereHeight, kControlOffset, kFireSpeed);
  control->step(kFireTicks);
  const double passX = control->positions()[0];
  observe("phase 6: control sphere x after 1 s, 3 m off the trunk axis", passX);
  check(passX >= kPassClearance, "phase 6: a control sphere 3 m off the trunk passes it");
}

void rockAndPassThrough() {
  resetField();
  check(placeInstance(0.0f, 0.0f, 0.0f, kUnitScale, vegetation::kClassRock) == kOk, "phase 6: a rock is placed at the origin");
  Status status = kOk;
  std::unique_ptr<World> rockWorld = makeWorld(0.0f, kCapacity, status);
  rockWorld->attachVegetation();
  fire(*rockWorld, kSphereStartX, kRockSphereHeight, 0.0f, kFireSpeed);
  rockWorld->step(kFireTicks);
  const double rockX = rockWorld->positions()[0];
  observe("phase 6: sphere x after 1 s against a rock", rockX);
  check(rockX >= kRockStopMin && rockX <= kRockStopMax, "phase 6: a rock stops a sphere at its face");

  resetField();
  check(placeInstance(0.0f, 0.0f, 0.0f, kUnitScale, vegetation::kClassPass) == kOk, "phase 6: a pass-through instance is placed");
  std::unique_ptr<World> passWorld = makeWorld(0.0f, kCapacity, status);
  passWorld->attachVegetation();
  fire(*passWorld, kSphereStartX, kRockSphereHeight, 0.0f, kFireSpeed);
  passWorld->step(kFireTicks);
  const double passX = passWorld->positions()[0];
  observe("phase 6: sphere x after 1 s through a pass-through instance", passX);
  check(passX >= kPassClearance, "phase 6: a pass-through class does not stop a sphere");
}

void droppedSpheres() {
  check(fillTrunkGrid() == trunkCount(), "phase 6: the drop field is filled");
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(kGravity, kCapacity * 2, status);
  check(w->attachVegetation() == kOk, "phase 6: the drop field attaches");
  std::uint32_t handles[kDropSpheres];
  bool spawned = true;
  for (std::uint32_t i = 0; i < kDropSpheres; ++i) {
    const float x = kDropOrigin + kDropSpacing * static_cast<float>(i % kDropColumns);
    const float z = kDropOrigin + kDropSpacing * static_cast<float>(i / kDropColumns);
    const std::int64_t handle = fire(*w, x, kDropHeight, z, 0.0f);
    if (handle < 0) spawned = false;
    handles[i] = static_cast<std::uint32_t>(handle);
  }
  check(spawned, "phase 6: 40 spheres are dropped onto the field");
  w->step(kDropTicks);
  bool aboveGround = true;
  for (std::uint32_t i = 0; i < kDropSpheres; ++i) {
    const double y = w->positions()[(handles[i] & kSlotMask) * 3 + 1];
    if (!std::isfinite(y) || y < static_cast<double>(kSphereRadius) - kDropTolerance) aboveGround = false;
  }
  check(aboveGround, "phase 6: 40 dropped spheres stay above the ground");
}

void costComparison() {
  check(fillTrunkGrid() == trunkCount(), "phase 6: the cost field is filled");
  Status status = kOk;
  std::unique_ptr<World> veg = makeWorld(kGravity, kCostCapacity, status);
  veg->attachVegetation();
  for (std::uint32_t i = 0; i < kCostSpheres; ++i) {
    fire(*veg, kCostOrigin + kCostSpacing * static_cast<float>(i), kCostHeight, 0.0f, 0.0f);
  }
  const auto vegStart = std::chrono::steady_clock::now();
  veg->step(kCostTicks);
  const auto vegEnd = std::chrono::steady_clock::now();

  std::unique_ptr<World> legacy = makeWorld(kGravity, kCostCapacity, status);
  addLegacyTrunks(*legacy);
  for (std::uint32_t i = 0; i < kCostSpheres; ++i) {
    fire(*legacy, kCostOrigin + kCostSpacing * static_cast<float>(i), kCostHeight, 0.0f, 0.0f);
  }
  const auto legacyStart = std::chrono::steady_clock::now();
  legacy->step(kCostTicks);
  const auto legacyEnd = std::chrono::steady_clock::now();

  observe("phase 6 cost: one vegetation body, 120 ticks in ms (recorded, not thresholded)",
          std::chrono::duration<double, std::milli>(vegEnd - vegStart).count());
  observe("phase 6 cost: 1024 trunk bodies, 120 ticks in ms (recorded, not thresholded)",
          std::chrono::duration<double, std::milli>(legacyEnd - legacyStart).count());
}

}

void phase6Vegetation() {
  placementRefusals();
  oneBodyForTrunks();
  legacyTrunks();
  trunkScenarios();
  rockAndPassThrough();
  droppedSpheres();
  costComparison();
}

}
