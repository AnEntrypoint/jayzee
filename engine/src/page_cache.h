#ifndef ENGINE_PAGE_CACHE_H
#define ENGINE_PAGE_CACHE_H

#include <cstdint>

namespace engine::planet {

constexpr int kPageSlots = 64;
constexpr int kPageSide = 16;
constexpr int kPageSamples = kPageSide * kPageSide;

enum class PageState : std::uint8_t { kFree, kStaged, kPendingCommit, kResident, kPendingRelease };

class PageCache {
 public:
  void clear();
  int stage(std::int64_t key);
  float* samples(int slot);
  const float* samplesAt(int slot) const;
  bool commit(int slot);
  bool releaseKey(std::int64_t key);
  void applyPending();
  int lookup(std::int64_t key) const;
  int residentCount() const;
  PageState state(int slot) const;

 private:
  alignas(16) float samples_[kPageSlots][kPageSamples];
  std::int64_t keys_[kPageSlots];
  PageState states_[kPageSlots];
};

}

#endif
