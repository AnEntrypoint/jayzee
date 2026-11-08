#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>

#include "codec.h"
#include "harness.h"

namespace engine::witness {

namespace {

using engine::test::check;
using engine::test::observe;

constexpr double kIdentityQuatWord = 3757571583.0;
constexpr double kQuatTolerance = 1e-9;
constexpr double kEntityRotation = kIdentityQuatWord;
constexpr double kEntityFlags = 3.0;
constexpr double kFlagsOverflow = 256.0;
constexpr std::size_t kShortEntityBytes = codec::kEntityBytes - 1;
constexpr std::size_t kShortPlayerBytes = codec::kPlayerBytes - 1;
constexpr std::size_t kLongEntityBytes = codec::kEntityBytes + 1;

constexpr double kPosition[3] = {1.25, -3.5, 100.75};
constexpr double kVelocity[3] = {0.5, -2.25, 4.0};
constexpr double kScale[3] = {1.0, 2.0, 0.5};

bool sameValues(const double* a, const double* b, int count) {
  for (int i = 0; i < count; ++i) {
    if (std::fabs(a[i] - b[i]) > 1e-9) return false;
  }
  return true;
}

void entityRoundTrip() {
  std::uint8_t bytes[codec::kEntityBytes];
  check(codec::encodeEntity(kPosition, kVelocity, kEntityRotation, kScale, kEntityFlags, bytes),
        "phase 7: an entity encodes");
  double position[3];
  double velocity[3];
  double scale[3];
  double rotation = 0.0;
  double flags = 0.0;
  check(codec::decodeEntity(bytes, codec::kEntityBytes, position, velocity, rotation, scale, flags),
        "phase 7: a 29-byte entity decodes");
  check(sameValues(position, kPosition, 3), "phase 7: entity position round-trips");
  check(sameValues(velocity, kVelocity, 3), "phase 7: entity velocity round-trips");
  check(sameValues(scale, kScale, 3), "phase 7: entity scale round-trips");
  check(rotation == kEntityRotation && flags == kEntityFlags, "phase 7: entity rotation word and flags round-trip");
}

void playerRoundTrip() {
  std::uint8_t bytes[codec::kPlayerBytes];
  check(codec::encodePlayer(kPosition, kVelocity, kEntityRotation, bytes), "phase 7: a player encodes");
  double position[3];
  double velocity[3];
  double rotation = 0.0;
  check(codec::decodePlayer(bytes, codec::kPlayerBytes, position, velocity, rotation), "phase 7: a 22-byte player decodes");
  check(sameValues(position, kPosition, 3), "phase 7: player position round-trips");
  check(sameValues(velocity, kVelocity, 3), "phase 7: player velocity round-trips");
  check(rotation == kEntityRotation, "phase 7: player rotation word round-trips");
}

void truncatedRecords() {
  std::uint8_t entity[codec::kEntityBytes + 1];
  std::uint8_t player[codec::kPlayerBytes + 1];
  check(codec::encodeEntity(kPosition, kVelocity, kEntityRotation, kScale, kEntityFlags, entity), "phase 7: an entity encodes for the length test");
  check(codec::encodePlayer(kPosition, kVelocity, kEntityRotation, player), "phase 7: a player encodes for the length test");
  double position[3];
  double velocity[3];
  double scale[3];
  double rotation = 0.0;
  double flags = 0.0;
  check(!codec::decodeEntity(entity, kShortEntityBytes, position, velocity, rotation, scale, flags),
        "phase 7: a 28-byte entity record is refused");
  check(!codec::decodeEntity(entity, kLongEntityBytes, position, velocity, rotation, scale, flags),
        "phase 7: a 30-byte entity record is refused");
  check(!codec::decodePlayer(player, kShortPlayerBytes, position, velocity, rotation),
        "phase 7: a 21-byte player record is refused");
  check(!codec::decodePlayer(player, 0, position, velocity, rotation), "phase 7: an empty player record is refused");
}

void refusedEncodes() {
  std::uint8_t bytes[codec::kEntityBytes];
  const double nanPosition[3] = {std::numeric_limits<double>::quiet_NaN(), 0.0, 0.0};
  check(!codec::encodeEntity(nanPosition, kVelocity, kEntityRotation, kScale, kEntityFlags, bytes),
        "phase 7: an entity with a NaN position is refused");
  check(!codec::encodeEntity(kPosition, kVelocity, kEntityRotation, kScale, kFlagsOverflow, bytes),
        "phase 7: an entity with flags above 255 is refused");
}

void identityQuaternion() {
  const double identity[4] = {0.0, 0.0, 0.0, 1.0};
  double word = 0.0;
  check(codec::encodeSmallestThree(identity, word), "phase 7: the identity quaternion encodes");
  check(word == kIdentityQuatWord, "phase 7: the identity quaternion encodes to the named smallest-three word");
  double components[4];
  check(codec::decodeSmallestThree(kIdentityQuatWord, components), "phase 7: the identity word decodes");
  check(sameValues(components, identity, 4) && std::fabs(components[3] - 1.0) <= kQuatTolerance,
        "phase 7: the identity word decodes back to the identity quaternion");
  observe("phase 7: identity smallest-three word", word);
}

}

void phase7Codecs() {
  entityRoundTrip();
  playerRoundTrip();
  truncatedRecords();
  refusedEncodes();
  identityQuaternion();
}

}
