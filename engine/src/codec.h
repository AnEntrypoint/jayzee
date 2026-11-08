#ifndef ENGINE_CODEC_H
#define ENGINE_CODEC_H

#include <cstddef>
#include <cstdint>

namespace engine::codec {

constexpr std::size_t kEntityBytes = 29;
constexpr std::size_t kPlayerBytes = 22;
constexpr std::size_t kScratchBytes = 4096;
constexpr std::size_t kScratchValues = 8192;
constexpr int kInputVersion = 1;
constexpr int kMaxInputRecords = 255;
constexpr std::size_t kInputHeaderBytes = 2;
constexpr std::size_t kInputRecordBytes = 12;
constexpr std::size_t kInputRecordValues = 5;

bool encodeEntity(const double* position, const double* velocity, double rotationWord, const double* scale, double flags, std::uint8_t* out);
bool decodeEntity(const std::uint8_t* in, std::size_t length, double* position, double* velocity, double& rotationWord, double* scale,
                  double& flags);
bool encodePlayer(const double* position, const double* velocity, double rotationWord, std::uint8_t* out);
bool decodePlayer(const std::uint8_t* in, std::size_t length, double* position, double* velocity, double& rotationWord);
bool encodeSmallestThree(const double* components, double& word);
bool decodeSmallestThree(double word, double* components);
int encodeInputs(const double* records, int count, std::uint8_t* out);
int decodeInputs(const std::uint8_t* in, std::size_t length, double* records);

enum class InputCase : int {
  Accepted,
  Clamped,
  Wrapped,
  Dropped,
  Schema,
  Entries,
  EntriesEmpty,
  Record,
  RecordData,
  Sequence,
  Epoch,
  Field,
  Payload,
  PayloadEmpty,
  Count,
  TruncatedEpoch,
  TruncatedRecord,
  TruncatedAnalog,
  TruncatedAxes,
  Flags,
  Axis,
  Trailing,
};

constexpr int kPacketMaxButtons = 32;
constexpr int kPacketMaxAxes = 16;
constexpr int kPacketStride = 8 + kPacketMaxAxes;
constexpr int kPacketMaxEntries = 256;
constexpr int kPacketMaxRecords = 8;

struct PacketSchema {
  int buttons;
  int axes;
};

int encodePacket(const PacketSchema& schema, const double* entries, int count, double chartEpoch, std::uint8_t* out, std::int32_t* counts);
int decodePacket(const PacketSchema& schema, const std::uint8_t* in, std::size_t length, bool dropping, std::uint32_t dropAtOrBelow,
                 double* entries, std::uint32_t& chartEpoch);

}

#endif
