#include "codec.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <new>

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

namespace {

bool entityFieldsValid(const double* position, const double* velocity, double rotationWord, const double* scale, double flags) {
  std::int64_t units = 0;
  for (int axis = 0; axis < 3; ++axis) {
    if (!quantize(position[axis], -kPositionLimit, kPositionLimit, units)) return false;
  }
  for (int axis = 0; axis < 3; ++axis) {
    if (!quantize(velocity[axis], -kVelocityLimit, kVelocityLimit, units)) return false;
  }
  if (!isUnsigned32(rotationWord)) return false;
  for (int axis = 0; axis < 3; ++axis) {
    if (!quantize(scale[axis], 0.0, kScaleLimit, units)) return false;
  }
  return flags >= 0.0 && flags <= 255.0 && std::floor(flags) == flags;
}

}

bool encodeEntityInto(const double* position, const double* velocity, double rotationWord, const double* scale, double flags, std::uint8_t* out) {
  if (!entityFieldsValid(position, velocity, rotationWord, scale, flags)) return false;
  writeKinematics(out, position, velocity, rotationWord);
  for (int axis = 0; axis < 3; ++axis) {
    std::int64_t units = 0;
    quantize(scale[axis], 0.0, kScaleLimit, units);
    writeU16(out, kScaleAt[axis], static_cast<std::uint32_t>(units));
  }
  out[kFlagsAt] = static_cast<std::uint8_t>(flags);
  return true;
}

bool encodeEntity(const double* position, const double* velocity, double rotationWord, const double* scale, double flags, std::uint8_t* out) {
  return encodeEntityInto(position, velocity, rotationWord, scale, flags, out);
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

namespace {

constexpr double kHalfPi = 3.14159265358979323846 / 2.0;
constexpr double kPitchScale = 32767.0 / kHalfPi;
constexpr double kUint32Span = 4294967296.0;
constexpr std::uint8_t kPacketEpochFlag = 0x80;
constexpr std::uint8_t kPacketAnalogFlag = 0x01;
constexpr std::size_t kPacketHeaderBytes = 1;
constexpr std::size_t kPacketEpochBytes = 4;
constexpr std::size_t kPacketFixedBytes = 14;
constexpr std::size_t kPacketAnalogBytes = 2;
constexpr std::size_t kPacketAxisBytes = 4;

int reject(InputCase code) {
  return -1 - static_cast<int>(code);
}

bool isUint32Value(double value) {
  return value >= 0.0 && value < kUint32Span && std::floor(value) == value;
}

bool schemaValid(const PacketSchema& schema) {
  return schema.buttons >= 0 && schema.buttons <= kPacketMaxButtons && schema.axes >= 0 && schema.axes <= kPacketMaxAxes;
}

std::uint32_t buttonMask(int buttons) {
  return buttons >= 32 ? 0xffffffffu : ((1u << buttons) - 1u);
}

std::uint32_t floatBits(float value) {
  std::uint32_t bits = 0;
  std::memcpy(&bits, &value, sizeof bits);
  return bits;
}

float floatFromBits(std::uint32_t bits) {
  float value = 0.0f;
  std::memcpy(&value, &bits, sizeof value);
  return value;
}

void clampTo(double& value, double lo, double hi, std::int32_t& clamped) {
  if (value < lo) {
    value = lo;
    clamped += 1;
  } else if (value > hi) {
    value = hi;
    clamped += 1;
  }
}

int writeRecord(const PacketSchema& schema, const double* record, std::uint8_t* out, std::size_t off, std::int32_t& clamped,
                std::int32_t& wrapped) {
  if (!isUint32Value(record[1])) return reject(InputCase::Field);
  writeU32(out, off, static_cast<std::uint32_t>(record[0]));
  writeU32(out, off + 4, static_cast<std::uint32_t>(record[1]) & buttonMask(schema.buttons));

  const double yaw = record[2];
  if (!std::isfinite(yaw)) return reject(InputCase::Field);
  if (yaw < 0.0 || yaw >= kTwoPi) wrapped += 1;
  const double wrappedYaw = std::fmod(std::fmod(yaw, kTwoPi) + kTwoPi, kTwoPi);
  const std::int64_t steps = static_cast<std::int64_t>(jsRound((wrappedYaw / kTwoPi) * kYawSteps)) % 65536;
  writeU16(out, off + 8, static_cast<std::uint32_t>(steps));

  double pitch = record[3];
  if (!std::isfinite(pitch)) return reject(InputCase::Field);
  clampTo(pitch, -kHalfPi, kHalfPi, clamped);
  writeU16(out, off + 10, static_cast<std::uint32_t>(static_cast<std::int64_t>(jsRound(pitch * kPitchScale))));

  double expr = record[4];
  if (!std::isfinite(expr)) return reject(InputCase::Field);
  clampTo(expr, 0.0, 255.0, clamped);
  out[off + 12] = static_cast<std::uint8_t>(expr);

  if (!(record[5] == 0.0 || record[5] == 1.0)) return reject(InputCase::Field);
  const bool analog = record[5] == 1.0;
  out[off + 13] = analog ? kPacketAnalogFlag : 0;
  off += kPacketFixedBytes;
  if (analog) {
    for (std::size_t k = 0; k < kPacketAnalogBytes; ++k) {
      double value = record[6 + k];
      if (!std::isfinite(value)) return reject(InputCase::Field);
      clampTo(value, -1.0, 1.0, clamped);
      out[off + k] = static_cast<std::uint8_t>(static_cast<std::int8_t>(static_cast<std::int64_t>(jsRound(value * kAxisScale))));
    }
    off += kPacketAnalogBytes;
  }
  for (int a = 0; a < schema.axes; ++a) {
    const double value = record[8 + a];
    if (!std::isfinite(value)) return reject(InputCase::Field);
    writeU32(out, off, floatBits(static_cast<float>(value)));
    off += kPacketAxisBytes;
  }
  return static_cast<int>(off);
}

int recordSpan(const PacketSchema& schema, const std::uint8_t* in, std::size_t off, std::size_t end) {
  if (off + kPacketFixedBytes > end) return reject(InputCase::TruncatedRecord);
  const std::uint8_t flags = in[off + 13];
  if ((flags & static_cast<std::uint8_t>(~kPacketAnalogFlag)) != 0) return reject(InputCase::Flags);
  std::size_t span = kPacketFixedBytes;
  if ((flags & kPacketAnalogFlag) != 0) {
    span += kPacketAnalogBytes;
    if (off + span > end) return reject(InputCase::TruncatedAnalog);
  }
  const std::size_t axesBytes = static_cast<std::size_t>(schema.axes) * kPacketAxisBytes;
  if (off + span + axesBytes > end) return reject(InputCase::TruncatedAxes);
  return static_cast<int>(span + axesBytes);
}

int readRecord(const PacketSchema& schema, const std::uint8_t* in, std::size_t off, std::size_t end, double* entry) {
  const int span = recordSpan(schema, in, off, end);
  if (span < 0) return span;
  const bool analog = (in[off + 13] & kPacketAnalogFlag) != 0;
  entry[0] = static_cast<double>(readU32(in, off));
  entry[1] = static_cast<double>(readU32(in, off + 4) & buttonMask(schema.buttons));
  entry[2] = (static_cast<double>(readU16(in, off + 8)) / kYawSteps) * kTwoPi;
  entry[3] = static_cast<double>(static_cast<std::int16_t>(readU16(in, off + 10))) / kPitchScale;
  entry[4] = static_cast<double>(in[off + 12]);
  entry[5] = analog ? 1.0 : 0.0;
  entry[6] = 0.0;
  entry[7] = 0.0;
  std::size_t at = off + kPacketFixedBytes;
  if (analog) {
    entry[6] = static_cast<double>(static_cast<std::int8_t>(in[at])) / kAxisScale;
    entry[7] = static_cast<double>(static_cast<std::int8_t>(in[at + 1])) / kAxisScale;
    at += kPacketAnalogBytes;
  }
  for (int a = 0; a < kPacketMaxAxes; ++a) entry[8 + a] = 0.0;
  for (int a = 0; a < schema.axes; ++a) {
    const double value = static_cast<double>(floatFromBits(readU32(in, at)));
    at += kPacketAxisBytes;
    if (!std::isfinite(value)) return reject(InputCase::Axis);
    entry[8 + a] = value;
  }
  return static_cast<int>(off) + span;
}

}

int encodePacket(const PacketSchema& schema, const double* entries, int count, double chartEpoch, std::uint8_t* out, std::int32_t* counts) {
  if (!schemaValid(schema)) return reject(InputCase::Schema);
  if (count == 0) return reject(InputCase::EntriesEmpty);
  if (count < 0 || count > kPacketMaxEntries) return reject(InputCase::Count);
  for (int i = 0; i < count; ++i) {
    if (!isUint32Value(entries[i * kPacketStride])) return reject(InputCase::Sequence);
  }
  if (!isUint32Value(chartEpoch)) return reject(InputCase::Epoch);
  const int kept = std::min(count, kPacketMaxRecords);
  const int first = count - kept;
  const bool tagged = chartEpoch > 0.0;
  std::int32_t clamped = 0;
  std::int32_t wrapped = 0;
  out[0] = static_cast<std::uint8_t>(kept | (tagged ? kPacketEpochFlag : 0));
  std::size_t off = kPacketHeaderBytes;
  if (tagged) {
    writeU32(out, off, static_cast<std::uint32_t>(chartEpoch));
    off += kPacketEpochBytes;
  }
  for (int i = first; i < count; ++i) {
    const int next = writeRecord(schema, entries + i * kPacketStride, out, off, clamped, wrapped);
    if (next < 0) return next;
    off = static_cast<std::size_t>(next);
  }
  counts[0] = clamped;
  counts[1] = wrapped;
  counts[2] = first;
  return static_cast<int>(off);
}

int decodePacket(const PacketSchema& schema, const std::uint8_t* in, std::size_t length, bool dropping, std::uint32_t dropAtOrBelow,
                 double* entries, std::uint32_t& chartEpoch) {
  chartEpoch = 0;
  if (!schemaValid(schema)) return reject(InputCase::Schema);
  if (length == 0) return reject(InputCase::PayloadEmpty);
  const int n = in[0] & 0x7f;
  if (n == 0 || n > kPacketMaxRecords) return reject(InputCase::Count);
  std::size_t off = kPacketHeaderBytes;
  if ((in[0] & kPacketEpochFlag) != 0) {
    if (length < kPacketHeaderBytes + kPacketEpochBytes) return reject(InputCase::TruncatedEpoch);
    chartEpoch = readU32(in, off);
    off += kPacketEpochBytes;
  }
  int kept = 0;
  for (int i = 0; i < n; ++i) {
    const int span = recordSpan(schema, in, off, length);
    if (span < 0) return span;
    if (dropping && readU32(in, off) <= dropAtOrBelow) {
      off += static_cast<std::size_t>(span);
      continue;
    }
    const int next = readRecord(schema, in, off, length, entries + kept * kPacketStride);
    if (next < 0) return next;
    off = static_cast<std::size_t>(next);
    kept += 1;
  }
  if (off != length) return reject(InputCase::Trailing);
  return kept;
}


namespace {

constexpr std::size_t kScratchAlign = 16;
constexpr std::size_t kScratchWordAlign = 8;

std::size_t alignScratch(std::size_t value, std::size_t align) {
  return (value + align - 1) / align * align;
}

std::size_t scratchBytesAt() {
  return alignScratch(sizeof(Scratch), kScratchWordAlign);
}

std::size_t scratchValuesAt() {
  return alignScratch(scratchBytesAt() + kScratchBytes, kScratchWordAlign);
}

std::size_t scratchCountsAt() {
  return scratchValuesAt() + kScratchValues * sizeof(double);
}

}

std::size_t Scratch::bytesFor() {
  return alignScratch(scratchCountsAt() + kScratchCounts * sizeof(std::int32_t), kScratchAlign);
}

Scratch* Scratch::bind(void* base) {
  if (base == nullptr) return nullptr;
  std::memset(base, 0, bytesFor());
  std::uint8_t* raw = static_cast<std::uint8_t*>(base);
  Scratch* scratch = new (base) Scratch();
  scratch->bytes = raw + scratchBytesAt();
  scratch->values = reinterpret_cast<double*>(raw + scratchValuesAt());
  scratch->counts = reinterpret_cast<std::int32_t*>(raw + scratchCountsAt());
  scratch->packetEpoch = 0;
  return scratch;
}

}
