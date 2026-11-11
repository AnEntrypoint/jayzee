#include <cstdint>
#include <cstring>

#include "harness.h"
#include "render/vegetation_draw.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;
namespace veg = engine::render::vegetation;

constexpr std::uint32_t kSpecies = 3;
constexpr std::uint32_t kSide = 8;
constexpr std::uint32_t kSlots = kSide * kSide;
constexpr std::uint32_t kCapacity = 16;
constexpr std::uint32_t kPairs = kSpecies * kSlots;
constexpr std::uint32_t kGuard = 4;
constexpr double kSpacing = 10.0;
constexpr float kRadius = 6.0f;
constexpr float kCut = 36.0f;
constexpr std::uint32_t kSentinel = 0xa5a5a5a5u;

float gBlock[kPairs * kCapacity * veg::kMatrixFloats];
std::uint32_t gCounts[kPairs];
std::uint8_t gDirty[kSlots];
double gOrigins[kSlots * 3];
veg::Draw gDraws[kPairs + kGuard];
veg::Draw gAgain[kPairs + kGuard];
veg::Upload gUploads[kPairs + kGuard];
std::uint32_t gSeenDraw[kPairs];
std::uint32_t gSeenUpload[kPairs];
std::uint32_t gFrameOf[kPairs];

struct Lcg {
  std::uint32_t state;
  std::uint32_t next() {
    state = state * 1664525u + 1013904223u;
    return state >> 8;
  }
};

veg::Bound field() {
  veg::Bound b{};
  b.block = gBlock;
  b.counts = gCounts;
  b.dirty = gDirty;
  b.origins = gOrigins;
  b.radius = kRadius;
  b.species = kSpecies;
  b.slots = kSlots;
  b.capacity = kCapacity;
  return b;
}

void fillOrigins() {
  for (std::uint32_t slot = 0; slot < kSlots; ++slot) {
    gOrigins[slot * 3] = static_cast<double>(slot % kSide) * kSpacing;
    gOrigins[slot * 3 + 1] = 0.0;
    gOrigins[slot * 3 + 2] = static_cast<double>(slot / kSide) * kSpacing;
  }
}

void fillCounts(std::uint32_t seed) {
  Lcg rng{seed};
  for (std::uint32_t i = 0; i < kPairs; ++i) {
    const std::uint32_t roll = rng.next() % (kCapacity + 4);
    gCounts[i] = roll > kCapacity ? 0 : roll;
  }
}

void setDirty(std::uint8_t value) {
  for (std::uint32_t slot = 0; slot < kSlots; ++slot) gDirty[slot] = value;
}

std::uint32_t dirtySlots() {
  std::uint32_t n = 0;
  for (std::uint32_t slot = 0; slot < kSlots; ++slot) n += gDirty[slot] != 0 ? 1 : 0;
  return n;
}

std::uint32_t residentDirty() {
  std::uint32_t n = 0;
  for (std::uint32_t slot = 0; slot < kSlots; ++slot) {
    bool resident = false;
    for (std::uint32_t s = 0; s < kSpecies; ++s) resident = resident || gCounts[s * kSlots + slot] != 0;
    n += resident && gDirty[slot] != 0 ? 1 : 0;
  }
  return n;
}

std::uint32_t residentPairs() {
  std::uint32_t n = 0;
  for (std::uint32_t i = 0; i < kPairs; ++i) n += gCounts[i] != 0 ? 1 : 0;
  return n;
}

std::uint64_t slotBytes(std::uint32_t slot) {
  std::uint64_t bytes = 0;
  for (std::uint32_t s = 0; s < kSpecies; ++s) bytes += static_cast<std::uint64_t>(gCounts[s * kSlots + slot]) * veg::kMatrixBytes;
  return bytes;
}

void allPass(float planes[24]) {
  for (std::uint32_t p = 0; p < 6; ++p) {
    planes[p * 4] = 0.0f;
    planes[p * 4 + 1] = 0.0f;
    planes[p * 4 + 2] = 0.0f;
    planes[p * 4 + 3] = 1.0f;
  }
}

bool sphereTouches(const float planes[24], std::uint32_t slot, const double frameOrigin[3]) {
  for (std::uint32_t p = 0; p < 6; ++p) {
    double d = static_cast<double>(planes[p * 4 + 3]);
    for (std::uint32_t k = 0; k < 3; ++k) d += static_cast<double>(planes[p * 4 + k]) * (gOrigins[slot * 3 + k] - frameOrigin[k]);
    if (d < -static_cast<double>(kRadius)) return false;
  }
  return true;
}

void fillSentinels() {
  for (std::uint32_t i = 0; i < kPairs + kGuard; ++i) {
    gDraws[i] = veg::Draw{kSentinel, kSentinel, kSentinel, kSentinel};
    gUploads[i] = veg::Upload{kSentinel, kSentinel, kSentinel, kSentinel};
  }
}

bool sameDraw(const veg::Draw& a, const veg::Draw& b) {
  return a.species == b.species && a.slot == b.slot && a.count == b.count && a.byteOffset == b.byteOffset;
}

struct Coverage {
  std::uint32_t wrongField;
  std::uint32_t repeated;
  std::uint32_t missing;
  std::uint32_t unexpected;
};

Coverage drawCoverage(std::uint32_t n, const float* planes, const double frameOrigin[3]) {
  Coverage c{0, 0, 0, 0};
  for (std::uint32_t i = 0; i < kPairs; ++i) gSeenDraw[i] = 0;
  for (std::uint32_t i = 0; i < n; ++i) {
    const veg::Draw& d = gDraws[i];
    if (d.species >= kSpecies || d.slot >= kSlots) {
      c.wrongField += 1;
      continue;
    }
    const std::uint32_t index = d.species * kSlots + d.slot;
    gSeenDraw[index] += 1;
    if (d.count != gCounts[index] || d.byteOffset != static_cast<std::uint64_t>(index) * kCapacity * veg::kMatrixBytes) c.wrongField += 1;
  }
  for (std::uint32_t slot = 0; slot < kSlots; ++slot) {
    const bool visible = planes == nullptr || sphereTouches(planes, slot, frameOrigin);
    for (std::uint32_t s = 0; s < kSpecies; ++s) {
      const std::uint32_t index = s * kSlots + slot;
      const bool expected = visible && gCounts[index] != 0;
      if (gSeenDraw[index] > 1) c.repeated += 1;
      if (expected && gSeenDraw[index] == 0) c.missing += 1;
      if (!expected && gSeenDraw[index] != 0) c.unexpected += 1;
    }
  }
  return c;
}

bool clean(const Coverage& c) {
  return c.wrongField == 0 && c.repeated == 0 && c.missing == 0 && c.unexpected == 0;
}

struct Drain {
  std::uint32_t frames;
  std::uint32_t uploads;
  std::uint32_t overBudget;
  std::uint32_t wrongField;
  std::uint32_t repeated;
  std::uint32_t missing;
  std::uint32_t splitSlots;
  std::uint32_t staleFlags;
  std::uint64_t largestFrame;
  std::uint64_t bytes;
};

Drain drain(veg::Bound& b, std::uint64_t budget, std::uint32_t maxOut, std::uint32_t frameLimit) {
  Drain r{0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
  for (std::uint32_t i = 0; i < kPairs; ++i) {
    gSeenUpload[i] = 0;
    gFrameOf[i] = 0;
  }
  while (r.frames < frameLimit) {
    fillSentinels();
    const std::uint32_t n = veg::planUploads(b, gUploads, maxOut, budget);
    if (n == 0) break;
    r.frames += 1;
    std::uint64_t frameBytes = 0;
    for (std::uint32_t i = 0; i < n; ++i) {
      const veg::Upload& u = gUploads[i];
      if (u.species >= kSpecies || u.slot >= kSlots) {
        r.wrongField += 1;
        continue;
      }
      const std::uint32_t index = u.species * kSlots + u.slot;
      gSeenUpload[index] += 1;
      gFrameOf[index] = r.frames;
      frameBytes += u.bytes;
      if (u.bytes != static_cast<std::uint64_t>(gCounts[index]) * veg::kMatrixBytes ||
          u.byteOffset != static_cast<std::uint64_t>(u.slot) * kCapacity * veg::kMatrixBytes || u.bytes > static_cast<std::uint64_t>(kCapacity) * veg::kMatrixBytes ||
          veg::rangeOf(b, u.species, u.slot) != gBlock + static_cast<std::uint64_t>(index) * kCapacity * veg::kMatrixFloats) {
        r.wrongField += 1;
      }
      if (gDirty[u.slot] != 0) r.staleFlags += 1;
    }
    if (frameBytes > budget || n > maxOut) r.overBudget += 1;
    if (gUploads[n].species != kSentinel) r.overBudget += 1;
    if (frameBytes > r.largestFrame) r.largestFrame = frameBytes;
    r.bytes += frameBytes;
    r.uploads += n;
  }
  for (std::uint32_t slot = 0; slot < kSlots; ++slot) {
    std::uint32_t frame = 0;
    bool split = false;
    for (std::uint32_t s = 0; s < kSpecies; ++s) {
      const std::uint32_t index = s * kSlots + slot;
      if (gSeenUpload[index] > 1) r.repeated += 1;
      if (gCounts[index] != 0 && gSeenUpload[index] == 0) r.missing += 1;
      if (gCounts[index] == 0 && gSeenUpload[index] != 0) r.wrongField += 1;
      if (gSeenUpload[index] == 0) continue;
      if (frame != 0 && gFrameOf[index] != frame) split = true;
      frame = gFrameOf[index];
    }
    if (split) r.splitSlots += 1;
  }
  return r;
}

bool whole(const Drain& r) {
  return r.overBudget == 0 && r.wrongField == 0 && r.repeated == 0 && r.missing == 0 && r.splitSlots == 0 && r.staleFlags == 0;
}

}

void vegetationPlan() {
  const double origin[3] = {0.0, 0.0, 0.0};
  veg::Bound b = field();
  fillOrigins();
  fillCounts(7);
  setDirty(0);
  std::memset(gBlock, 0, sizeof gBlock);

  check(veg::valid(b), "vegetation plan: a field of 3 species, 64 slots and 16 instances per slot is valid");
  veg::Bound bad = b;
  bad.species = 0;
  const bool noSpecies = !veg::valid(bad);
  bad = b;
  bad.species = veg::kMaxSpecies + 1;
  const bool manySpecies = !veg::valid(bad);
  bad = b;
  bad.slots = veg::kMaxSlots + 1;
  const bool manySlots = !veg::valid(bad);
  bad = b;
  bad.capacity = 0;
  const bool noCapacity = !veg::valid(bad);
  bad = b;
  bad.dirty = nullptr;
  const bool noDirty = !veg::valid(bad);
  check(noSpecies && manySpecies && manySlots && noCapacity && noDirty,
        "vegetation plan: no species, five species, 4097 slots, zero capacity and a null dirty array are each refused");

  const std::uint32_t resident = residentPairs();
  observe("vegetation plan resident species-slot pairs", resident);
  check(resident > kSlots && resident < kPairs, "vegetation plan: the field has both empty and resident species-slot pairs");

  fillSentinels();
  const std::uint32_t every = veg::planDraws(b, nullptr, origin, gDraws, kPairs);
  check(every == resident && clean(drawCoverage(every, nullptr, origin)),
        "vegetation plan: without planes every resident pair is drawn exactly once with its count and block offset");
  check(gDraws[every].species == kSentinel, "vegetation plan: the draw plan writes nothing past the draws it returns");

  bool ordered = true;
  for (std::uint32_t i = 1; i < every; ++i) {
    ordered = ordered && (gDraws[i].slot > gDraws[i - 1].slot || (gDraws[i].slot == gDraws[i - 1].slot && gDraws[i].species > gDraws[i - 1].species));
  }
  check(ordered, "vegetation plan: draws come in slot order, then species order");

  float open[24];
  allPass(open);
  const std::uint32_t passing = veg::planDraws(b, open, origin, gAgain, kPairs);
  bool sameAsOpen = passing == every;
  for (std::uint32_t i = 0; i < every && sameAsOpen; ++i) sameAsOpen = sameDraw(gDraws[i], gAgain[i]);
  check(sameAsOpen, "vegetation plan: six planes that pass everything give the plan that no planes give");

  float half[24];
  allPass(half);
  half[0] = -1.0f;
  half[3] = kCut;
  fillSentinels();
  const std::uint32_t culled = veg::planDraws(b, half, origin, gDraws, kPairs);
  const Coverage halfCoverage = drawCoverage(culled, half, origin);
  check(culled > 0 && culled < every && clean(halfCoverage),
        "vegetation plan: a cutting plane draws exactly the resident pairs whose bounding sphere touches the inside, each once");
  observe("vegetation plan draws with the cutting plane", culled);
  std::uint32_t wrongSide = 0;
  std::uint32_t straddling = 0;
  for (std::uint32_t i = 0; i < culled; ++i) {
    const double x = gOrigins[gDraws[i].slot * 3];
    if (x - static_cast<double>(kRadius) > static_cast<double>(kCut)) wrongSide += 1;
    if (x > static_cast<double>(kCut)) straddling += 1;
  }
  check(wrongSide == 0 && straddling > 0, "vegetation plan: a patch centred outside the plane but within its radius is still drawn, and none farther is");

  const double shifted[3] = {20.0, 0.0, 0.0};
  fillSentinels();
  const std::uint32_t moved = veg::planDraws(b, half, shifted, gDraws, kPairs);
  check(moved > culled && clean(drawCoverage(moved, half, shifted)),
        "vegetation plan: the planes are read relative to the frame origin, so a moved origin moves the cut");

  fillSentinels();
  const std::uint32_t firstRun = veg::planDraws(b, half, origin, gDraws, kPairs);
  const std::uint32_t secondRun = veg::planDraws(b, half, origin, gAgain, kPairs);
  bool repeatable = firstRun == secondRun;
  for (std::uint32_t i = 0; i < firstRun && repeatable; ++i) repeatable = sameDraw(gDraws[i], gAgain[i]);
  check(repeatable, "vegetation plan: the same field, planes and origin give the same draws twice");

  std::uint32_t capFailures = 0;
  const std::uint32_t full = veg::planDraws(b, nullptr, origin, gAgain, kPairs);
  for (std::uint32_t cap = 0; cap <= full + 2; ++cap) {
    fillSentinels();
    const std::uint32_t n = veg::planDraws(b, nullptr, origin, gDraws, cap);
    const std::uint32_t expected = cap < full ? cap : full;
    if (n != expected) capFailures += 1;
    for (std::uint32_t i = 0; i < n; ++i) {
      if (!sameDraw(gDraws[i], gAgain[i])) capFailures += 1;
    }
    if (gDraws[n].species != kSentinel) capFailures += 1;
  }
  check(capFailures == 0, "vegetation plan: for every draw cap from zero to past the total, the plan is the first cap draws of the full plan and nothing more");

  std::uint64_t instances = 0;
  for (std::uint32_t i = 0; i < full; ++i) instances += gAgain[i].count;
  observe("vegetation plan instances in the full draw plan", static_cast<double>(instances));
  check(instances <= static_cast<std::uint64_t>(kPairs) * kCapacity, "vegetation plan: the planned instances never exceed slots times species times capacity");

  std::uint32_t savedCounts[kPairs];
  std::memcpy(savedCounts, gCounts, sizeof gCounts);
  const std::uint32_t victim = 1 * kSlots + 2;
  gCounts[victim] = kCapacity + 1;
  check(veg::planDraws(b, nullptr, origin, gDraws, kPairs) == veg::kPlanBad, "vegetation plan: a count above capacity in a visible patch refuses the whole plan");
  gCounts[victim] = kCapacity;
  check(veg::planDraws(b, nullptr, origin, gDraws, kPairs) != veg::kPlanBad, "vegetation plan: a count equal to capacity is planned");
  const std::uint32_t hidden = 0 * kSlots + 7;
  gCounts[hidden] = kCapacity + 1;
  check(!sphereTouches(half, 7, origin) && veg::planDraws(b, half, origin, gDraws, kPairs) != veg::kPlanBad,
        "vegetation plan: a count above capacity in a culled patch is not read, so that plan is not refused");
  std::memcpy(gCounts, savedCounts, sizeof gCounts);

  setDirty(1);
  std::uint8_t savedDirty[kSlots];
  std::memcpy(savedDirty, gDirty, sizeof gDirty);
  veg::planDraws(b, half, origin, gDraws, kPairs);
  check(std::memcmp(savedDirty, gDirty, sizeof gDirty) == 0 && std::memcmp(savedCounts, gCounts, sizeof gCounts) == 0,
        "vegetation plan: planning draws changes neither the dirty flags nor the counts");

  std::uint64_t allBytes = 0;
  std::uint64_t largestSlot = 0;
  std::uint32_t emptySlots = 0;
  for (std::uint32_t slot = 0; slot < kSlots; ++slot) {
    const std::uint64_t bytes = slotBytes(slot);
    allBytes += bytes;
    if (bytes > largestSlot) largestSlot = bytes;
    if (bytes == 0) emptySlots += 1;
  }
  observe("vegetation plan bytes with every slot dirty", static_cast<double>(allBytes));
  observe("vegetation plan largest slot bytes", static_cast<double>(largestSlot));

  setDirty(1);
  const Drain ample = drain(b, veg::kUploadBytesPerFrame, kPairs, 4);
  check(whole(ample) && ample.frames == 1 && ample.uploads == resident && ample.bytes == allBytes,
        "vegetation plan: with every slot dirty and an ample budget, one frame uploads each resident pair once with its bytes and its offset in the species buffer");
  check(dirtySlots() == 0, "vegetation plan: every dirty flag is clear after the ample upload");
  check(veg::planUploads(b, gUploads, kPairs, veg::kUploadBytesPerFrame) == 0, "vegetation plan: a second upload plan with nothing dirty is empty");

  setDirty(1);
  const std::uint64_t tight = largestSlot + largestSlot / 2;
  const Drain metered = drain(b, tight, kPairs, kSlots + 1);
  observe("vegetation plan frames to drain at one and a half slots per frame", metered.frames);
  observe("vegetation plan largest frame bytes at that budget", static_cast<double>(metered.largestFrame));
  check(whole(metered) && metered.uploads == resident && metered.bytes == allBytes && metered.frames > 1 && metered.largestFrame <= tight,
        "vegetation plan: a tight budget spreads the uploads over frames, none above the budget, each resident pair once, each slot whole in one frame");
  check(dirtySlots() == 0, "vegetation plan: every dirty flag is clear once the tight budget has drained");

  setDirty(1);
  const Drain exact = drain(b, largestSlot, kPairs, kSlots + 1);
  check(whole(exact) && exact.uploads == resident && exact.largestFrame <= largestSlot, "vegetation plan: a budget equal to the largest slot still drains every slot");
  observe("vegetation plan frames to drain at the largest slot per frame", exact.frames);

  setDirty(0);
  gDirty[5] = 1;
  gDirty[40] = 1;
  const Drain some = drain(b, veg::kUploadBytesPerFrame, kPairs, 4);
  std::uint32_t outsideDirty = 0;
  for (std::uint32_t i = 0; i < kPairs; ++i) {
    const std::uint32_t slot = i % kSlots;
    if (gSeenUpload[i] != 0 && slot != 5 && slot != 40) outsideDirty += 1;
  }
  check(some.frames == 1 && some.bytes == slotBytes(5) + slotBytes(40) && outsideDirty == 0 && some.repeated == 0 && some.wrongField == 0,
        "vegetation plan: only the dirty slots are uploaded");

  for (std::uint32_t s = 0; s < kSpecies; ++s) gCounts[s * kSlots] = kCapacity;
  std::uint32_t residentSlots = 0;
  std::uint32_t fitting = 0;
  const std::uint64_t starved = slotBytes(0) - 1;
  for (std::uint32_t slot = 0; slot < kSlots; ++slot) {
    if (slotBytes(slot) == 0) continue;
    residentSlots += 1;
    if (slot > 0 && slotBytes(slot) <= starved) fitting += 1;
  }
  setDirty(1);
  fillSentinels();
  const std::uint32_t none = veg::planUploads(b, gUploads, kPairs, starved);
  const std::uint32_t noneAgain = veg::planUploads(b, gUploads, kPairs, starved);
  check(none == 0 && noneAgain == 0 && gUploads[0].species == kSentinel && residentDirty() == residentSlots,
        "vegetation plan: a budget one byte below the first dirty slot uploads nothing, and every resident slot stays dirty on each call");
  check(fitting > 0, "vegetation plan: that starved plan also holds back later slots that would fit, because the plan stops at the first slot that does not");
  observe("vegetation plan later slots held back behind the oversized one", fitting);
  check(veg::planUploads(b, gUploads, kPairs, 0) == 0 && residentDirty() == residentSlots, "vegetation plan: a zero byte budget uploads nothing and clears no resident flag");
  std::memcpy(gCounts, savedCounts, sizeof gCounts);
  residentSlots = 0;
  for (std::uint32_t slot = 0; slot < kSlots; ++slot) residentSlots += slotBytes(slot) != 0 ? 1 : 0;

  setDirty(1);
  fillSentinels();
  check(veg::planUploads(b, gUploads, kSpecies - 1, veg::kUploadBytesPerFrame) == 0 && gUploads[0].species == kSentinel,
        "vegetation plan: an output smaller than one slot's species holds no upload");
  setDirty(1);
  const Drain narrow = drain(b, veg::kUploadBytesPerFrame, kSpecies, kSlots + 1);
  check(whole(narrow) && narrow.uploads == resident && narrow.frames == residentSlots,
        "vegetation plan: an output of one slot's species uploads one resident slot per frame until all are done");

  setDirty(1);
  for (std::uint32_t i = 0; i < kPairs; ++i) gCounts[i] = 0;
  fillSentinels();
  check(veg::planDraws(b, nullptr, origin, gDraws, kPairs) == 0 && gDraws[0].species == kSentinel, "vegetation plan: a field with no resident patch plans no draw");
  check(veg::planUploads(b, gUploads, kPairs, veg::kUploadBytesPerFrame) == 0 && gUploads[0].species == kSentinel && dirtySlots() == 0,
        "vegetation plan: a field with no resident patch plans no upload and clears every dirty flag");
  check(veg::planDraws(b, nullptr, origin, gDraws, 0) == 0 && veg::planUploads(b, gUploads, 0, 0) == 0, "vegetation plan: zero output capacity on an empty field plans nothing");

  for (std::uint32_t i = 0; i < kPairs; ++i) gCounts[i] = kCapacity;
  setDirty(1);
  const std::uint64_t fullSlot = static_cast<std::uint64_t>(kSpecies) * kCapacity * veg::kMatrixBytes;
  const Drain packed = drain(b, fullSlot * 5 + fullSlot - 1, kPairs, kSlots + 1);
  check(whole(packed) && packed.uploads == kPairs && packed.largestFrame == fullSlot * 5 && packed.frames == (kSlots + 4) / 5,
        "vegetation plan: full slots at a budget of five and a part upload five whole slots per frame, 13 frames for 64 slots");
  observe("vegetation plan frames for 64 full slots at five per frame", packed.frames);
}

}
