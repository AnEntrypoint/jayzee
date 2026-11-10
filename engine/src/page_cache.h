#ifndef ENGINE_PAGE_CACHE_H
#define ENGINE_PAGE_CACHE_H

#include <cstddef>
#include <cstdint>

namespace engine::planet {

constexpr int kPageSide = 16;
constexpr int kPageSamples = kPageSide * kPageSide;
constexpr std::uint32_t kMaxPageSlots = 1u << 16;

enum class PageState : std::uint8_t { kFree, kStaged, kPendingCommit, kResident, kPendingRelease };

constexpr std::uint32_t kMinPageSlots = 64;
constexpr std::uint32_t kMaxRenderedPages = 256;
constexpr std::uint64_t kPageArenaBytes = kPageSamples * sizeof(float) + sizeof(std::int64_t) + sizeof(PageState);

class PageCache {
 public:
  static std::size_t bytesFor(std::uint32_t pageSlots);
  bool bind(void* base, std::uint32_t pageSlots);
  void clear();
  int stage(std::int64_t key);
  float* samples(int slot);
  const float* pageSamples(int slot) const;
  bool commit(int slot);
  bool releaseKey(std::int64_t key);
  void applyPending();
  int lookup(std::int64_t key) const;
  int residentCount() const;
  int pageSlotCount() const;
  PageState state(int slot) const;

 private:
  float* samples_ = nullptr;
  std::int64_t* keys_ = nullptr;
  PageState* states_ = nullptr;
  int slots_ = 0;
};

}

#endif
