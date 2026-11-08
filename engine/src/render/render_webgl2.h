#ifndef ENGINE_RENDER_WEBGL2_H
#define ENGINE_RENDER_WEBGL2_H

#include <cstdint>

#include "render_frame.h"

namespace engine::render::webgl2 {

int init(const char* selector, std::uint32_t width, std::uint32_t height);
int frame(const SceneView& scene, const FramePlan& plan, const Camera& camera);

}

#endif
