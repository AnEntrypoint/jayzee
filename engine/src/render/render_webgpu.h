#ifndef ENGINE_RENDER_WEBGPU_H
#define ENGINE_RENDER_WEBGPU_H

#include <cstdint>

#include "render_frame.h"

namespace engine::render::webgpu {

int init(const char* selector, std::uint32_t width, std::uint32_t height);
int frame(const SceneView& scene, const FramePlan& plan, const Camera& camera);

}

#endif
