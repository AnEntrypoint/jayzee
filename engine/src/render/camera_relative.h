#ifndef ENGINE_RENDER_CAMERA_RELATIVE_H
#define ENGINE_RENDER_CAMERA_RELATIVE_H

#include <cstdint>

namespace engine::render {

struct FrameOrigin {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

inline float relativeComponent(double world, double origin) { return static_cast<float>(world - origin); }

inline void relativeOf(const double world[3], const FrameOrigin& origin, float out[3]) {
  out[0] = relativeComponent(world[0], origin.x);
  out[1] = relativeComponent(world[1], origin.y);
  out[2] = relativeComponent(world[2], origin.z);
}

inline void relativeOfFloat(const float world[3], const FrameOrigin& origin, float out[3]) {
  out[0] = relativeComponent(static_cast<double>(world[0]), origin.x);
  out[1] = relativeComponent(static_cast<double>(world[1]), origin.y);
  out[2] = relativeComponent(static_cast<double>(world[2]), origin.z);
}

inline void relativeOfBody(const float body[3], const FrameOrigin& bodyOrigin, const FrameOrigin& origin, float out[3]) {
  out[0] = relativeComponent(static_cast<double>(body[0]) + (bodyOrigin.x - origin.x), 0.0);
  out[1] = relativeComponent(static_cast<double>(body[1]) + (bodyOrigin.y - origin.y), 0.0);
  out[2] = relativeComponent(static_cast<double>(body[2]) + (bodyOrigin.z - origin.z), 0.0);
}

}

#endif
