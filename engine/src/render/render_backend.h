#ifndef ENGINE_RENDER_BACKEND_H
#define ENGINE_RENDER_BACKEND_H

#include <cstdint>

#include "render_frame.h"

namespace engine::render {

enum class BackendKind : std::uint32_t {
  kWebGpu = 0,
  kWebGl2 = 1,
};

constexpr bool isBackendValue(std::uint32_t value) {
  return value <= static_cast<std::uint32_t>(BackendKind::kWebGl2);
}

const char* backendName(std::uint32_t value);
int initBackend(BackendKind kind, std::uint32_t width, std::uint32_t height);
int frameBackend(const SceneView& scene, const FramePlan& plan, const Camera& camera);

}

#endif
