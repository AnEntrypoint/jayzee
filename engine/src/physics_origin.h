#ifndef ENGINE_PHYSICS_ORIGIN_H
#define ENGINE_PHYSICS_ORIGIN_H

namespace engine {

struct PhysicsOrigin {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

constexpr double kRebaseMetres = 1024.0;

inline PhysicsOrigin& physicsOrigin() {
  static PhysicsOrigin origin;
  return origin;
}

}

#endif
