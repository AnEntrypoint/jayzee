#ifndef ENGINE_ARENA_H
#define ENGINE_ARENA_H

#include <cstddef>
#include <cstdint>

namespace engine::arena {

constexpr std::size_t kBytes = ENGINE_ARENA_BYTES;

void* carve(std::size_t bytes, std::size_t alignment);
std::size_t used();
std::uint64_t carves();
void seal();
bool sealed();

}

#endif
