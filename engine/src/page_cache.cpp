#include "page_cache.h"

namespace engine::planet {

namespace {

bool inRange(int slot) {
  return slot >= 0 && slot < kPageSlots;
}

}

void PageCache::clear() {
  for (int slot = 0; slot < kPageSlots; ++slot) {
    states_[slot] = PageState::kFree;
    keys_[slot] = 0;
  }
}

int PageCache::stage(std::int64_t key) {
  for (int slot = 0; slot < kPageSlots; ++slot) {
    if (states_[slot] == PageState::kFree) {
      states_[slot] = PageState::kStaged;
      keys_[slot] = key;
      return slot;
    }
  }
  return -1;
}

float* PageCache::samples(int slot) {
  return inRange(slot) ? samples_[slot] : nullptr;
}

const float* PageCache::samplesAt(int slot) const {
  return samples_[slot];
}

bool PageCache::commit(int slot) {
  if (!inRange(slot) || states_[slot] != PageState::kStaged) return false;
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
  for (int slot = 0; slot < kPageSlots; ++slot) {
    if (states_[slot] == PageState::kPendingRelease) states_[slot] = PageState::kFree;
  }
  for (int slot = 0; slot < kPageSlots; ++slot) {
    if (states_[slot] != PageState::kPendingCommit) continue;
    for (int other = 0; other < kPageSlots; ++other) {
      if (other != slot && states_[other] == PageState::kResident && keys_[other] == keys_[slot]) {
        states_[other] = PageState::kFree;
      }
    }
    states_[slot] = PageState::kResident;
  }
}

int PageCache::lookup(std::int64_t key) const {
  for (int slot = 0; slot < kPageSlots; ++slot) {
    const PageState state = states_[slot];
    if ((state == PageState::kResident || state == PageState::kPendingRelease) && keys_[slot] == key) return slot;
  }
  return -1;
}

int PageCache::residentCount() const {
  int count = 0;
  for (int slot = 0; slot < kPageSlots; ++slot) {
    if (states_[slot] == PageState::kResident || states_[slot] == PageState::kPendingRelease) count += 1;
  }
  return count;
}

PageState PageCache::state(int slot) const {
  return inRange(slot) ? states_[slot] : PageState::kFree;
}

}
