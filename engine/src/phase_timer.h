#pragma once

#if defined(ENGINE_PHASE_TIMERS)
#include <chrono>
#endif

namespace engine::phase {

enum Id : unsigned { kPages = 0, kInputs = 1, kPhysics = 2, kReadback = 3, kPlan = 4, kBackend = 5, kAcquire = 6, kUpload = 7, kSubmit = 8, kCount = 9 };

#if defined(ENGINE_PHASE_TIMERS)

double& total(Id id);

class Scope {
 public:
  explicit Scope(Id id) : id_(id), start_(std::chrono::steady_clock::now()) {}
  Scope(const Scope&) = delete;
  Scope& operator=(const Scope&) = delete;
  ~Scope() {
    const std::chrono::duration<double, std::milli> elapsed = std::chrono::steady_clock::now() - start_;
    total(id_) += elapsed.count();
  }

 private:
  Id id_;
  std::chrono::steady_clock::time_point start_;
};

#else

class Scope {
 public:
  explicit Scope(Id) {}
};

#endif

}
