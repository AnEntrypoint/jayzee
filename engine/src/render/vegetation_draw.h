#ifndef ENGINE_RENDER_VEGETATION_DRAW_H
#define ENGINE_RENDER_VEGETATION_DRAW_H

#include <cstdint>

namespace engine::render::vegetation {

constexpr std::uint32_t kMatrixBytes = 64;
constexpr std::uint32_t kMatrixFloats = 16;
constexpr std::uint32_t kMaxSpecies = 4;
constexpr std::uint32_t kMaxSlots = 4096;
constexpr std::uint64_t kUploadBytesPerFrame = 1ull << 20;
constexpr std::uint32_t kPlanBad = 0xffffffffu;

struct Bound {
  float* block = nullptr;
  std::uint32_t* counts = nullptr;
  std::uint8_t* dirty = nullptr;
  double* origins = nullptr;
  float radius = 0.0f;
  std::uint32_t species = 0;
  std::uint32_t slots = 0;
  std::uint32_t capacity = 0;
};

struct Draw {
  std::uint32_t species;
  std::uint32_t slot;
  std::uint32_t count;
  std::uint64_t byteOffset;
};

struct Upload {
  std::uint32_t species;
  std::uint32_t slot;
  std::uint64_t byteOffset;
  std::uint64_t bytes;
};

inline Bound& state() {
  static Bound bound;
  return bound;
}

inline bool valid(const Bound& b) {
  return b.block != nullptr && b.counts != nullptr && b.dirty != nullptr && b.origins != nullptr && b.species >= 1 && b.species <= kMaxSpecies && b.slots >= 1 &&
         b.slots <= kMaxSlots && b.capacity >= 1 && b.radius >= 0.0f;
}

inline bool bind(const Bound& b) {
  if (!valid(b)) return false;
  state() = b;
  return true;
}

inline bool bound() { return valid(state()); }

inline std::uint32_t indexOf(const Bound& b, std::uint32_t species, std::uint32_t slot) { return species * b.slots + slot; }

inline bool outsidePlane(const float* planes, const double* origin, float radius) {
  for (std::uint32_t p = 0; p < 6; ++p) {
    const float* q = planes + p * 4;
    const double d = static_cast<double>(q[0]) * origin[0] + static_cast<double>(q[1]) * origin[1] + static_cast<double>(q[2]) * origin[2] + static_cast<double>(q[3]);
    if (d < -static_cast<double>(radius)) return true;
  }
  return false;
}

inline std::uint32_t planDraws(const Bound& b, const float* planes, Draw* out, std::uint32_t maxOut) {
  std::uint32_t n = 0;
  for (std::uint32_t slot = 0; slot < b.slots; ++slot) {
    if (planes != nullptr && outsidePlane(planes, b.origins + slot * 3, b.radius)) continue;
    for (std::uint32_t s = 0; s < b.species; ++s) {
      const std::uint32_t count = b.counts[indexOf(b, s, slot)];
      if (count == 0) continue;
      if (count > b.capacity) return kPlanBad;
      if (n >= maxOut) return n;
      out[n] = Draw{s, slot, count, static_cast<std::uint64_t>(indexOf(b, s, slot)) * b.capacity * kMatrixBytes};
      n += 1;
    }
  }
  return n;
}

inline std::uint32_t planUploads(Bound& b, Upload* out, std::uint32_t maxOut, std::uint64_t budgetBytes) {
  std::uint32_t n = 0;
  std::uint64_t spent = 0;
  for (std::uint32_t slot = 0; slot < b.slots; ++slot) {
    if (b.dirty[slot] == 0) continue;
    std::uint64_t slotBytes = 0;
    for (std::uint32_t s = 0; s < b.species; ++s) slotBytes += static_cast<std::uint64_t>(b.counts[indexOf(b, s, slot)]) * kMatrixBytes;
    if (slotBytes == 0) {
      b.dirty[slot] = 0;
      continue;
    }
    if (spent + slotBytes > budgetBytes) return n;
    if (n + b.species > maxOut) return n;
    for (std::uint32_t s = 0; s < b.species; ++s) {
      const std::uint64_t bytes = static_cast<std::uint64_t>(b.counts[indexOf(b, s, slot)]) * kMatrixBytes;
      if (bytes == 0) continue;
      out[n] = Upload{s, slot, static_cast<std::uint64_t>(slot) * b.capacity * kMatrixBytes, bytes};
      n += 1;
    }
    spent += slotBytes;
    b.dirty[slot] = 0;
  }
  return n;
}

inline const float* rangeOf(const Bound& b, std::uint32_t species, std::uint32_t slot) {
  return b.block + static_cast<std::uint64_t>(indexOf(b, species, slot)) * b.capacity * kMatrixFloats;
}

inline void originFloat(const Bound& b, std::uint32_t slot, float out[3]) {
  out[0] = static_cast<float>(b.origins[slot * 3]);
  out[1] = static_cast<float>(b.origins[slot * 3 + 1]);
  out[2] = static_cast<float>(b.origins[slot * 3 + 2]);
}

}

#endif
