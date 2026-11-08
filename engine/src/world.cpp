#include <Jolt/Jolt.h>

#include <Jolt/Core/Factory.h>
#include <Jolt/Core/JobSystemSingleThreaded.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Body/BodyInterface.h>
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseLayer.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/PhysicsSettings.h>
#include <Jolt/Physics/PhysicsSystem.h>
#include <Jolt/RegisterTypes.h>

#include <algorithm>
#include <cstdlib>

#include "world.h"

namespace engine {

namespace {

constexpr JPH::ObjectLayer kLayerNonMoving = 0;
constexpr JPH::ObjectLayer kLayerMoving = 1;
constexpr JPH::uint kTempBytes = 4 * 1024 * 1024;
constexpr JPH::uint kMaxBodyPairs = 16384;
constexpr JPH::uint kMaxContactConstraints = 10240;
constexpr float kGroundHalfExtent = 4096.0f;
constexpr float kConvexRadius = 0.05f;

bool joltReady = false;
std::uint64_t allocations = 0;
std::uint64_t warmupBase = 0;

void silentTrace(const char*, ...) {}

void* countedAllocate(std::size_t size) {
  allocations += 1;
  return std::malloc(size);
}

void* countedReallocate(void* block, std::size_t, std::size_t newSize) {
  allocations += 1;
  return std::realloc(block, newSize);
}

void countedFree(void* block) {
  std::free(block);
}

void* countedAlignedAllocate(std::size_t size, std::size_t alignment) {
  allocations += 1;
  const std::size_t header = sizeof(void*);
  void* raw = std::malloc(size + alignment + header);
  if (raw == nullptr) return nullptr;
  const std::uintptr_t start = reinterpret_cast<std::uintptr_t>(raw) + header;
  const std::uintptr_t aligned = (start + alignment - 1) & ~(static_cast<std::uintptr_t>(alignment) - 1);
  reinterpret_cast<void**>(aligned)[-1] = raw;
  return reinterpret_cast<void*>(aligned);
}

void countedAlignedFree(void* block) {
  if (block == nullptr) return;
  std::free(reinterpret_cast<void**>(block)[-1]);
}

class BroadPhaseLayers final : public JPH::BroadPhaseLayerInterface {
 public:
  BroadPhaseLayers() {
    map_[kLayerNonMoving] = JPH::BroadPhaseLayer(0);
    map_[kLayerMoving] = JPH::BroadPhaseLayer(1);
  }

  JPH::uint GetNumBroadPhaseLayers() const override { return 2; }

  JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer layer) const override { return map_[layer]; }

 private:
  JPH::BroadPhaseLayer map_[2];
};

class ObjectVsBroadPhase final : public JPH::ObjectVsBroadPhaseLayerFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer layer, JPH::BroadPhaseLayer broad) const override {
    if (layer == kLayerNonMoving) return broad == JPH::BroadPhaseLayer(1);
    return true;
  }
};

class ObjectPairs final : public JPH::ObjectLayerPairFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer a, JPH::ObjectLayer b) const override {
    if (a == kLayerNonMoving) return b == kLayerMoving;
    return true;
  }
};

}

struct World::Runtime {
  BroadPhaseLayers broadPhase;
  ObjectVsBroadPhase objectVsBroadPhase;
  ObjectPairs objectPairs;
  JPH::TempAllocatorImpl temp{kTempBytes};
  JPH::JobSystemSingleThreaded jobs{JPH::cMaxPhysicsJobs};
  JPH::PhysicsSystem physics;
  JPH::ShapeRefC sphere;
  JPH::BodyID batch[kMaxBodies];
};

std::uint64_t allocationsTotal() {
  return allocations;
}

void markWarmup() {
  warmupBase = allocations;
}

std::uint64_t allocationsSinceWarmup() {
  return allocations - warmupBase;
}

World::~World() {
  delete runtime_;
}

Status World::initialize() {
  if (joltReady) return kOk;
  JPH::RegisterDefaultAllocator();
  JPH::Allocate = countedAllocate;
  JPH::Reallocate = countedReallocate;
  JPH::Free = countedFree;
  JPH::AlignedAllocate = countedAlignedAllocate;
  JPH::AlignedFree = countedAlignedFree;
  JPH::Trace = silentTrace;
  JPH::Factory::sInstance = new JPH::Factory();
  JPH::RegisterTypes();
  joltReady = true;
  return kOk;
}

Status World::configure(const Config& config) {
  if (config.capacity == 0 || config.capacity > kMaxBodies) return kRange;
  if (config.tickRate == 0) return kRange;
  if (config.iterations == 0 || config.iterations > kMaxIterations) return kRange;
  if (!(config.radius > 0.0f)) return kRange;
  if (!joltReady) return kNotConfigured;

  delete runtime_;
  runtime_ = new Runtime();
  capacity_ = config.capacity;
  statics_ = 0;
  live_ = 0;
  fresh_ = 0;
  freeCount_ = 0;
  tick_ = 0;
  tickRate_ = config.tickRate;
  drag_ = config.drag;
  restitution_ = config.restitution;
  std::fill(generations_, generations_ + kMaxBodies, static_cast<std::uint16_t>(0));
  std::fill(alive_, alive_ + kMaxBodies, static_cast<std::uint8_t>(0));

  runtime_->physics.Init(kMaxBodies + kMaxStatics + 1, 0, kMaxBodyPairs, kMaxContactConstraints,
                         runtime_->broadPhase, runtime_->objectVsBroadPhase, runtime_->objectPairs);
  runtime_->physics.SetGravity(JPH::Vec3(0.0f, config.gravity, 0.0f));
  JPH::PhysicsSettings settings = runtime_->physics.GetPhysicsSettings();
  settings.mNumVelocitySteps = config.iterations;
  runtime_->physics.SetPhysicsSettings(settings);

  runtime_->sphere = new JPH::SphereShape(config.radius);
  JPH::ShapeRefC ground = new JPH::BoxShape(JPH::Vec3(kGroundHalfExtent, 1.0f, kGroundHalfExtent), kConvexRadius);
  JPH::BodyCreationSettings groundSettings(ground.GetPtr(), JPH::RVec3(0.0f, -1.0f, 0.0f), JPH::Quat::sIdentity(),
                                           JPH::EMotionType::Static, kLayerNonMoving);
  runtime_->physics.GetBodyInterface().CreateAndAddBody(groundSettings, JPH::EActivation::DontActivate);
  return kOk;
}

Status World::addBox(const float* box) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (statics_ == kMaxStatics) return kTooManyStatics;
  const float halfX = (box[3] - box[0]) * 0.5f;
  const float halfY = (box[4] - box[1]) * 0.5f;
  const float halfZ = (box[5] - box[2]) * 0.5f;
  if (!(halfX > 0.0f && halfY > 0.0f && halfZ > 0.0f)) return kZeroThickness;
  const float radius = std::min(kConvexRadius, std::min(halfX, std::min(halfY, halfZ)));
  JPH::ShapeRefC shape = new JPH::BoxShape(JPH::Vec3(halfX, halfY, halfZ), radius);
  const JPH::RVec3 center((box[0] + box[3]) * 0.5f, (box[1] + box[4]) * 0.5f, (box[2] + box[5]) * 0.5f);
  JPH::BodyCreationSettings settings(shape.GetPtr(), center, JPH::Quat::sIdentity(), JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  statics_ += 1;
  return kOk;
}

int World::spawn(const float* position, const float* velocity) {
  const float row[kBatchFloats] = {position[0], position[1], position[2], velocity[0], velocity[1], velocity[2]};
  std::uint32_t handle = 0;
  const int status = spawnBatch(row, 1, &handle);
  if (status < 0) return status;
  return static_cast<int>(handle);
}

int World::spawnBatch(const float* rows, std::uint32_t count, std::uint32_t* handles) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (count > capacity_ - live_) return kFull;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  for (std::uint32_t i = 0; i < count; ++i) {
    const float* row = rows + i * kBatchFloats;
    const int slot = allocateSlot();
    if (slot < 0) return kFull;
    JPH::BodyCreationSettings settings(runtime_->sphere.GetPtr(), JPH::RVec3(row[0], row[1], row[2]), JPH::Quat::sIdentity(),
                                       JPH::EMotionType::Dynamic, kLayerMoving);
    settings.mRestitution = restitution_;
    settings.mLinearDamping = drag_;
    settings.mAllowSleeping = false;
    JPH::Body* body = bodies.CreateBody(settings);
    if (body == nullptr) return kFull;
    runtime_->batch[i] = body->GetID();
    bodyIds_[slot] = body->GetID().GetIndexAndSequenceNumber();
    alive_[slot] = 1;
    live_ += 1;
    handles[i] = (static_cast<std::uint32_t>(generations_[slot]) << 16) | static_cast<std::uint32_t>(slot);
  }
  if (count > 0) {
    const JPH::AddState state = bodies.AddBodiesPrepare(runtime_->batch, static_cast<int>(count));
    bodies.AddBodiesFinalize(runtime_->batch, static_cast<int>(count), state, JPH::EActivation::Activate);
  }
  for (std::uint32_t i = 0; i < count; ++i) {
    const float* row = rows + i * kBatchFloats;
    const std::uint32_t slot = handles[i] & kSlotMask;
    bodies.SetLinearVelocity(JPH::BodyID(bodyIds_[slot]), JPH::Vec3(row[3], row[4], row[5]));
    sync(slot);
  }
  return static_cast<int>(count);
}

Status World::despawn(std::uint32_t handle) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[slot]);
  bodies.RemoveBody(id);
  bodies.DestroyBody(id);
  alive_[slot] = 0;
  generations_[slot] = static_cast<std::uint16_t>(generations_[slot] + 1);
  freeSlots_[freeCount_] = static_cast<std::uint32_t>(slot);
  freeCount_ += 1;
  live_ -= 1;
  return kOk;
}

Status World::setPosition(std::uint32_t handle, const float* position) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  runtime_->physics.GetBodyInterface().SetPosition(JPH::BodyID(bodyIds_[slot]),
                                                   JPH::RVec3(position[0], position[1], position[2]), JPH::EActivation::Activate);
  sync(static_cast<std::uint32_t>(slot));
  return kOk;
}

Status World::setVelocity(std::uint32_t handle, const float* velocity) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  runtime_->physics.GetBodyInterface().SetLinearVelocity(JPH::BodyID(bodyIds_[slot]),
                                                         JPH::Vec3(velocity[0], velocity[1], velocity[2]));
  sync(static_cast<std::uint32_t>(slot));
  return kOk;
}

void World::step(std::uint32_t steps) {
  const float dt = 1.0f / static_cast<float>(tickRate_);
  for (std::uint32_t s = 0; s < steps; ++s) {
    if (runtime_ != nullptr) {
      runtime_->physics.Update(dt, 1, &runtime_->temp, &runtime_->jobs);
      for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
        if (alive_[slot] != 0) sync(slot);
      }
    }
    tick_ += 1;
  }
}

void World::setTick(std::uint64_t tick) {
  tick_ = tick;
}

int World::resolve(std::uint32_t handle) const {
  const std::uint32_t slot = handle & kSlotMask;
  if (slot >= fresh_ || alive_[slot] == 0) return -1;
  if (generations_[slot] != (handle >> 16)) return -1;
  return static_cast<int>(slot);
}

int World::allocateSlot() {
  if (freeCount_ > 0) {
    freeCount_ -= 1;
    return static_cast<int>(freeSlots_[freeCount_]);
  }
  if (fresh_ < capacity_) {
    const std::uint32_t slot = fresh_;
    fresh_ += 1;
    return static_cast<int>(slot);
  }
  return -1;
}

void World::sync(std::uint32_t slot) {
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[slot]);
  const JPH::RVec3 p = bodies.GetCenterOfMassPosition(id);
  const JPH::Vec3 v = bodies.GetLinearVelocity(id);
  const JPH::Quat q = bodies.GetRotation(id);
  double* position = positions_ + slot * 3;
  double* velocity = velocities_ + slot * 3;
  position[0] = p.GetX();
  position[1] = p.GetY();
  position[2] = p.GetZ();
  velocity[0] = v.GetX();
  velocity[1] = v.GetY();
  velocity[2] = v.GetZ();
  Transform& transform = transforms_[slot];
  transform.x = p.GetX();
  transform.y = p.GetY();
  transform.z = p.GetZ();
  transform.qx = q.GetX();
  transform.qy = q.GetY();
  transform.qz = q.GetZ();
  transform.qw = q.GetW();
}

World& world() {
  static World instance;
  return instance;
}

}
