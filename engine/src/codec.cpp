#include "codec.h"

#include <algorithm>
#include <cmath>

namespace engine::codec {

namespace {

constexpr double kWireUnitsPerMeter = 100.0;
constexpr double kPositionLimit = 2147483647.0;
constexpr double kVelocityLimit = 32767.0;
constexpr double kScaleLimit = 65535.0;
constexpr double kQuaternionTolerance = 2e-4;
constexpr double kSqrtHalf = 0.70710678118654752440;
constexpr double kStepsPerUnit = 511.0 * 1.41421356237309504880;
constexpr double kFieldLevels = 1022.0;
constexpr double kFieldSpan = 1024.0;
constexpr double kQuatWordMax = 4294967295.0;
constexpr double kAxisScale = 127.0;
constexpr double kYawSteps = 65536.0;
constexpr double kTwoPi = 2.0 * 3.14159265358979323846;
constexpr double kUint32Max = 4294967295.0;
constexpr std::size_t kPositionAt[3] = {0, 4, 8};
constexpr std::size_t kVelocityAt[3] = {12, 14, 16};
constexpr std::size_t kRotationAt = 18;
constexpr std::size_t kScaleAt[3] = {22, 24, 26};
constexpr std::size_t kFlagsAt = 28;

double jsRound(double value) {
  const double base = std::floor(value);
  return value - base >= 0.5 ? base + 1.0 : base;
}

bool quantize(double value, double minUnits, double maxUnits, std::int64_t& units) {
  if (!std::isfinite(value)) return false;
  const double rounded = jsRound(value * kWireUnitsPerMeter);
  if (rounded < minUnits || rounded > maxUnits) return false;
  units = static_cast<std::int64_t>(rounded);
  return true;
}

bool isUnsigned32(double value) {
  return std::isfinite(value) && value >= 0.0 && value <= kUint32Max && std::floor(value) == value;
}

void writeU16(std::uint8_t* out, std::size_t at, std::uint32_t value) {
  out[at] = static_cast<std::uint8_t>(value & 0xffu);
  out[at + 1] = static_cast<std::uint8_t>((value >> 8) & 0xffu);
}

void writeU32(std::uint8_t* out, std::size_t at, std::uint32_t value) {
  writeU16(out, at, value & 0xffffu);
  writeU16(out, at + 2, value >> 16);
}

std::uint32_t readU16(const std::uint8_t* in, std::size_t at) {
  return static_cast<std::uint32_t>(in[at]) | (static_cast<std::uint32_t>(in[at + 1]) << 8);
}

std::uint32_t readU32(const std::uint8_t* in, std::size_t at) {
  return readU16(in, at) | (readU16(in, at + 2) << 16);
}

bool writeKinematics(std::uint8_t* out, const double* position, const double* velocity, double rotationWord) {
  for (int axis = 0; axis < 3; ++axis) {
    std::int64_t units = 0;
    if (!quantize(position[axis], -kPositionLimit, kPositionLimit, units)) return false;
    writeU32(out, kPositionAt[axis], static_cast<std::uint32_t>(units));
  }
  for (int axis = 0; axis < 3; ++axis) {
    std::int64_t units = 0;
    if (!quantize(velocity[axis], -kVelocityLimit, kVelocityLimit, units)) return false;
    writeU16(out, kVelocityAt[axis], static_cast<std::uint32_t>(units));
  }
  if (!isUnsigned32(rotationWord)) return false;
  writeU32(out, kRotationAt, static_cast<std::uint32_t>(rotationWord));
  return true;
}

void readKinematics(const std::uint8_t* in, double* position, double* velocity, double& rotationWord) {
  for (int axis = 0; axis < 3; ++axis) {
    position[axis] = static_cast<double>(static_cast<std::int32_t>(readU32(in, kPositionAt[axis]))) / kWireUnitsPerMeter;
  }
  for (int axis = 0; axis < 3; ++axis) {
    velocity[axis] = static_cast<double>(static_cast<std::int16_t>(readU16(in, kVelocityAt[axis]))) / kWireUnitsPerMeter;
  }
  rotationWord = static_cast<double>(readU32(in, kRotationAt));
}

std::uint64_t quantizeField(double value) {
  const double level = jsRound((value + kSqrtHalf) * kStepsPerUnit);
  return static_cast<std::uint64_t>(std::clamp(level, 0.0, kFieldLevels));
}

bool axisByte(double value, std::uint8_t& out) {
  if (!(value >= -1.0 && value <= 1.0)) return false;
  out = static_cast<std::uint8_t>(static_cast<std::int8_t>(static_cast<std::int64_t>(jsRound(value * kAxisScale))));
  return true;
}

bool yawSteps(double yaw, std::uint32_t& out) {
  if (!std::isfinite(yaw)) return false;
  const double wrapped = std::fmod(std::fmod(yaw, kTwoPi) + kTwoPi, kTwoPi);
  const std::int64_t steps = static_cast<std::int64_t>(jsRound((wrapped / kTwoPi) * kYawSteps));
  out = static_cast<std::uint32_t>(steps % 65536);
  return true;
}

}

bool encodeEntity(const double* position, const double* velocity, double rotationWord, const double* scale, double flags, std::uint8_t* out) {
  if (!writeKinematics(out, position, velocity, rotationWord)) return false;
  for (int axis = 0; axis < 3; ++axis) {
    std::int64_t units = 0;
    if (!quantize(scale[axis], 0.0, kScaleLimit, units)) return false;
    writeU16(out, kScaleAt[axis], static_cast<std::uint32_t>(units));
  }
  if (!(flags >= 0.0 && flags <= 255.0) || std::floor(flags) != flags) return false;
  out[kFlagsAt] = static_cast<std::uint8_t>(flags);
  return true;
}

bool decodeEntity(const std::uint8_t* in, std::size_t length, double* position, double* velocity, double& rotationWord, double* scale,
                  double& flags) {
  if (length != kEntityBytes) return false;
  readKinematics(in, position, velocity, rotationWord);
  for (int axis = 0; axis < 3; ++axis) {
    scale[axis] = static_cast<double>(readU16(in, kScaleAt[axis])) / kWireUnitsPerMeter;
  }
  flags = static_cast<double>(in[kFlagsAt]);
  return true;
}

bool encodePlayer(const double* position, const double* velocity, double rotationWord, std::uint8_t* out) {
  return writeKinematics(out, position, velocity, rotationWord);
}

bool decodePlayer(const std::uint8_t* in, std::size_t length, double* position, double* velocity, double& rotationWord) {
  if (length != kPlayerBytes) return false;
  readKinematics(in, position, velocity, rotationWord);
  return true;
}

bool encodeSmallestThree(const double* components, double& word) {
  double sumSquares = 0.0;
  for (int i = 0; i < 4; ++i) {
    if (!std::isfinite(components[i])) return false;
    sumSquares += components[i] * components[i];
  }
  if (std::fabs(sumSquares - 1.0) > kQuaternionTolerance) return false;
  int largest = 0;
  for (int i = 1; i < 4; ++i) {
    if (std::fabs(components[i]) > std::fabs(components[largest])) largest = i;
  }
  const double sign = components[largest] < 0.0 ? -1.0 : 1.0;
  std::uint64_t packed = static_cast<std::uint64_t>(largest);
  for (int i = 0; i < 4; ++i) {
    if (i == largest) continue;
    packed = packed * static_cast<std::uint64_t>(kFieldSpan) + quantizeField(components[i] * sign);
  }
  word = static_cast<double>(packed);
  return true;
}

bool decodeSmallestThree(double word, double* components) {
  if (!std::isfinite(word) || word < 0.0 || word > kQuatWordMax || std::floor(word) != word) return false;
  const std::uint64_t packed = static_cast<std::uint64_t>(word);
  const int largest = static_cast<int>(packed >> 30);
  const std::uint64_t levels[3] = {(packed >> 20) & 1023u, (packed >> 10) & 1023u, packed & 1023u};
  double fields[3];
  double sumSquares = 0.0;
  for (int k = 0; k < 3; ++k) {
    fields[k] = static_cast<double>(levels[k]) / kStepsPerUnit - kSqrtHalf;
    sumSquares += fields[k] * fields[k];
  }
  if (sumSquares > 1.0) return false;
  int next = 0;
  for (int i = 0; i < 4; ++i) {
    components[i] = i == largest ? std::sqrt(1.0 - sumSquares) : fields[next++];
  }
  return true;
}

int encodeInputs(const double* records, int count, std::uint8_t* out) {
  if (count <= 0 || count > kMaxInputRecords) return -1;
  out[0] = static_cast<std::uint8_t>(kInputVersion);
  out[1] = static_cast<std::uint8_t>(count);
  for (int index = 0; index < count; ++index) {
    const double* record = records + index * kInputRecordValues;
    const std::size_t at = kInputHeaderBytes + static_cast<std::size_t>(index) * kInputRecordBytes;
    if (!isUnsigned32(record[0]) || !isUnsigned32(record[4])) return -1;
    std::uint8_t moveX = 0;
    std::uint8_t moveZ = 0;
    std::uint32_t steps = 0;
    if (!axisByte(record[1], moveX) || !axisByte(record[2], moveZ) || !yawSteps(record[3], steps)) return -1;
    writeU32(out, at, static_cast<std::uint32_t>(record[0]));
    out[at + 4] = moveX;
    out[at + 5] = moveZ;
    writeU16(out, at + 6, steps);
    writeU32(out, at + 8, static_cast<std::uint32_t>(record[4]));
  }
  return static_cast<int>(kInputHeaderBytes + static_cast<std::size_t>(count) * kInputRecordBytes);
}

int decodeInputs(const std::uint8_t* in, std::size_t length, double* records) {
  if (length < kInputHeaderBytes) return -1;
  if (in[0] != kInputVersion) return -1;
  const int count = in[1];
  if (count == 0) return -1;
  if (length != kInputHeaderBytes + static_cast<std::size_t>(count) * kInputRecordBytes) return -1;
  for (int index = 0; index < count; ++index) {
    const std::size_t at = kInputHeaderBytes + static_cast<std::size_t>(index) * kInputRecordBytes;
    double* record = records + index * kInputRecordValues;
    record[0] = static_cast<double>(readU32(in, at));
    record[1] = static_cast<double>(static_cast<std::int8_t>(in[at + 4])) / kAxisScale;
    record[2] = static_cast<double>(static_cast<std::int8_t>(in[at + 5])) / kAxisScale;
    record[3] = (static_cast<double>(readU16(in, at + 6)) / kYawSteps) * kTwoPi;
    record[4] = static_cast<double>(readU32(in, at + 8));
  }
  return count;
}

}
