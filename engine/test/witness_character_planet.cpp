#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>

#include "arena.h"
#include "bridge.h"
#include "harness.h"
#include "page_cache.h"
#include "physics_origin.h"
#include "planet_frame.h"
#include "pool_alloc.h"
#include "world.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

constexpr double kRadius = 1024.0;
constexpr double kCellSize = 16.0;
constexpr double kGravity = 9.8;
constexpr double kMaxHeight = 50.0;
constexpr double kQuarterTurn = 3.14159265358979323846 / 4.0;
constexpr double kCellMetres = kCellSize * kQuarterTurn;
constexpr int kPoleFace = 2;
constexpr int kPoleCell = 64;
constexpr int kPageCells = 2;
constexpr int kPageSteps = planet::kPageSide - 1;
constexpr std::uint32_t kCapacity = 16;
constexpr std::uint32_t kTickRate = 60;
constexpr double kCapsuleRadius = 0.4;
constexpr double kCapsuleHalfHeight = 0.6;
constexpr double kRest = kCapsuleRadius + kCapsuleHalfHeight;
constexpr double kSpawnGap = 0.05;
constexpr double kWalkSpeed = 2.0;
constexpr std::uint32_t kSettleTicks = 60;
constexpr std::uint32_t kWalkTicks = 960;
constexpr std::uint32_t kStoppedTicks = 120;
constexpr double kRampStart = 4.0;
constexpr double kRampTop = 12.0;
constexpr double kPlateauEnd = 16.0;
constexpr double kDescentEnd = 24.0;
constexpr double kGentleGradient = 0.5;
constexpr double kSteepGradient = 2.0;
constexpr double kHill = kGentleGradient * (kRampTop - kRampStart);
constexpr double kStandAt = 8.0;
constexpr int kGentleLane = 0;
constexpr int kSteepLane = 1;
constexpr int kStandLane = -1;
constexpr double kHillTolerance = 0.15;
constexpr double kFootSlack = 0.5;
constexpr double kStoppedMetres = 0.01;
constexpr double kStandDriftMetres = 0.02;
constexpr std::uint32_t kWalkers = 3;
constexpr std::uint32_t kGentle = 0;
constexpr std::uint32_t kSteep = 1;
constexpr std::uint32_t kStander = 2;

struct Track {
  double farthest;
  double highest;
  double lastAlong;
  double alongBeforeStop;
  double standStart[3];
  double standEnd[3];
  std::uint32_t unsupported;
  bool settledSupported;
  float finalBody[3];
};

struct Run {
  Track tracks[kWalkers];
  std::uint64_t allocations;
  std::uint64_t failures;
  int resident;
  double rampHeight;
  double steepDegrees;
  bool booted;
};

double profile(double along, int lane) {
  const double gradient = lane == kSteepLane ? kSteepGradient : kGentleGradient;
  if (along <= kRampStart) return 0.0;
  if (along <= kRampTop) return gradient * (along - kRampStart);
  if (lane == kSteepLane) return gradient * (kRampTop - kRampStart);
  if (along <= kPlateauEnd) return kHill;
  if (along <= kDescentEnd) return kHill - kGentleGradient * (along - kPlateauEnd);
  return 0.0;
}

void pointAt(double alongU, double alongV, double altitude, double* out) {
  const double x = std::tan(alongU / kRadius);
  const double z = -std::tan(alongV / kRadius);
  const double length = std::sqrt(x * x + 1.0 + z * z);
  const double reach = kRadius + altitude;
  out[0] = x / length * reach;
  out[1] = 1.0 / length * reach;
  out[2] = z / length * reach;
}

double laneV(int lane) {
  return (static_cast<double>(lane) + 0.5) * kCellMetres;
}

bool writePages() {
  planet::Planet& terrain = planet::state();
  for (int cy = -kPageCells; cy < kPageCells; ++cy) {
    for (int cx = -kPageCells; cx < kPageCells; ++cx) {
      std::int64_t key = 0;
      if (!planet::packCellKey(kPoleFace, kPoleCell + cx, kPoleCell + cy, terrain.cellsPerFace, key)) return false;
      const int slot = terrain.pages.stage(key);
      if (slot < 0) return false;
      float* samples = terrain.pages.samples(slot);
      for (int j = 0; j < planet::kPageSide; ++j) {
        for (int i = 0; i < planet::kPageSide; ++i) {
          const double along = (static_cast<double>(cx) + static_cast<double>(i) / kPageSteps) * kCellMetres;
          samples[j * planet::kPageSide + i] = static_cast<float>(profile(along, cy));
        }
      }
      if (!terrain.pages.commit(slot)) return false;
    }
  }
  terrain.pages.applyPending();
  return true;
}

void readWorld(std::uint32_t index, double* out) {
  float body[3];
  world().characterBodyPosition(index, body);
  const PhysicsOrigin& o = physicsOrigin();
  out[0] = static_cast<double>(body[0]) + o.x;
  out[1] = static_cast<double>(body[1]) + o.y;
  out[2] = static_cast<double>(body[2]) + o.z;
}

double alongOf(const double* p) {
  return kRadius * std::atan(p[0] / p[1]);
}

double altitudeOf(const double* p) {
  return std::sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) - kRadius;
}

Run walk() {
  Run run{};
  World& w = world();
  run.booted = w.configure(Config{kCapacity, kTickRate, -9.8f, 0.0f, 0.5f, 0.0f, 10}) == kOk &&
               w.configurePlanet(kRadius, kCellSize, kGravity, kMaxHeight) == kOk && writePages();
  if (!run.booted) return run;
  const planet::Cell pole = planet::worldToCell(0.25 * kCellMetres, kRadius, -0.25 * kCellMetres, kRadius, kCellSize);
  run.booted = pole.face == kPoleFace && pole.cx == kPoleCell && pole.cy == kPoleCell;
  w.follow(0.0, kRadius, 0.0);
  run.resident = planet::state().pages.residentCount();
  double probe[3];
  pointAt(kStandAt, laneV(kGentleLane), 0.0, probe);
  run.rampHeight = planet::heightAt(planet::state(), probe[0], probe[1], probe[2]);
  pointAt(kStandAt, laneV(kSteepLane), 0.0, probe);
  planet::PageCursor cursor;
  const planet::SurfaceSample steep = planet::sampleSurface(planet::state(), probe[0], probe[1], probe[2], cursor);
  const double probeLength = std::sqrt(probe[0] * probe[0] + probe[1] * probe[1] + probe[2] * probe[2]);
  const double cosine = (steep.normal[0] * probe[0] + steep.normal[1] * probe[1] + steep.normal[2] * probe[2]) / probeLength;
  run.steepDegrees = std::acos(std::clamp(cosine, -1.0, 1.0)) * 45.0 / kQuarterTurn;

  const int lanes[kWalkers] = {kGentleLane, kSteepLane, kStandLane};
  const double starts[kWalkers] = {0.0, 0.0, kStandAt};
  int indices[kWalkers];
  for (std::uint32_t i = 0; i < kWalkers; ++i) {
    double at[3];
    const int profileLane = lanes[i] == kStandLane ? kGentleLane : lanes[i];
    pointAt(starts[i], laneV(lanes[i]), profile(starts[i], profileLane) + kRest + kSpawnGap, at);
    const double spec[5] = {at[0], at[1], at[2], kCapsuleRadius, kCapsuleHalfHeight};
    indices[i] = w.addCharacter(spec);
    run.booted = run.booted && indices[i] == static_cast<int>(i);
    run.tracks[i].farthest = -1.0e9;
    run.tracks[i].highest = -1.0e9;
  }
  if (!run.booted) return run;

  for (std::uint32_t t = 0; t < kSettleTicks; ++t) bridge::tickBatch(1);
  for (std::uint32_t i = 0; i < kWalkers; ++i) run.tracks[i].settledSupported = w.characterSupported(i);
  readWorld(kStander, run.tracks[kStander].standStart);
  markWarmup();
  const std::uint64_t failuresBefore = pool::failures();

  for (std::uint32_t t = 0; t < kWalkTicks; ++t) {
    for (std::uint32_t i = 0; i < kWalkers; ++i) {
      if (i == kStander) continue;
      double p[3];
      readWorld(i, p);
      const double distance = std::sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
      const double up[3] = {p[0] / distance, p[1] / distance, p[2] / distance};
      const double east[3] = {1.0 - up[0] * up[0], -up[0] * up[1], -up[0] * up[2]};
      const double length = std::sqrt(east[0] * east[0] + east[1] * east[1] + east[2] * east[2]);
      const float velocity[3] = {static_cast<float>(east[0] / length * kWalkSpeed), static_cast<float>(east[1] / length * kWalkSpeed),
                                 static_cast<float>(east[2] / length * kWalkSpeed)};
      w.setCharacterVelocity(i, velocity);
    }
    bridge::tickBatch(1);
    for (std::uint32_t i = 0; i < kWalkers; ++i) {
      double p[3];
      readWorld(i, p);
      Track& track = run.tracks[i];
      track.lastAlong = alongOf(p);
      track.farthest = std::max(track.farthest, track.lastAlong);
      track.highest = std::max(track.highest, altitudeOf(p));
      if (!w.characterSupported(i)) track.unsupported += 1;
      if (t + kStoppedTicks + 1 == kWalkTicks) track.alongBeforeStop = track.lastAlong;
    }
  }
  readWorld(kStander, run.tracks[kStander].standEnd);
  run.allocations = allocationsSinceWarmup();
  run.failures = pool::failures() - failuresBefore;
  for (std::uint32_t i = 0; i < kWalkers; ++i) w.characterBodyPosition(i, run.tracks[i].finalBody);
  return run;
}

}

void characterPlanet() {
  const Run first = walk();
  const Run second = walk();
  check(first.booted && second.booted, "character: the planet, the pole pages and three capsules are accepted");
  check(first.resident == 4 * kPageCells * kPageCells && std::abs(first.rampHeight - kGentleGradient * (kStandAt - kRampStart)) <= 0.05,
        "character: the pages are resident and the planet height on the ramp is the written ramp");
  observe("character: steep slope angle in degrees", first.steepDegrees);
  check(first.steepDegrees > 60.0, "character: the steep lane is a slope over 60 degrees");

  const Track& gentle = first.tracks[kGentle];
  const Track& steep = first.tracks[kSteep];
  const Track& stander = first.tracks[kStander];
  check(gentle.settledSupported && steep.settledSupported && stander.settledSupported,
        "character: after 60 ticks every capsule stands supported on the planet shape under radial gravity");
  const double drift = std::sqrt((stander.standEnd[0] - stander.standStart[0]) * (stander.standEnd[0] - stander.standStart[0]) +
                                 (stander.standEnd[1] - stander.standStart[1]) * (stander.standEnd[1] - stander.standStart[1]) +
                                 (stander.standEnd[2] - stander.standStart[2]) * (stander.standEnd[2] - stander.standStart[2]));
  observe("character: drift of the capsule standing on the 26.6 degree slope over 16 s in metres", drift);
  check(drift <= kStandDriftMetres && stander.unsupported == 0, "character: a capsule standing on the 26.6 degree slope stays supported and does not slide");

  observe("character: gentle walker farthest distance in metres", gentle.farthest);
  observe("character: gentle walker highest centre altitude in metres", gentle.highest);
  check(gentle.farthest >= kDescentEnd + 2.0 && std::abs(gentle.highest - (kHill + kRest)) <= kHillTolerance,
        "character: the capsule walks up the 26.6 degree slope, over the 4 m hill and down the far side");
  check(gentle.unsupported == 0, "character: the walking capsule is supported at every tick, the descent included");

  observe("character: steep walker farthest distance in metres", steep.farthest);
  observe("character: steep walker highest centre altitude in metres", steep.highest);
  check(steep.farthest >= kRampStart - kCapsuleRadius - 0.1 && steep.farthest <= kRampStart + kFootSlack && steep.highest <= kRest + kFootSlack,
        "character: the slope over 60 degrees stops the capsule at its foot");
  check(std::abs(steep.lastAlong - steep.alongBeforeStop) <= kStoppedMetres, "character: over the last 120 ticks the capsule at the steep foot does not move");

  check(first.allocations == 0 && first.failures == 0, "character: 960 walking ticks carve nothing from the arena after warm-up and no pool allocation fails");
  bool same = true;
  for (std::uint32_t i = 0; i < kWalkers; ++i) same = same && std::memcmp(first.tracks[i].finalBody, second.tracks[i].finalBody, sizeof first.tracks[i].finalBody) == 0;
  check(same, "character: two runs agree bit for bit on the final position of every capsule");
  planet::state().pages.clear();
}

}
