#include "tick_profile.h"

#include <atomic>
#include <cstdint>
#include <cstring>

#include <emscripten/emscripten.h>

namespace {

constexpr std::uint32_t kScopes = 256;
constexpr std::uint32_t kLanes = 16;
constexpr std::uint32_t kScopeFields = 4;
constexpr std::uint32_t kLaneFields = 5;
constexpr std::uint32_t kOverflowScope = kScopes - 1;
constexpr std::uint32_t kNoLane = 0xffffffffu;

struct Row {
  double ms;
  double calls;
  double longestMs;
  double longestAtMs;
};

struct Lane {
  Row rows[kScopes];
  double events;
  double lastMs;
  double widestGapMs;
  double gapAtMs;
  double gapScope;
  double gapKind;
};

struct Mark {
  double startMs;
  std::uint32_t scope;
  std::uint32_t lane;
};

static_assert(sizeof(Mark) <= 64);

std::atomic<const char*> scopeNames[kScopes];
Lane lanes[kLanes];
std::atomic<std::uint32_t> laneCount{0};
thread_local std::uint32_t laneIndex = kNoLane;
double tickStartMs = 0.0;
double captured[kScopes * kScopeFields + kLanes * kLaneFields];

std::uint32_t scopeOf(const char* name) {
  const std::uintptr_t key = reinterpret_cast<std::uintptr_t>(name);
  std::uint32_t at = static_cast<std::uint32_t>((key >> 2) * 2654435761u) % kOverflowScope;
  for (std::uint32_t probe = 0; probe < kOverflowScope; ++probe) {
    const char* held = scopeNames[at].load(std::memory_order_acquire);
    if (held == name) return at;
    if (held == nullptr) {
      const char* expected = nullptr;
      if (scopeNames[at].compare_exchange_strong(expected, name, std::memory_order_acq_rel)) return at;
      if (expected == name) return at;
    }
    at = (at + 1) % kOverflowScope;
  }
  return kOverflowScope;
}

std::uint32_t laneOf() {
  if (laneIndex == kNoLane) {
    const std::uint32_t taken = laneCount.fetch_add(1, std::memory_order_acq_rel);
    laneIndex = taken < kLanes ? taken : kLanes - 1;
  }
  return laneIndex;
}

void touch(Lane& lane, double nowMs, std::uint32_t scope, double kind) {
  const double gap = nowMs - lane.lastMs;
  if (lane.events > 0.0 && gap > lane.widestGapMs) {
    lane.widestGapMs = gap;
    lane.gapAtMs = lane.lastMs - tickStartMs;
    lane.gapScope = static_cast<double>(scope);
    lane.gapKind = kind;
  }
  lane.lastMs = nowMs;
  lane.events += 1.0;
}

}

JPH_NAMESPACE_BEGIN

ExternalProfileMeasurement::ExternalProfileMeasurement(const char* inName, uint32 inColor) {
  (void)inColor;
  Mark mark;
  mark.scope = scopeOf(inName);
  mark.lane = laneOf();
  mark.startMs = emscripten_get_now();
  touch(lanes[mark.lane], mark.startMs, mark.scope, 0.0);
  std::memcpy(mUserData, &mark, sizeof(Mark));
}

ExternalProfileMeasurement::~ExternalProfileMeasurement() {
  Mark mark;
  std::memcpy(&mark, mUserData, sizeof(Mark));
  const double endMs = emscripten_get_now();
  Lane& lane = lanes[mark.lane];
  Row& row = lane.rows[mark.scope];
  const double elapsed = endMs - mark.startMs;
  row.ms += elapsed;
  row.calls += 1.0;
  if (elapsed > row.longestMs) {
    row.longestMs = elapsed;
    row.longestAtMs = mark.startMs - tickStartMs;
  }
  touch(lane, endMs, mark.scope, 1.0);
}

JPH_NAMESPACE_END

extern "C" {

EMSCRIPTEN_KEEPALIVE int engine_profile_scope_count() {
  return static_cast<int>(kScopes);
}

EMSCRIPTEN_KEEPALIVE int engine_profile_lane_count() {
  return static_cast<int>(kLanes);
}

EMSCRIPTEN_KEEPALIVE const char* engine_profile_scope_name(int scope) {
  if (scope < 0 || scope >= static_cast<int>(kScopes)) return nullptr;
  return scopeNames[scope].load(std::memory_order_acquire);
}

EMSCRIPTEN_KEEPALIVE double* engine_profile_capture() {
  for (std::uint32_t scope = 0; scope < kScopes; ++scope) {
    double* out = captured + scope * kScopeFields;
    out[0] = 0.0;
    out[1] = 0.0;
    out[2] = 0.0;
    out[3] = 0.0;
    for (std::uint32_t l = 0; l < kLanes; ++l) {
      Row& row = lanes[l].rows[scope];
      out[0] += row.ms;
      out[1] += row.calls;
      if (row.longestMs > out[2]) {
        out[2] = row.longestMs;
        out[3] = row.longestAtMs;
      }
      row = Row{};
    }
  }
  for (std::uint32_t l = 0; l < kLanes; ++l) {
    Lane& lane = lanes[l];
    double* out = captured + kScopes * kScopeFields + l * kLaneFields;
    out[0] = lane.events;
    out[1] = lane.widestGapMs;
    out[2] = lane.gapAtMs;
    out[3] = lane.gapScope;
    out[4] = lane.gapKind;
    lane.events = 0.0;
    lane.widestGapMs = 0.0;
    lane.gapAtMs = 0.0;
    lane.gapScope = 0.0;
    lane.gapKind = 0.0;
  }
  tickStartMs = emscripten_get_now();
  return captured;
}

}
