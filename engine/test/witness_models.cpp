#include <cstddef>
#include <cstdint>
#include <cstring>

#include "device_tier.h"
#include "harness.h"
#include "model_pool.h"
#include "textures.h"
#include "world.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

constexpr std::uint64_t kMiB = 1024ull * 1024ull;
constexpr std::uint64_t kGiB = 1024ull * kMiB;

device::Limits limits(std::uint32_t side, std::uint32_t layers, std::uint64_t maxBuffer, std::uint32_t texel, std::uint64_t memory) {
  return device::Limits{side, layers, maxBuffer, texel, memory};
}

alignas(16) std::uint8_t gStorage[4096];

const models::Layout kLayout{4, 8, 12, 32};

constexpr std::uint32_t kChurnCycles = 10000;

bool refusedWith(double value, Status status) {
  return value == static_cast<double>(status);
}

}

void modelsAndTiers() {
  device::Plan planned{};

  check(device::plan(limits(8192, 256, 256 * kMiB, 1, 0), planned) && planned.tier == 2,
        "device plan picks tier 2 for compressed textures on a large device");
  check(planned.vramBytes == 905969664ull, "tier 2 compressed accounted bytes equal the hand-computed 905969664");
  check(planned.vramBudgetBytes == 1024 * kMiB && planned.uploadBytesPerFrame == 2u * 1024u * 1024u,
        "tier 2 carries its budget and its per-frame upload allowance");

  check(device::plan(limits(8192, 256, 256 * kMiB, 4, 0), planned) && planned.tier == 0,
        "device plan picks tier 0 for RGBA8 textures, since no larger tier fits the budget");
  check(planned.vramBytes == 112547157ull, "tier 0 RGBA8 accounted bytes equal the hand-computed 112547157");

  check(device::plan(limits(1024, 256, 256 * kMiB, 1, 0), planned) && planned.tier == 1,
        "a device capped at 1024 texture side gets tier 1");
  check(planned.vramBytes == 363506346ull, "tier 1 compressed accounted bytes equal the hand-computed 363506346");

  check(device::plan(limits(8192, 256, 64 * kMiB, 1, 0), planned) && planned.tier == 0,
        "a 64 MiB buffer limit leaves only tier 0's pools");
  check(device::plan(limits(8192, 256, 1024, 1, 0), planned) == false, "a device with no tier that fits is refused");
  check(device::plan(limits(8192, 256, 256 * kMiB, 2, 0), planned) == false, "a texel size other than 1 or 4 is refused");
  check(device::plan(limits(8192, 256, 256 * kMiB, 1, kGiB), planned) && planned.tier == 0,
        "a 1 GiB device caps the budget at a quarter and drops to tier 0");
  check(planned.vramBudgetBytes == 256 * kMiB, "the device cap sets the budget to a quarter of device memory");

  check(device::vramBytesOf(device::Plan{0, 512, 64, 1, 128, 4096, 12288, 32, 0, 0, 0}) == 45438293ull,
        "vramBytesOf for tier 0 at one byte per texel equals 45438293");

  check(device::planTier(2, 1, planned) && planned.vramBytes == 905969664ull, "planTier fills the accounted bytes without the fit test");
  check(!device::planTier(2, 2, planned), "planTier refuses a texel size other than 1 or 4");
  check(models::validLayout(kLayout), "a four-slot layout with 32-byte vertices is valid");
  check(!models::validLayout({0, 8, 12, 32}), "a layout with no slots is refused");
  check(!models::validLayout({handles::kMaxSlots + 1, 8, 12, 32}), "a layout above the slot maximum is refused");
  check(!models::validLayout({4, 8, 12, 6}), "a vertex stride that is not a multiple of four is refused");
  check(!models::validLayout({65535, 65536, 12, 256}), "a vertex pool above the 32-bit range is refused");

  check(refusedWith(models::acquire(1, 1), kNotConfigured), "acquire before bind reports not configured");
  check(models::bind(nullptr, sizeof gStorage, kLayout) == kRange, "bind refuses a null base");
  check(models::bind(gStorage + 8, sizeof gStorage - 8, kLayout) == kRange, "bind refuses a base that is not 16-byte aligned");
  check(models::bind(gStorage, models::bytesFor(kLayout) - 1, kLayout) == kRange, "bind refuses a buffer one byte short");
  check(models::bind(gStorage, sizeof gStorage, {4, 8, 12, 6}) == kRange, "bind refuses a bad layout");
  check(models::bind(gStorage, sizeof gStorage, kLayout) == kOk, "bind accepts an aligned buffer of the layout size");
  check(models::bind(gStorage, sizeof gStorage, kLayout) == kRange, "a second bind is refused");
  observe("model pool bytes for the witness layout", static_cast<double>(models::bytesFor(kLayout)));

  double first = models::acquire(8, 12);
  double second = models::acquire(4, 6);
  double third = models::acquire(1, 1);
  double fourth = models::acquire(8, 12);
  check(first > 0.0 && second > 0.0 && third > 0.0 && fourth > 0.0, "four slots acquire with positive handles");
  check(refusedWith(models::acquire(1, 1), kFull), "a fifth acquire on four slots reports full");
  check(refusedWith(models::acquire(9, 1), kRange), "acquire refuses more vertices than a slot holds");
  check(refusedWith(models::acquire(1, 13), kRange), "acquire refuses more indices than a slot holds");
  check(models::liveCount() == 4, "four live slots after four acquires");

  alignas(16) std::uint8_t vertices[8 * 32];
  alignas(16) std::uint8_t indices[12 * 4];
  for (std::size_t i = 0; i < sizeof vertices; ++i) vertices[i] = static_cast<std::uint8_t>(i + 1);
  for (std::size_t i = 0; i < sizeof indices; ++i) indices[i] = static_cast<std::uint8_t>(0x80 + i);
  check(models::upload(first, vertices, 8, indices, 12) == kOk, "upload with the acquired counts succeeds");
  check(models::slotDirty(0) && !models::uploaded(first), "an upload marks its slot dirty until the GPU copy clears it");
  models::clearDirty(0);
  check(models::slotReady(0) && models::uploaded(first), "clearing the dirty flag makes the slot ready to draw");
  check(models::dirtyCount() == 0, "no slot is dirty after its upload is cleared");
  check(models::upload(first, vertices, 7, indices, 12) == kRange, "upload with a vertex count other than acquired is refused");
  check(models::upload(first, vertices, 8, indices, 11) == kRange, "upload with an index count other than acquired is refused");
  check(models::upload(first, nullptr, 8, indices, 12) == kRange, "upload with a null vertex pointer is refused");

  models::Range range{};
  check(models::ranges(first, range) == kOk, "ranges reads a live slot");
  check(range.firstVertex == 0 && range.vertexCount == 8 && range.firstIndex == 0 && range.indexCount == 12,
        "the first slot's ranges are vertices 0 to 8 and indices 0 to 12");
  check(models::ranges(second, range) == kOk && range.firstVertex == 8 && range.firstIndex == 12,
        "the second slot starts after the first slot's pool share");

  const std::size_t vertexBase = 80;
  check(std::memcmp(gStorage + vertexBase, vertices, sizeof vertices) == 0,
        "upload copies the vertex bytes into the slot's pool share");

  check(models::release(second) == kOk, "release frees a live slot");
  check(models::isLive(second) == false, "a released handle is no longer live");
  check(models::release(second) == kBadId, "a second release of the same handle is refused");
  check(models::ranges(second, range) == kBadId, "ranges on a released handle is refused");
  check(models::upload(second, vertices, 4, indices, 6) == kBadId, "upload on a released handle is refused");
  check(models::liveCount() == 3, "three live slots after one release");

  double reused = models::acquire(4, 6);
  check(reused > 0.0 && reused != second, "the freed slot is reacquired under a new generation handle");
  check(models::isLive(reused) && !models::isLive(second), "the new handle is live and the old handle is stale");
  check(models::liveCount() == 4, "four live slots after reacquiring the freed slot");

  check(models::release(first) == kOk && models::release(third) == kOk && models::release(fourth) == kOk &&
            models::release(reused) == kOk,
        "all four slots release");
  check(models::liveCount() == 0, "no live slots after every release");

  std::uint32_t churnFailures = 0;
  for (std::uint32_t cycle = 0; cycle < kChurnCycles; ++cycle) {
    const double handle = models::acquire(8, 12);
    if (handle <= 0.0 || models::upload(handle, vertices, 8, indices, 12) != kOk || models::release(handle) != kOk) {
      churnFailures += 1;
    }
  }
  check(churnFailures == 0, "10000 acquire, upload and release cycles all succeed");
  check(models::liveCount() == 0, "the churn leaves no live slot");
  check(models::bytesFor(kLayout) == 1296, "the pool's byte size is unchanged by the churn");
  observe("model churn cycles", kChurnCycles);
}

}
