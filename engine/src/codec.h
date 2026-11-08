#ifndef ENGINE_CODEC_H
#define ENGINE_CODEC_H

#include <cstddef>
#include <cstdint>

namespace engine::codec {

constexpr std::size_t kEntityBytes = 29;
constexpr std::size_t kPlayerBytes = 22;
constexpr std::size_t kScratchBytes = 4096;
constexpr std::size_t kScratchValues = 2048;
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

}

#endif
