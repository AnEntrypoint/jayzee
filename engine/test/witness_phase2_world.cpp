#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>

#include "harness.h"
#include "world.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;
using engine::test::observeHex;
using engine::test::observeText;

constexpr std::uint32_t kCapacity = 64;
constexpr std::uint32_t kGridBodies = 32;
constexpr std::uint32_t kGridColumns = 8;
constexpr std::uint32_t kTickRate = 60;
constexpr std::uint32_t kIterations = 10;
constexpr float kGravity = -9.81f;
constexpr float kRadius = 0.5f;
constexpr float kNoDrag = 0.0f;
constexpr float kNoRestitution = 0.0f;
constexpr float kDropHeight = 5.0f;
constexpr std::uint32_t kSettleTicks = 600;
constexpr double kRestTolerance = 0.05;
constexpr double kJsRestTolerance = 1e-9;
constexpr float kBoxTop = 1.0f;
constexpr float kBoxDropHeight = 4.0f;
constexpr std::uint32_t kDeterminismTicks = 300;
constexpr std::uint32_t kRoundTripTicks = 120;
constexpr float kProbeSpeed = 10.0f;
constexpr float kProbeHeight = 2.0f;
constexpr std::uint32_t kProbeTicks = 60;
constexpr float kDragHalf = 0.5f;
constexpr float kDragUnit = 1.0f;
constexpr float kBounceDrop = 3.0f;
constexpr float kBounceRestitution = 0.5f;
constexpr std::uint32_t kBounceTicks = 240;
constexpr std::uint32_t kBounceWindow = 60;
constexpr double kContactBand = 0.01;
constexpr std::uint64_t kFnvOffset = 0xcbf29ce484222325ull;
constexpr std::uint64_t kFnvPrime = 0x100000001b3ull;

std::unique_ptr<World> makeWorld(float gravity, float drag, float restitution, std::uint32_t capacity, Status& status) {
  std::unique_ptr<World> w = std::make_unique<World>();
  w->bind(engine::test::witnessCapacity());
  status = w->configure(Config{capacity, kTickRate, gravity, drag, kRadius, restitution, kIterations});
  return w;
}

int spawnGrid(World& w, std::uint32_t* handles) {
  double rows[kGridBodies * kBatchWords];
  for (std::uint32_t i = 0; i < kGridBodies; ++i) {
    double* row = rows + i * kBatchWords;
    row[0] = static_cast<float>(i % kGridColumns) * 1.5f;
    row[1] = 2.0f + static_cast<float>(i / kGridColumns) * 1.5f;
    row[2] = 0.0f;
    row[3] = 0.1f * static_cast<float>(i);
    row[4] = 0.0f;
    row[5] = -0.05f * static_cast<float>(i);
  }
  return w.spawnBatch(rows, kGridBodies, handles);
}

std::uint64_t hashTransforms(const World& w, std::uint32_t count) {
  const unsigned char* bytes = reinterpret_cast<const unsigned char*>(w.transforms());
  std::uint64_t hash = kFnvOffset;
  const std::size_t total = static_cast<std::size_t>(count) * sizeof(Transform);
  for (std::size_t i = 0; i < total; ++i) {
    hash ^= bytes[i];
    hash *= kFnvPrime;
  }
  return hash;
}

void configureRefusals() {
  std::unique_ptr<World> w = std::make_unique<World>();
  check(w->bind(engine::test::witnessCapacity()) == kOk, "phase 2: a world binds its arrays from the arena");
  check(w->configure(Config{0, kTickRate, kGravity, kNoDrag, kRadius, kNoRestitution, kIterations}) == kRange,
        "phase 2: a world with zero capacity is refused with kRange");
  check(w->configure(Config{kCapacity, kTickRate, kGravity, kNoDrag, kRadius, kNoRestitution, 0}) == kRange,
        "phase 2: a world with zero iterations is refused with kRange");
  check(w->configure(Config{kCapacity, kTickRate, kGravity, kNoDrag, 0.0f, kNoRestitution, kIterations}) == kRange,
        "phase 2: a world with zero radius is refused with kRange");
}

double groundRest() {
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(kGravity, kNoDrag, kNoRestitution, kCapacity, status);
  check(status == kOk, "phase 2: a 64-body world configures");
  const double position[3] = {0.0f, kDropHeight, 0.0f};
  const double velocity[3] = {0.0f, 0.0f, 0.0f};
  const std::int64_t handle = w->spawn(position, velocity);
  check(handle == 0, "phase 2: the first spawn returns handle 0");
  w->step(kSettleTicks);
  const double y = w->positions()[1];
  const double error = std::fabs(y - static_cast<double>(kRadius));
  observe("phase 2: ground rest y after 600 ticks", y);
  check(error <= kRestTolerance, "phase 2: a sphere rests at its radius on the ground within 0.05 m");
  return error;
}

void boxRest() {
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(kGravity, kNoDrag, kNoRestitution, kCapacity, status);
  const double box[6] = {-1.0f, 0.5f, -1.0f, 1.0f, 1.0f, 1.0f};
  check(w->addBox(box) == kOk, "phase 2: a static box is accepted");
  const double position[3] = {0.0f, kBoxDropHeight, 0.0f};
  const double velocity[3] = {0.0f, 0.0f, 0.0f};
  w->spawn(position, velocity);
  w->step(kSettleTicks);
  const double y = w->positions()[1];
  const double expected = static_cast<double>(kBoxTop) + static_cast<double>(kRadius);
  observe("phase 2: box rest y after 600 ticks", y);
  check(std::fabs(y - expected) <= kRestTolerance, "phase 2: a sphere rests on a static box top within 0.05 m");
}

void determinism() {
  Status statusA = kOk;
  std::unique_ptr<World> a = makeWorld(kGravity, kNoDrag, kNoRestitution, kCapacity, statusA);
  std::uint32_t handlesA[kGridBodies];
  check(spawnGrid(*a, handlesA) == static_cast<int>(kGridBodies), "phase 2: run A spawns the grid");
  a->step(kDeterminismTicks);

  Status statusB = kOk;
  std::unique_ptr<World> b = makeWorld(kGravity, kNoDrag, kNoRestitution, kCapacity, statusB);
  std::uint32_t handlesB[kGridBodies];
  check(spawnGrid(*b, handlesB) == static_cast<int>(kGridBodies), "phase 2: run B spawns the grid");
  b->step(kDeterminismTicks);

  const std::uint64_t hashA = hashTransforms(*a, kGridBodies);
  const std::uint64_t hashB = hashTransforms(*b, kGridBodies);
  observeHex("phase 2: transform hash run A", hashA);
  observeHex("phase 2: transform hash run B", hashB);
  check(hashA == hashB, "phase 2: two runs with the same inputs give identical transform bytes");
  check(std::memcmp(a->positions(), b->positions(), kGridBodies * 3 * sizeof(double)) == 0,
        "phase 2: two runs with the same inputs give identical positions bit for bit");
}

void stateRoundTrip() {
  Status status = kOk;
  std::unique_ptr<World> a = makeWorld(kGravity, kNoDrag, kNoRestitution, kCapacity, status);
  std::uint32_t handles[kGridBodies];
  spawnGrid(*a, handles);
  a->step(kRoundTripTicks);

  double positions[kGridBodies * 3];
  double velocities[kGridBodies * 3];
  std::memcpy(positions, a->positions(), sizeof positions);
  std::memcpy(velocities, a->velocities(), sizeof velocities);

  std::unique_ptr<World> b = makeWorld(kGravity, kNoDrag, kNoRestitution, kCapacity, status);
  const double zero[3] = {0.0f, 0.0f, 0.0f};
  std::uint32_t importHandles[kGridBodies];
  bool spawned = true;
  for (std::uint32_t i = 0; i < kGridBodies; ++i) {
    const std::int64_t handle = b->spawn(zero, zero);
    if (handle < 0) spawned = false;
    importHandles[i] = static_cast<std::uint32_t>(handle);
  }
  check(spawned, "phase 2: the import world spawns every body");
  for (std::uint32_t i = 0; i < kGridBodies; ++i) {
    const double position[3] = {static_cast<float>(positions[i * 3]), static_cast<float>(positions[i * 3 + 1]),
                               static_cast<float>(positions[i * 3 + 2])};
    const float velocity[3] = {static_cast<float>(velocities[i * 3]), static_cast<float>(velocities[i * 3 + 1]),
                              static_cast<float>(velocities[i * 3 + 2])};
    b->setPosition(importHandles[i], position);
    b->setVelocity(importHandles[i], velocity);
  }
  b->setTick(a->tick());
  check(std::memcmp(b->positions(), positions, sizeof positions) == 0,
        "phase 2: exported positions import and read back bit for bit");
  check(std::memcmp(b->velocities(), velocities, sizeof velocities) == 0,
        "phase 2: exported velocities import and read back bit for bit");
  check(b->tick() == a->tick(), "phase 2: the imported tick equals the exported tick");
}

void sleepObservation() {
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(kGravity, kNoDrag, kNoRestitution, kCapacity, status);
  const double position[3] = {0.0f, kDropHeight, 0.0f};
  const double velocity[3] = {0.0f, 0.0f, 0.0f};
  w->spawn(position, velocity);
  w->step(kSettleTicks);
  const double* v = w->velocities();
  observe("phase 2 mismatch sleep: speed of a resting body after 600 ticks", std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]));
  observeText("phase 2 mismatch sleep", "World exposes no activity state, and mAllowSleeping is false, so the engine never sleeps");
}

double horizontalSpeedRatio(float drag) {
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(0.0f, drag, kNoRestitution, kCapacity, status);
  const double position[3] = {0.0f, kProbeHeight, 0.0f};
  const double velocity[3] = {kProbeSpeed, 0.0f, 0.0f};
  w->spawn(position, velocity);
  w->step(kProbeTicks);
  return w->velocities()[0] / static_cast<double>(kProbeSpeed);
}

void dragObservation() {
  observe("phase 2 mismatch drag 0.0: x speed ratio after 1 s", horizontalSpeedRatio(0.0f));
  observe("phase 2 mismatch drag 0.5: x speed ratio after 1 s", horizontalSpeedRatio(kDragHalf));
  Status status = kOk;
  makeWorld(0.0f, kDragUnit, kNoRestitution, kCapacity, status);
  observe("phase 2 mismatch drag 1.0: configure status (kOk is 0)", static_cast<double>(status));
}

void restitutionObservation() {
  Status status = kOk;
  std::unique_ptr<World> w = makeWorld(kGravity, kNoDrag, kBounceRestitution, kCapacity, status);
  const double position[3] = {0.0f, kBounceDrop, 0.0f};
  const double velocity[3] = {0.0f, 0.0f, 0.0f};
  w->spawn(position, velocity);
  double trace[kBounceTicks];
  for (std::uint32_t t = 0; t < kBounceTicks; ++t) {
    w->step(1);
    trace[t] = w->positions()[1];
  }
  std::uint32_t contact = kBounceTicks;
  for (std::uint32_t t = 0; t < kBounceTicks && contact == kBounceTicks; ++t) {
    if (trace[t] <= static_cast<double>(kRadius) + kContactBand) contact = t;
  }
  double apex = static_cast<double>(kRadius);
  if (contact < kBounceTicks) {
    const std::uint32_t end = std::min(kBounceTicks, contact + kBounceWindow);
    for (std::uint32_t t = contact; t < end; ++t) {
      if (trace[t] > apex) apex = trace[t];
    }
  }
  const double ratio = (apex - static_cast<double>(kRadius)) / (static_cast<double>(kBounceDrop) - static_cast<double>(kRadius));
  observe("phase 2 mismatch restitution 0.5: rebound height over drop height", ratio);
  observe("phase 2 mismatch restitution 0.5: restitution squared, the ratio a Jolt bounce gives", kBounceRestitution * kBounceRestitution);
}

void float32Observation(double restError) {
  observe("phase 2 mismatch float32: observed rest error in metres", restError);
  observe("phase 2 mismatch float32: worldSuite rest tolerance", kJsRestTolerance);
  observeText("phase 2 mismatch float32: rest error within the JS tolerance", restError <= kJsRestTolerance ? "yes" : "no");
}

}

void phase2World() {
  configureRefusals();
  const double restError = groundRest();
  boxRest();
  determinism();
  stateRoundTrip();
  sleepObservation();
  dragObservation();
  restitutionObservation();
  float32Observation(restError);
}

}
