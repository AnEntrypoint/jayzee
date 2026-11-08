#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>

#include "arena.h"
#include "bridge.h"
#include "harness.h"
#include "page_cache.h"
#include "planet_frame.h"
#include "world.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

constexpr double kPlanetRadius = 1000.0;
constexpr double kPlanetCellSize = 16.0;
constexpr double kPlanetGravity = 9.81;
constexpr double kPlanetMaxHeight = 50.0;
constexpr std::uint32_t kCapacity = 16;
constexpr std::uint32_t kTickRate = 60;
constexpr float kSphereRadius = 0.5f;
constexpr double kSettleDrop = 3.0;
constexpr double kSettleTolerance = 0.05;
constexpr std::uint32_t kSettleTicks = 600;
constexpr double kFlightAltitude = 50.0;
constexpr std::uint32_t kFlightWarmupTicks = 120;
constexpr std::uint32_t kFlightTicks = 2000;
constexpr double kP99Rank = 0.99;
constexpr int kProbeFace = 0;
constexpr int kProbeCx = 5;
constexpr int kProbeCy = 5;

Config planetConfig() {
  return Config{kCapacity, kTickRate, -9.81f, 0.0f, kSphereRadius, 0.0f, 10};
}

Status bootPlanet() {
  const Status status = world().configure(planetConfig());
  if (status != kOk) return status;
  return world().configurePlanet(kPlanetRadius, kPlanetCellSize, kPlanetGravity, kPlanetMaxHeight);
}

void refusals() {
  static planet::Planet scratch;
  check(!planet::configure(scratch, 0.0, kPlanetCellSize, kPlanetMaxHeight), "phase 5: a planet with zero radius is refused");
  check(!planet::configure(scratch, kPlanetRadius, 0.0, kPlanetMaxHeight), "phase 5: a planet with zero cell size is refused");
  check(!planet::configure(scratch, kPlanetRadius, kPlanetCellSize, -1.0), "phase 5: a planet with negative max height is refused");
  check(bootPlanet() == kOk, "phase 5: the world boots with a planet");
  check(world().configurePlanet(0.0, kPlanetCellSize, kPlanetGravity, kPlanetMaxHeight) == kRange,
        "phase 5: configurePlanet refuses a zero radius with kRange");
  check(planet::state().radius == kPlanetRadius, "phase 5: the refused configurePlanet leaves the planet unchanged");
}

void settle() {
  check(bootPlanet() == kOk, "phase 5: the settle world boots with a planet");
  const float position[3] = {0.0f, static_cast<float>(kPlanetRadius + kSettleDrop), 0.0f};
  const float velocity[3] = {0.0f, 0.0f, 0.0f};
  check(world().spawn(position, velocity) == 0, "phase 5: the settling sphere takes slot 0");
  for (std::uint32_t t = 0; t < kSettleTicks; ++t) {
    bridge::tickBatch(1);
  }
  const double* p = world().positions();
  const double distance = std::sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
  const double expected = kPlanetRadius + static_cast<double>(kSphereRadius);
  observe("phase 5: settled centre distance from the planet centre", distance);
  check(std::fabs(distance - expected) <= kSettleTolerance, "phase 5: a sphere settles at R plus its radius within 0.05 m");
}

void residency() {
  check(bootPlanet() == kOk, "phase 5: the residency world boots with a planet");
  planet::Planet& terrain = planet::state();
  std::int64_t key = 0;
  check(planet::packCellKey(kProbeFace, kProbeCx, kProbeCy, terrain.cellsPerFace, key), "phase 5: the probe cell packs to a key");
  const int slot = terrain.pages.stage(key);
  check(slot >= 0, "phase 5: a free page slot is staged");
  float* samples = terrain.pages.samples(slot);
  for (int i = 0; i < planet::kPageSamples; ++i) samples[i] = 0.0f;
  check(terrain.pages.commit(slot), "phase 5: a staged page commits");
  check(terrain.pages.residentCount() == 0, "phase 5: a committed page is not resident before the next tick");
  bridge::tickBatch(1);
  check(terrain.pages.residentCount() == 1 && terrain.pages.lookup(key) == slot,
        "phase 5: the committed page is resident after the next tick");
  check(terrain.pages.releaseKey(key), "phase 5: a resident page accepts a release");
  check(terrain.pages.residentCount() == 1, "phase 5: a released page stays counted until the next tick");
  bridge::tickBatch(1);
  check(terrain.pages.residentCount() == 0 && terrain.pages.lookup(key) < 0,
        "phase 5: the release leaves the page table at the next tick");
}

void flight() {
  check(bootPlanet() == kOk, "phase 5: the flight world boots with a planet");
  const double orbitRadius = kPlanetRadius + kFlightAltitude;
  const double orbitSpeed = std::sqrt(kPlanetGravity * kPlanetRadius * kPlanetRadius / orbitRadius);
  const float position[3] = {static_cast<float>(orbitRadius), 0.0f, 0.0f};
  const float velocity[3] = {0.0f, 0.0f, static_cast<float>(orbitSpeed)};
  check(world().spawn(position, velocity) == 0, "phase 5: the flyer takes slot 0");
  for (std::uint32_t t = 0; t < kFlightWarmupTicks; ++t) {
    bridge::tickBatch(1);
  }
  markWarmup();
  const std::size_t used0 = arena::used();
  const std::uint32_t count0 = world().count();
  const std::uint32_t bodies0 = world().physicsBodies();

  static double tickMilliseconds[kFlightTicks];
  static double sortedMilliseconds[kFlightTicks];
  for (std::uint32_t t = 0; t < kFlightTicks; ++t) {
    const auto start = std::chrono::steady_clock::now();
    bridge::tickBatch(1);
    const auto end = std::chrono::steady_clock::now();
    tickMilliseconds[t] = std::chrono::duration<double, std::milli>(end - start).count();
  }

  check(allocationsSinceWarmup() == 0, "phase 5: zero allocations over 2000 flight ticks after warm-up");
  check(world().count() == count0 && world().physicsBodies() == bodies0,
        "phase 5: the body count is unchanged over the flight");
  check(arena::used() == used0, "phase 5: the arena used bytes are unchanged over the flight");
  const double* p = world().positions();
  const double distance = std::sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
  check(distance > kPlanetRadius, "phase 5: the flyer stays above the planet surface");

  std::copy(tickMilliseconds, tickMilliseconds + kFlightTicks, sortedMilliseconds);
  std::sort(sortedMilliseconds, sortedMilliseconds + kFlightTicks);
  const std::size_t rank = static_cast<std::size_t>(std::ceil(kP99Rank * kFlightTicks)) - 1;
  observe("phase 5: flight frame-time p99 in ms (recorded, not thresholded)", sortedMilliseconds[rank]);
  observe("phase 5: flight frame-time max in ms (recorded, not thresholded)", sortedMilliseconds[kFlightTicks - 1]);
}

}

void phase5Planet() {
  refusals();
  settle();
  residency();
  flight();
}

}
