#include "page_cache.h"

#include <cstring>

namespace engine::planet {

namespace {

constexpr std::size_t kAlign = 16;

std::size_t alignUp(std::size_t value) {
  return (value + kAlign - 1) / kAlign * kAlign;
}

}

std::size_t PageCache::bytesFor(std::uint32_t pageSlots) {
  if (pageSlots == 0 || pageSlots > kMaxPageSlots) return 0;
  const std::size_t count = pageSlots;
  const std::size_t keysAt = count * kPageSamples * sizeof(float);
  const std::size_t statesAt = keysAt + count * sizeof(std::int64_t);
  return alignUp(statesAt + count * sizeof(PageState));
}

bool PageCache::bind(void* base, std::uint32_t pageSlots) {
  const std::size_t total = bytesFor(pageSlots);
  if (base == nullptr || total == 0) return false;
  std::memset(base, 0, total);
  std::uint8_t* raw = static_cast<std::uint8_t*>(base);
  const std::size_t count = pageSlots;
  samples_ = reinterpret_cast<float*>(raw);
  keys_ = reinterpret_cast<std::int64_t*>(raw + count * kPageSamples * sizeof(float));
  states_ = reinterpret_cast<PageState*>(raw + count * kPageSamples * sizeof(float) + count * sizeof(std::int64_t));
  slots_ = static_cast<int>(pageSlots);
  clear();
  return true;
}

namespace {

bool inRange(int slot, int slots) {
  return slot >= 0 && slot < slots;
}

}

void PageCache::clear() {
  for (int slot = 0; slot < slots_; ++slot) {
    states_[slot] = PageState::kFree;
    keys_[slot] = 0;
  }
}

int PageCache::stage(std::int64_t key) {
  for (int slot = 0; slot < slots_; ++slot) {
    if (states_[slot] == PageState::kFree) {
      states_[slot] = PageState::kStaged;
      keys_[slot] = key;
      return slot;
    }
  }
  return -1;
}

float* PageCache::samples(int slot) {
  return inRange(slot, slots_) ? samples_ + static_cast<std::size_t>(slot) * kPageSamples : nullptr;
}

const float* PageCache::pageSamples(int slot) const {
  return inRange(slot, slots_) ? samples_ + static_cast<std::size_t>(slot) * kPageSamples : nullptr;
}

bool PageCache::commit(int slot) {
  if (!inRange(slot, slots_) || states_[slot] != PageState::kStaged) return false;
  states_[slot] = PageState::kPendingCommit;
  return true;
}

bool PageCache::releaseKey(std::int64_t key) {
  const int slot = lookup(key);
  if (slot < 0 || states_[slot] != PageState::kResident) return false;
  states_[slot] = PageState::kPendingRelease;
  return true;
}

void PageCache::applyPending() {
  for (int slot = 0; slot < slots_; ++slot) {
    if (states_[slot] == PageState::kPendingRelease) states_[slot] = PageState::kFree;
  }
  for (int slot = 0; slot < slots_; ++slot) {
    if (states_[slot] != PageState::kPendingCommit) continue;
    for (int other = 0; other < slots_; ++other) {
      if (other != slot && states_[other] == PageState::kResident && keys_[other] == keys_[slot]) {
        states_[other] = PageState::kFree;
      }
    }
    states_[slot] = PageState::kResident;
  }
}

int PageCache::scan(std::int64_t key) const {
  for (int slot = 0; slot < slots_; ++slot) {
    const PageState state = states_[slot];
    if ((state == PageState::kResident || state == PageState::kPendingRelease) && keys_[slot] == key) return slot;
  }
  return -1;
}

void PageCache::cacheLookups(bool on) {
  cacheLookups_ = on;
}

int PageCache::lookup(std::int64_t key) const {
  if (!cacheLookups_) return scan(key);
  constexpr std::uint64_t kMix = 0x9E3779B97F4A7C15ull;
  const std::uint32_t at = static_cast<std::uint32_t>((static_cast<std::uint64_t>(key) * kMix) >> 56) % kRecentLookups;
  const int remembered = recent_[at].load(std::memory_order_relaxed) - 1;
  if (remembered >= 0 && remembered < slots_) {
    const PageState state = states_[remembered];
    if ((state == PageState::kResident || state == PageState::kPendingRelease) && keys_[remembered] == key) return remembered;
  }
  const int found = scan(key);
  if (found >= 0) recent_[at].store(found + 1, std::memory_order_relaxed);
  return found;
}

int PageCache::residentCount() const {
  int count = 0;
  for (int slot = 0; slot < slots_; ++slot) {
    if (states_[slot] == PageState::kResident || states_[slot] == PageState::kPendingRelease) count += 1;
  }
  return count;
}

int PageCache::pageSlotCount() const {
  return slots_;
}

PageState PageCache::state(int slot) const {
  return inRange(slot, slots_) ? states_[slot] : PageState::kFree;
}

}
