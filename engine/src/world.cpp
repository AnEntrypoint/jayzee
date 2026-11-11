#include "phase_timer.h"
#include <Jolt/Jolt.h>

#include <Jolt/Core/Factory.h>
#include <Jolt/Core/JobSystemSingleThreaded.h>
#if defined(ENGINE_THREADS)
#include <Jolt/Core/JobSystemThreadPool.h>
#endif
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Body/Body.h>
#include <Jolt/Physics/Character/CharacterVirtual.h>
#include <Jolt/Physics/Body/BodyInterface.h>
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseLayer.h>
#if defined(ENGINE_BROADPHASE_INTERVAL)
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseQuadTree.h>
#endif
#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Collision/CollideShape.h>
#include <Jolt/Physics/Collision/CollisionCollectorImpl.h>
#include <Jolt/Physics/Collision/CollisionDispatch.h>
#include <Jolt/Physics/Collision/NarrowPhaseQuery.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/ShapeCast.h>
#include <Jolt/Physics/Collision/ObjectLayer.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/PhysicsSettings.h>
#include <Jolt/Physics/PhysicsSystem.h>
#include <Jolt/RegisterTypes.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <new>

#include "arena.h"
#include <cstring>

#include "physics_origin.h"
#include "planet_frame.h"
#include "planet_shape.h"
#include "pool_alloc.h"
#include "vegetation.h"
#include "world.h"

namespace engine {

namespace {

#if !defined(ENGINE_MOVING_LAYERS)
#define ENGINE_MOVING_LAYERS 1
#endif

constexpr JPH::ObjectLayer kLayerNonMoving = 0;
constexpr JPH::ObjectLayer kLayerPlanet = 1;
constexpr JPH::ObjectLayer kLayerMoving = 2;
constexpr std::uint32_t kMovingLayers = ENGINE_MOVING_LAYERS;
constexpr JPH::ObjectLayer kLayerAirborne = static_cast<JPH::ObjectLayer>(kLayerMoving + kMovingLayers);
constexpr std::uint32_t kBroadLayerCount = kLayerMoving + kMovingLayers;
constexpr std::uint32_t kMinParallelRows = 1024;
constexpr std::uint8_t kAirNow = 1;
constexpr std::uint8_t kAirWanted = 2;
constexpr std::uint32_t kCeilingTicks = 4;
constexpr double kCeilingSlackMetres = 1.0;
constexpr double kAirMarginMetres = 0.1;
constexpr std::uint32_t kBroadphaseRebuildSteps = 4;

static_assert(kMovingLayers >= 1 && kMovingLayers <= 8);

JPH::ObjectLayer movingLayerOf(std::uint32_t slot) {
  return static_cast<JPH::ObjectLayer>(kLayerMoving + slot % kMovingLayers);
}

JPH::ObjectLayer airborneLayerOf(std::uint32_t slot) {
  return static_cast<JPH::ObjectLayer>(kLayerAirborne + slot % kMovingLayers);
}

constexpr bool isAirborneLayer(JPH::ObjectLayer layer) {
  return layer >= kLayerAirborne;
}
constexpr float kGroundHalfExtent = 4096.0f;
constexpr float kConvexRadius = 0.05f;

bool joltReady = false;
std::uint64_t warmupBase = 0;

void silentTrace(const char*, ...) {}

static_assert(sizeof(JPH::BodyID) == sizeof(std::uint32_t));

JPH::BodyID* asBodyIds(std::uint32_t* raw) {
  return reinterpret_cast<JPH::BodyID*>(raw);
}

template <typename T>
T* carveArray(std::size_t count) {
  return static_cast<T*>(arena::carve(sizeof(T) * count, alignof(T)));
}

class BroadPhaseLayers final : public JPH::BroadPhaseLayerInterface {
 public:
  JPH::uint GetNumBroadPhaseLayers() const override { return kBroadLayerCount; }

  JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer layer) const override {
    const JPH::ObjectLayer tree = isAirborneLayer(layer) ? static_cast<JPH::ObjectLayer>(layer - kMovingLayers) : layer;
    return JPH::BroadPhaseLayer(static_cast<JPH::BroadPhaseLayer::Type>(tree));
  }

#if defined(JPH_EXTERNAL_PROFILE) || defined(JPH_PROFILE_ENABLED)
  const char* GetBroadPhaseLayerName(JPH::BroadPhaseLayer layer) const override {
    return layer == JPH::BroadPhaseLayer(0) ? "non-moving" : layer == JPH::BroadPhaseLayer(1) ? "planet" : "moving";
  }
#endif
};

class ObjectVsBroadPhase final : public JPH::ObjectVsBroadPhaseLayerFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer layer, JPH::BroadPhaseLayer broad) const override {
    const bool fixedTree = broad == JPH::BroadPhaseLayer(0) || broad == JPH::BroadPhaseLayer(1);
    if (layer < kLayerMoving) return !fixedTree;
    if (isAirborneLayer(layer)) return broad != JPH::BroadPhaseLayer(1);
    return true;
  }
};

class ObjectPairs final : public JPH::ObjectLayerPairFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer a, JPH::ObjectLayer b) const override {
    if (a < kLayerMoving && b < kLayerMoving) return false;
    if (a == kLayerPlanet && isAirborneLayer(b)) return false;
    if (b == kLayerPlanet && isAirborneLayer(a)) return false;
    return true;
  }
};

}

struct World::Runtime {
  Runtime(std::uint64_t tempBytes, std::uint32_t workers)
      : temp(static_cast<std::size_t>(tempBytes)),
#if defined(ENGINE_THREADS)
        jobs(JPH::cMaxPhysicsJobs, JPH::cMaxPhysicsBarriers, static_cast<int>(workers) - 1)
#else
        jobs(JPH::cMaxPhysicsJobs)
#endif
  {
    static_cast<void>(workers);
  }

  BroadPhaseLayers broadPhase;
  ObjectVsBroadPhase objectVsBroadPhase;
  ObjectPairs objectPairs;
  JPH::TempAllocatorImpl temp;
#if defined(ENGINE_THREADS)
  JPH::JobSystemThreadPool jobs;
#else
  JPH::JobSystemSingleThreaded jobs;
#endif
  JPH::PhysicsSystem physics;
  JPH::CharacterVirtualSettings characterSettings;
  JPH::Ref<JPH::CharacterVirtual> characters[kMaxCharacters];
  JPH::Vec3 characterCommand[kMaxCharacters];
  JPH::Vec3 characterFall[kMaxCharacters];
  std::uint32_t characterCount = 0;
  float characterRadius = 0.0f;
  float characterHalfHeight = 0.0f;
  JPH::ShapeRefC sphere;
  JPH::ShapeRefC planetShape;
  JPH::ShapeRefC vegetationShape;
  JPH::BodyIDVector rebaseIds;
  const JPH::BodyID* activeIds = nullptr;
  float stepDt = 0.0f;
};

std::uint64_t allocationsTotal() {
  return arena::carves();
}

void markWarmup() {
  warmupBase = arena::carves();
}

std::uint64_t allocationsSinceWarmup() {
  return arena::carves() - warmupBase;
}

World::~World() {
  releaseRuntime();
}

void World::releaseRuntime() {
  if (runtime_ == nullptr) return;
  runtime_->~Runtime();
  pool::releaseAligned(runtime_);
  runtime_ = nullptr;
}

Status World::initialize() {
  if (joltReady) return kOk;
  JPH::RegisterDefaultAllocator();
  pool::installJoltHooks();
  JPH::Trace = silentTrace;
  JPH::Factory::sInstance = new JPH::Factory();
  JPH::RegisterTypes();
  planet::registerCollisions();
  vegetation::registerCollisions();
  joltReady = true;
  return kOk;
}

Status World::bind(const budget::Capacity& capacity) {
  if (bodyIds_ != nullptr) return kAlreadyInitialized;
  const std::size_t n = capacity.bodies;
  bodyIds_ = carveArray<std::uint32_t>(n);
  batch_ = carveArray<std::uint32_t>(n);
  freeSlots_ = carveArray<std::uint32_t>(n);
  generations_ = carveArray<std::uint16_t>(n);
  alive_ = carveArray<std::uint8_t>(n);
  positions_ = carveArray<double>(n * 3);
  velocities_ = carveArray<double>(n * 3);
  transforms_ = carveArray<Transform>(n);
  air_ = carveArray<std::uint8_t>(n);
  ceiling_ = carveArray<float>(n);
  if (bodyIds_ == nullptr || batch_ == nullptr || freeSlots_ == nullptr || generations_ == nullptr || alive_ == nullptr ||
      positions_ == nullptr || velocities_ == nullptr || transforms_ == nullptr || air_ == nullptr || ceiling_ == nullptr) {
    return kFull;
  }
  limits_ = capacity;
  return kOk;
}

Status World::configure(const Config& config) {
  if (arena::sealed()) return kSealed;
  if (config.capacity == 0 || config.capacity > limits_.bodies) return kRange;
  if (config.tickRate == 0) return kRange;
  if (config.iterations == 0 || config.iterations > kMaxIterations) return kRange;
  if (!(config.radius > 0.0f)) return kRange;
  if (!joltReady) return kNotConfigured;
  if (bodyIds_ == nullptr) return kNotConfigured;

  releaseRuntime();
  physicsOrigin() = PhysicsOrigin{};
  void* raw = pool::allocateAligned(sizeof(Runtime), alignof(Runtime));
  if (raw == nullptr) return kFull;
  runtime_ = new (raw) Runtime(limits_.tempBytes, limits_.workers);
  runtime_->jobs.CreateJob("warm", JPH::Color::sGreen, [] {}, 0);
  capacity_ = config.capacity;
  statics_ = 0;
  live_ = 0;
  retired_ = 0;
  fresh_ = 0;
  freeCount_ = 0;
  tick_ = 0;
  tickRate_ = config.tickRate;
  drag_ = config.drag;
  restitution_ = config.restitution;
  planetGravity_ = 0.0f;
  groundBody_ = kNoBody;
  planetBody_ = kNoBody;
  vegetationBody_ = kNoBody;
  trunkBodies_ = 0;
  std::fill(generations_, generations_ + limits_.bodies, static_cast<std::uint16_t>(0));
  std::fill(alive_, alive_ + limits_.bodies, static_cast<std::uint8_t>(0));
  std::fill(air_, air_ + limits_.bodies, static_cast<std::uint8_t>(0));
  std::fill(ceiling_, ceiling_ + limits_.bodies, std::numeric_limits<float>::quiet_NaN());
  radius_ = config.radius;

  runtime_->physics.Init(joltBodyCapacity(limits_), 0, joltPairCapacity(limits_), joltContactCapacity(limits_), runtime_->broadPhase,
                         runtime_->objectVsBroadPhase, runtime_->objectPairs);
  runtime_->physics.SetGravity(JPH::Vec3(0.0f, config.gravity, 0.0f));
  JPH::PhysicsSettings settings = runtime_->physics.GetPhysicsSettings();
  settings.mNumVelocitySteps = config.iterations;
  settings.mNumPositionSteps = config.iterations;
  settings.mPenetrationSlop = 0.0f;
  runtime_->physics.SetPhysicsSettings(settings);
  runtime_->rebaseIds.reserve(joltBodyCapacity(limits_));
  tuning_ = 0;
  if (applyTuning(kDefaultTuning) != kOk) return kRange;

  runtime_->sphere = new JPH::SphereShape(config.radius);
  JPH::ShapeRefC ground = new JPH::BoxShape(JPH::Vec3(kGroundHalfExtent, 1.0f, kGroundHalfExtent), kConvexRadius);
  JPH::BodyCreationSettings groundSettings(ground.GetPtr(), JPH::RVec3(0.0f, -1.0f, 0.0f), JPH::Quat::sIdentity(),
                                           JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID groundId = runtime_->physics.GetBodyInterface().CreateAndAddBody(groundSettings, JPH::EActivation::DontActivate);
  groundBody_ = groundId.GetIndexAndSequenceNumber();

  for (std::uint32_t slot = 0; slot < capacity_; ++slot) {
    JPH::BodyCreationSettings bodySettings(runtime_->sphere.GetPtr(), JPH::RVec3::sZero(), JPH::Quat::sIdentity(),
                                           JPH::EMotionType::Dynamic, movingLayerOf(slot));
    bodySettings.mRestitution = restitution_;
    bodySettings.mLinearDamping = drag_;
    bodySettings.mAllowSleeping = true;
    JPH::Body* body = runtime_->physics.GetBodyInterface().CreateBody(bodySettings);
    if (body == nullptr) return kFull;
    body->SetUserData(static_cast<JPH::uint64>(slot) + 1);
    bodyIds_[slot] = body->GetID().GetIndexAndSequenceNumber();
  }
  return kOk;
}

void World::removeBody(std::uint32_t index) {
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(index);
  bodies.RemoveBody(id);
  bodies.DestroyBody(id);
}

Status World::addBox(const double* box) {
  if (arena::sealed()) return kSealed;
  if (runtime_ == nullptr) return kNotConfigured;
  if (statics_ == limits_.statics) return kTooManyStatics;
  const double extentX = (box[3] - box[0]) * 0.5;
  const double extentY = (box[4] - box[1]) * 0.5;
  const double extentZ = (box[5] - box[2]) * 0.5;
  if (!(extentX > 0.0 && extentY > 0.0 && extentZ > 0.0)) return kZeroThickness;
  const float halfX = static_cast<float>(extentX);
  const float halfY = static_cast<float>(extentY);
  const float halfZ = static_cast<float>(extentZ);
  const float radius = std::min(kConvexRadius, std::min(halfX, std::min(halfY, halfZ)));
  JPH::ShapeRefC shape = new JPH::BoxShape(JPH::Vec3(halfX, halfY, halfZ), radius);
  follow((box[0] + box[3]) * 0.5, (box[1] + box[4]) * 0.5, (box[2] + box[5]) * 0.5);
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::RVec3 center(static_cast<float>((box[0] + box[3]) * 0.5 - o.x),
                          static_cast<float>((box[1] + box[4]) * 0.5 - o.y),
                          static_cast<float>((box[2] + box[5]) * 0.5 - o.z));
  JPH::BodyCreationSettings settings(shape.GetPtr(), center, JPH::Quat::sIdentity(), JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  statics_ += 1;
  return kOk;
}

Status World::configurePlanet(double radius, double cellSize, double gravity, double maxHeight) {
  if (arena::sealed()) return kSealed;
  if (runtime_ == nullptr) return kNotConfigured;
  if (!(gravity > 0.0)) return kRange;
  if (!planet::configure(planet::state(), radius, cellSize, maxHeight)) return kRange;
  if (groundBody_ != kNoBody) {
    removeBody(groundBody_);
    groundBody_ = kNoBody;
  }
  if (planetBody_ != kNoBody) {
    removeBody(planetBody_);
    planetBody_ = kNoBody;
  }
  runtime_->physics.SetGravity(JPH::Vec3::sZero());
  runtime_->planetShape = new planet::PlanetShape(planet::state(), static_cast<float>(radius + maxHeight));
  JPH::BodyCreationSettings settings(runtime_->planetShape.GetPtr(), JPH::RVec3::sZero(), JPH::Quat::sIdentity(),
                                     JPH::EMotionType::Static, kLayerPlanet);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  planetBody_ = id.GetIndexAndSequenceNumber();
  planetGravity_ = static_cast<float>(gravity);
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] != kSlotFree && alive_[slot] != kSlotHeld && !spawnAsleep_) runtime_->physics.GetBodyInterface().ActivateBody(JPH::BodyID(bodyIds_[slot]));
  }
  return kOk;
}

Status World::attachVegetation() {
  if (arena::sealed()) return kSealed;
  if (runtime_ == nullptr) return kNotConfigured;
  if (!vegetation::state().configured) return kNotConfigured;
  if (vegetationBody_ != kNoBody) return kOk;
  runtime_->vegetationShape = new vegetation::VegetationShape();
  JPH::BodyCreationSettings settings(runtime_->vegetationShape.GetPtr(), JPH::RVec3::sZero(), JPH::Quat::sIdentity(),
                                     JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  vegetationBody_ = id.GetIndexAndSequenceNumber();
  return kOk;
}

namespace {

JPH::RVec3 toBody(const double* p) {
  const PhysicsOrigin& o = physicsOrigin();
  return JPH::RVec3(static_cast<float>(p[0] - o.x), static_cast<float>(p[1] - o.y), static_cast<float>(p[2] - o.z));
}

constexpr JPH::uint kCharacterMaxHits = 32;

bool reserveContactBlocks(std::uint32_t characters) {
  const std::size_t smallest = sizeof(JPH::CharacterVirtual::Contact);
  const std::size_t largest = (kCharacterMaxHits + 1) * sizeof(JPH::CharacterVirtual::Contact) + alignof(JPH::CharacterVirtual::Contact) + sizeof(void*);
  constexpr std::uint32_t kSparesPerCharacter = 2;
  const std::uint32_t spares = kSparesPerCharacter * characters;
  void* held[pool::kClasses * kSparesPerCharacter * kMaxCharacters];
  std::uint32_t count = 0;
  bool complete = true;
  for (std::size_t bytes = smallest; count + spares <= pool::kClasses * kSparesPerCharacter * kMaxCharacters; bytes *= 2) {
    for (std::uint32_t spare = 0; spare < spares; ++spare) {
      held[count] = pool::allocate(std::min(bytes, largest));
      if (held[count] == nullptr) complete = false;
      count += 1;
    }
    if (bytes >= largest) break;
  }
  for (std::uint32_t i = 0; i < count; ++i) pool::release(held[i]);
  return complete;
}

}

int World::addCharacter(const double* spec) {
  if (arena::sealed()) return kSealed;
  if (runtime_ == nullptr) return kNotConfigured;
  if (!(spec[3] > 0.0) || !(spec[4] >= 0.0)) return kRange;
  Runtime& r = *runtime_;
  if (r.characterCount >= kMaxCharacters) return kFull;
  const float radius = static_cast<float>(spec[3]);
  const float halfHeight = static_cast<float>(spec[4]);
  if (r.characterCount == 0) {
    r.characterSettings.mMaxNumHits = kCharacterMaxHits;
    r.characterSettings.mShape = new JPH::CapsuleShape(halfHeight, radius);
    r.characterRadius = radius;
    r.characterHalfHeight = halfHeight;
  } else if (radius != r.characterRadius || halfHeight != r.characterHalfHeight) {
    return kRange;
  }
  const std::uint32_t index = r.characterCount;
  follow(spec[0], spec[1], spec[2]);
  r.characters[index] = new JPH::CharacterVirtual(&r.characterSettings, toBody(spec), JPH::Quat::sIdentity(), &r.physics);
  if (!reserveContactBlocks(index + 1)) return kFull;
  r.characterCount += 1;
  return static_cast<int>(index);
}

void World::setCharacterVelocity(std::uint32_t index, const float* velocity) {
  if (runtime_ == nullptr || index >= runtime_->characterCount) return;
  runtime_->characterCommand[index] = JPH::Vec3(velocity[0], velocity[1], velocity[2]);
}

bool World::characterSupported(std::uint32_t index) const {
  return runtime_ != nullptr && index < runtime_->characterCount && runtime_->characters[index]->IsSupported();
}

void World::characterPosition(std::uint32_t index, float* out) const {
  out[0] = out[1] = out[2] = 0.0f;
  if (runtime_ == nullptr || index >= runtime_->characterCount) return;
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::RVec3 at = runtime_->characters[index]->GetPosition();
  out[0] = static_cast<float>(at.GetX() + o.x);
  out[1] = static_cast<float>(at.GetY() + o.y);
  out[2] = static_cast<float>(at.GetZ() + o.z);
}

void World::characterBodyPosition(std::uint32_t index, float* out) const {
  out[0] = out[1] = out[2] = 0.0f;
  if (runtime_ == nullptr || index >= runtime_->characterCount) return;
  const JPH::RVec3 at = runtime_->characters[index]->GetPosition();
  out[0] = static_cast<float>(at.GetX());
  out[1] = static_cast<float>(at.GetY());
  out[2] = static_cast<float>(at.GetZ());
}

void World::updateCharacters(float dt) {
  if (runtime_ == nullptr) return;
  Runtime& r = *runtime_;
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::DefaultBroadPhaseLayerFilter broad(r.objectVsBroadPhase, kLayerMoving);
  const JPH::DefaultObjectLayerFilter object(r.objectPairs, kLayerMoving);
  for (std::uint32_t i = 0; i < r.characterCount; ++i) {
    JPH::Ref<JPH::CharacterVirtual>& c = r.characters[i];
    const JPH::RVec3 at = c->GetPosition();
    const double x = at.GetX() + o.x;
    const double y = at.GetY() + o.y;
    const double z = at.GetZ() + o.z;
    const double distance = std::sqrt(x * x + y * y + z * z);
    JPH::Vec3 gravity = JPH::Vec3::sZero();
    JPH::Vec3 up = JPH::Vec3::sAxisY();
    if (distance > 0.0) {
      const double scale = -static_cast<double>(planetGravity_) / distance;
      gravity = JPH::Vec3(static_cast<float>(x * scale), static_cast<float>(y * scale), static_cast<float>(z * scale));
      up = JPH::Vec3(static_cast<float>(x / distance), static_cast<float>(y / distance), static_cast<float>(z / distance));
    }
    c->SetUp(up);
    if (c->GetGroundState() == JPH::CharacterBase::EGroundState::OnGround) {
      r.characterFall[i] = gravity * dt;
    } else {
      r.characterFall[i] += gravity * dt;
    }
    JPH::CharacterVirtual::ExtendedUpdateSettings extended;
    extended.mStickToFloorStepDown = up * -characterStickDown_;
    extended.mWalkStairsStepUp = up * characterStepUp_;
    c->SetLinearVelocity(r.characterCommand[i] + r.characterFall[i]);
    c->ExtendedUpdate(dt, gravity, extended, broad, object, JPH::BodyFilter(), JPH::ShapeFilter(), r.temp);
  }
}

Status World::tuneCharacters(float stepUp, float stickDown) {
  if (!(stepUp >= 0.0f) || !(stickDown >= 0.0f)) return kRange;
  characterStepUp_ = stepUp;
  characterStickDown_ = stickDown;
  return kOk;
}

void World::classify(std::uint32_t joltBody, QueryHit& out) const {
  out.handle = 0;
  if (joltBody == planetBody_) {
    out.kind = kHitPlanet;
    return;
  }
  if (joltBody == vegetationBody_) {
    out.kind = kHitVegetation;
    return;
  }
  const JPH::uint64 tag = runtime_->physics.GetBodyInterfaceNoLock().GetUserData(JPH::BodyID(joltBody));
  if (tag == 0) {
    out.kind = kHitStatic;
    return;
  }
  const std::uint32_t slot = static_cast<std::uint32_t>(tag - 1);
  out.kind = kHitBody;
  out.handle = (static_cast<std::uint32_t>(generations_[slot]) << kSlotBits) | slot;
}

int World::castRay(const double* origin, const double* direction, QueryHit& out) {
  if (runtime_ == nullptr) return kNotConfigured;
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::RRayCast ray(toBody(origin), JPH::Vec3(static_cast<float>(direction[0]), static_cast<float>(direction[1]), static_cast<float>(direction[2])));
  JPH::RayCastResult hit;
  out.kind = kHitNone;
  out.handle = 0;
  if (!runtime_->physics.GetNarrowPhaseQueryNoLock().CastRay(ray, hit)) return 0;
  const JPH::RVec3 at = ray.GetPointOnRay(hit.mFraction);
  JPH::Vec3 normal = JPH::Vec3::sZero();
  const JPH::Body* body = runtime_->physics.GetBodyLockInterfaceNoLock().TryGetBody(hit.mBodyID);
  if (body != nullptr) normal = body->GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, at);
  out.fraction = hit.mFraction;
  out.position[0] = at.GetX() + o.x;
  out.position[1] = at.GetY() + o.y;
  out.position[2] = at.GetZ() + o.z;
  out.normal[0] = normal.GetX();
  out.normal[1] = normal.GetY();
  out.normal[2] = normal.GetZ();
  classify(hit.mBodyID.GetIndexAndSequenceNumber(), out);
  return 1;
}

int World::castRound(double radius, double halfHeight, const double* origin, const double* direction, QueryHit& out) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (!(radius > 0.0) || !(halfHeight >= 0.0)) return kRange;
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::RMat44 start = JPH::RMat44::sTranslation(toBody(origin));
  const JPH::Vec3 sweep(static_cast<float>(direction[0]), static_cast<float>(direction[1]), static_cast<float>(direction[2]));
  out.kind = kHitNone;
  out.handle = 0;
  auto sweepShape = [&](const JPH::Shape& shape) {
    shape.SetEmbedded();
    const JPH::RShapeCast cast(&shape, JPH::Vec3::sOne(), start, sweep);
    JPH::ClosestHitCollisionCollector<JPH::CastShapeCollector> collector;
    runtime_->physics.GetNarrowPhaseQueryNoLock().CastShape(cast, JPH::ShapeCastSettings(), JPH::RVec3::sZero(), collector);
    if (!collector.HadHit()) return 0;
    const JPH::ShapeCastResult& hit = collector.mHit;
    const JPH::Vec3 normal = -hit.mPenetrationAxis.NormalizedOr(JPH::Vec3::sZero());
    out.fraction = hit.mFraction;
    out.position[0] = hit.mContactPointOn2.GetX() + o.x;
    out.position[1] = hit.mContactPointOn2.GetY() + o.y;
    out.position[2] = hit.mContactPointOn2.GetZ() + o.z;
    out.normal[0] = normal.GetX();
    out.normal[1] = normal.GetY();
    out.normal[2] = normal.GetZ();
    classify(hit.mBodyID2.GetIndexAndSequenceNumber(), out);
    return 1;
  };
  if (halfHeight > 0.0) {
    const JPH::CapsuleShape capsule(static_cast<float>(halfHeight), static_cast<float>(radius));
    return sweepShape(capsule);
  }
  const JPH::SphereShape sphere(static_cast<float>(radius));
  return sweepShape(sphere);
}

int World::probePlanet(double radius, double halfHeight, bool planetFirst, double maxSeparation, const double* center, QueryHit& out) {
  if (runtime_ == nullptr || planetBody_ == kNoBody) return kNotConfigured;
  if (!(radius > 0.0) || !(halfHeight >= 0.0) || !(maxSeparation >= 0.0)) return kRange;
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::Mat44 at = JPH::Mat44::sTranslation(toBody(center));
  const JPH::Mat44 planetAt = JPH::Mat44::sIdentity();
  const JPH::Shape* planetShape = runtime_->planetShape.GetPtr();
  out.kind = kHitNone;
  out.handle = 0;
  auto probe = [&](const JPH::Shape& shape) {
    shape.SetEmbedded();
    JPH::CollideShapeSettings settings;
    settings.mMaxSeparationDistance = static_cast<float>(maxSeparation);
    JPH::ClosestHitCollisionCollector<JPH::CollideShapeCollector> collector;
    if (planetFirst) {
      JPH::CollisionDispatch::sCollideShapeVsShape(planetShape, &shape, JPH::Vec3::sOne(), JPH::Vec3::sOne(), planetAt, at,
                                                   JPH::SubShapeIDCreator(), JPH::SubShapeIDCreator(), settings, collector);
    } else {
      JPH::CollisionDispatch::sCollideShapeVsShape(&shape, planetShape, JPH::Vec3::sOne(), JPH::Vec3::sOne(), at, planetAt,
                                                   JPH::SubShapeIDCreator(), JPH::SubShapeIDCreator(), settings, collector);
    }
    if (!collector.HadHit()) return 0;
    const JPH::CollideShapeResult& hit = collector.mHit;
    const JPH::Vec3 onPlanet = planetFirst ? hit.mContactPointOn1 : hit.mContactPointOn2;
    const JPH::Vec3 axis = hit.mPenetrationAxis.NormalizedOr(JPH::Vec3::sZero());
    const JPH::Vec3 normal = planetFirst ? axis : -axis;
    out.fraction = hit.mPenetrationDepth;
    out.position[0] = onPlanet.GetX() + o.x;
    out.position[1] = onPlanet.GetY() + o.y;
    out.position[2] = onPlanet.GetZ() + o.z;
    out.normal[0] = normal.GetX();
    out.normal[1] = normal.GetY();
    out.normal[2] = normal.GetZ();
    out.kind = kHitPlanet;
    return 1;
  };
  if (halfHeight > 0.0) {
    const JPH::CapsuleShape capsule(static_cast<float>(halfHeight), static_cast<float>(radius));
    return probe(capsule);
  }
  const JPH::SphereShape sphere(static_cast<float>(radius));
  return probe(sphere);
}

Status World::addTrunk(const double* trunk) {
  if (arena::sealed()) return kSealed;
  if (runtime_ == nullptr) return kNotConfigured;
  if (trunkBodies_ == limits_.trunks) return kFull;
  if (!(trunk[3] > 0.0) || !(trunk[4] >= 0.0)) return kRange;
  JPH::ShapeRefC shape = new JPH::CapsuleShape(static_cast<float>(trunk[4]), static_cast<float>(trunk[3]));
  follow(trunk[0], trunk[1], trunk[2]);
  const JPH::RVec3 at = toBody(trunk);
  JPH::BodyCreationSettings settings(shape.GetPtr(), at, JPH::Quat::sIdentity(), JPH::EMotionType::Static, kLayerNonMoving);
  const JPH::BodyID id = runtime_->physics.GetBodyInterface().CreateAndAddBody(settings, JPH::EActivation::DontActivate);
  if (id.IsInvalid()) return kFull;
  trunkBodies_ += 1;
  return kOk;
}

std::int64_t World::spawn(const double* position, const double* velocity) {
  const double row[kBatchWords] = {position[0], position[1], position[2], velocity[0], velocity[1], velocity[2]};
  std::uint32_t handle = 0;
  const int status = spawnBatch(row, 1, &handle);
  if (status < 0) return status;
  return static_cast<std::int64_t>(handle);
}

int World::spawnBatch(const double* rows, std::uint32_t count, std::uint32_t* handles) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (count > capacity_ - live_ - retired_) return kFull;
  if (count > 0) follow(rows[0], rows[1], rows[2]);
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  JPH::BodyID* batch = asBodyIds(batch_);
  for (std::uint32_t i = 0; i < count; ++i) {
    const double* row = rows + i * kBatchWords;
    const int slot = allocateSlot();
    if (slot < 0) return kFull;
    const JPH::BodyID id(bodyIds_[slot]);
    bodies.SetPositionAndRotation(id, toBody(row), JPH::Quat::sIdentity(), JPH::EActivation::DontActivate);
    if ((air_[slot] & kAirNow) != 0) bodies.SetObjectLayer(id, movingLayerOf(static_cast<std::uint32_t>(slot)));
    air_[slot] = 0;
    ceiling_[slot] = std::numeric_limits<float>::quiet_NaN();
    batch[i] = id;
    alive_[slot] = kSlotAlive;
    live_ += 1;
    handles[i] = (static_cast<std::uint32_t>(generations_[slot]) << kSlotBits) | static_cast<std::uint32_t>(slot);
  }
  const std::uint32_t woken = wakeCount(count);
  if (woken > 0) {
    const JPH::BodyInterface::AddState state = bodies.AddBodiesPrepare(batch, static_cast<int>(woken));
    bodies.AddBodiesFinalize(batch, static_cast<int>(woken), state, JPH::EActivation::Activate);
  }
  if (woken < count && spawnAsleep_) {
    const JPH::BodyInterface::AddState state = bodies.AddBodiesPrepare(batch + woken, static_cast<int>(count - woken));
    bodies.AddBodiesFinalize(batch + woken, static_cast<int>(count - woken), state, JPH::EActivation::DontActivate);
  }
  const JPH::BodyLockInterfaceNoLock& locks = runtime_->physics.GetBodyLockInterfaceNoLock();
  for (std::uint32_t i = 0; i < count; ++i) {
    const double* row = rows + i * kBatchWords;
    const std::uint32_t slot = handles[i] & kSlotMask;
    const JPH::Vec3 launch(static_cast<float>(row[3]), static_cast<float>(row[4]), static_cast<float>(row[5]));
    if (i < woken) {
      bodies.SetLinearVelocity(JPH::BodyID(bodyIds_[slot]), launch);
    } else {
      JPH::Body* body = locks.TryGetBody(JPH::BodyID(bodyIds_[slot]));
      if (body != nullptr) body->SetLinearVelocityClamped(launch);
      if (!spawnAsleep_) {
        alive_[slot] = kSlotHeld;
        heldCursor_ = std::min(heldCursor_, slot);
      }
    }
    sync(slot);
    if (alive_[slot] == kSlotHeld) hide(slot);
  }
  return static_cast<int>(count);
}

Status World::despawn(std::uint32_t handle) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[slot]);
  if (alive_[slot] != kSlotHeld) bodies.RemoveBody(id);
  alive_[slot] = kSlotFree;
  live_ -= 1;
  if (generations_[slot] == kBodyLastGeneration) {
    generations_[slot] = kBodyRetiredGeneration;
    retired_ += 1;
    return kOk;
  }
  generations_[slot] = static_cast<std::uint16_t>(generations_[slot] + 1);
  freeSlots_[freeCount_] = static_cast<std::uint32_t>(slot);
  freeCount_ += 1;
  return kOk;
}

Status World::setPosition(std::uint32_t handle, const double* position) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  follow(position[0], position[1], position[2]);
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[slot]);
  if (alive_[slot] == kSlotHeld) {
    bodies.SetPosition(id, toBody(position), JPH::EActivation::DontActivate);
    bodies.AddBody(id, JPH::EActivation::Activate);
    alive_[slot] = kSlotAlive;
  } else {
    bodies.SetPosition(id, toBody(position), JPH::EActivation::Activate);
  }
  ceiling_[slot] = std::numeric_limits<float>::quiet_NaN();
  sync(static_cast<std::uint32_t>(slot));
  return kOk;
}

Status World::setVelocity(std::uint32_t handle, const float* velocity) {
  if (runtime_ == nullptr) return kNotConfigured;
  const int slot = resolve(handle);
  if (slot < 0) return kBadId;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  const JPH::BodyID id(bodyIds_[slot]);
  const JPH::Vec3 next(velocity[0], velocity[1], velocity[2]);
  if (alive_[slot] == kSlotHeld) {
    JPH::Body* body = runtime_->physics.GetBodyLockInterfaceNoLock().TryGetBody(id);
    if (body != nullptr) body->SetLinearVelocityClamped(next);
    bodies.AddBody(id, JPH::EActivation::Activate);
    alive_[slot] = kSlotAlive;
  } else {
    bodies.SetLinearVelocity(id, next);
  }
  sync(static_cast<std::uint32_t>(slot));
  return kOk;
}

Status World::follow(double x, double y, double z) {
  const PhysicsOrigin& o = physicsOrigin();
  const double dx = x - o.x;
  const double dy = y - o.y;
  const double dz = z - o.z;
  if (dx * dx + dy * dy + dz * dz <= kRebaseMetres * kRebaseMetres) return kOk;
  rebase(x, y, z);
  return kOk;
}

void World::rebase(double x, double y, double z) {
  PhysicsOrigin& o = physicsOrigin();
  rebases_ += 1;
  if (runtime_ != nullptr) {
    JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterfaceNoLock();
    const double shiftX = o.x - x;
    const double shiftY = o.y - y;
    const double shiftZ = o.z - z;
    auto shifted = [&](JPH::RVec3Arg at) {
      return JPH::RVec3(static_cast<float>(static_cast<double>(at.GetX()) + shiftX), static_cast<float>(static_cast<double>(at.GetY()) + shiftY),
                        static_cast<float>(static_cast<double>(at.GetZ()) + shiftZ));
    };
    runtime_->physics.GetBodies(runtime_->rebaseIds);
    for (const JPH::BodyID id : runtime_->rebaseIds) {
      const std::uint32_t index = id.GetIndexAndSequenceNumber();
      if (index == planetBody_ || index == vegetationBody_) continue;
      const JPH::uint64 tag = bodies.GetUserData(id);
      if (tag != 0 && alive_[tag - 1] != 0) {
        const double* anchor = positions_ + (tag - 1) * 3;
        bodies.SetPosition(id, JPH::RVec3(static_cast<float>(anchor[0] - x), static_cast<float>(anchor[1] - y), static_cast<float>(anchor[2] - z)),
                           JPH::EActivation::DontActivate);
      } else {
        bodies.SetPosition(id, shifted(bodies.GetPosition(id)), JPH::EActivation::DontActivate);
      }
    }
    for (std::uint32_t i = 0; i < runtime_->characterCount; ++i) {
      runtime_->characters[i]->SetPosition(shifted(runtime_->characters[i]->GetPosition()));
    }
  }
  o.x = x;
  o.y = y;
  o.z = z;
  if (runtime_ == nullptr) return;
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] == kSlotFree) continue;
    sync(slot);
    if (alive_[slot] == kSlotHeld) hide(slot);
  }
}

void World::pull(JPH::Body& body, std::uint32_t slot, const PhysicsOrigin& o, float dt) {
  constexpr float kSleepSpeed = 0.5f;
  const JPH::RVec3 position = body.GetCenterOfMassPosition();
  const double x = position.GetX() + o.x;
  const double y = position.GetY() + o.y;
  const double z = position.GetZ() + o.z;
  const double distance = std::sqrt(x * x + y * y + z * z);
  if (!(distance > 0.0)) return;
  const double scale = -static_cast<double>(planetGravity_) * dt / distance;
  body.SetLinearVelocityClamped(body.GetLinearVelocity() + JPH::Vec3(static_cast<float>(x * scale), static_cast<float>(y * scale), static_cast<float>(z * scale)));
  const float speed = body.GetLinearVelocity().Length();
  const bool mayRest = speed < kSleepSpeed;
  if (body.GetAllowSleeping() != mayRest) body.SetAllowSleeping(mayRest);
  if ((tuning_ & kTuneAirborne) == 0) return;
  float ceiling = ceiling_[slot];
  if (ceiling != ceiling || (tick_ + slot) % kCeilingTicks == 0) {
    const double horizon = static_cast<double>(dt) * kCeilingTicks;
    const double reach = (static_cast<double>(speed) + static_cast<double>(planetGravity_) * horizon) * horizon + radius_ + kCeilingSlackMetres;
    ceiling = static_cast<float>(planet::ceilingAt(planet::state(), x, y, z, reach));
    ceiling_[slot] = ceiling;
  }
  const double clearance = distance - planet::state().radius - static_cast<double>(ceiling) - radius_;
  const bool airborne = clearance > static_cast<double>(speed) * dt + kAirMarginMetres;
  air_[slot] = static_cast<std::uint8_t>((air_[slot] & kAirNow) | (airborne ? kAirWanted : 0));
}

void World::applyAirLayers() {
  if ((tuning_ & kTuneAirborne) == 0 || planetBody_ == kNoBody) return;
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterfaceNoLock();
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    const std::uint8_t flags = air_[slot];
    const bool now = (flags & kAirNow) != 0;
    const bool wanted = (flags & kAirWanted) != 0;
    if (now == wanted) continue;
    if (alive_[slot] == kSlotFree || alive_[slot] == kSlotHeld) {
      air_[slot] = now ? static_cast<std::uint8_t>(kAirNow | kAirWanted) : 0;
      continue;
    }
    bodies.SetObjectLayer(JPH::BodyID(bodyIds_[slot]), wanted ? airborneLayerOf(slot) : movingLayerOf(slot));
    air_[slot] = wanted ? static_cast<std::uint8_t>(kAirNow | kAirWanted) : 0;
  }
}

void World::gravityRange(std::uint32_t begin, std::uint32_t end) {
  const PhysicsOrigin& o = physicsOrigin();
  const JPH::BodyLockInterfaceNoLock& locks = runtime_->physics.GetBodyLockInterfaceNoLock();
  const JPH::BodyID* active = runtime_->activeIds;
  const float dt = runtime_->stepDt;
  for (std::uint32_t i = begin; i < end; ++i) {
    JPH::Body* body = locks.TryGetBody(active[i]);
    if (body == nullptr) continue;
    const JPH::uint64 tag = body->GetUserData();
    if (tag == 0 || alive_[tag - 1] == kSlotFree) continue;
    pull(*body, static_cast<std::uint32_t>(tag - 1), o, dt);
  }
}

void World::syncRange(std::uint32_t begin, std::uint32_t end) {
  const JPH::BodyLockInterfaceNoLock& locks = runtime_->physics.GetBodyLockInterfaceNoLock();
  const JPH::BodyID* active = runtime_->activeIds;
  const bool pullAfter = (tuning_ & kTuneGravityAfterStep) != 0 && planetBody_ != kNoBody;
  const PhysicsOrigin& o = physicsOrigin();
  for (std::uint32_t i = begin; i < end; ++i) {
    JPH::Body* body = locks.TryGetBody(active[i]);
    if (body == nullptr) continue;
    const JPH::uint64 tag = body->GetUserData();
    if (tag == 0 || alive_[tag - 1] == kSlotFree) continue;
    const std::uint32_t slot = static_cast<std::uint32_t>(tag - 1);
    sync(slot);
    alive_[slot] = kSlotAwakeSynced;
    if (pullAfter) pull(*body, slot, o, runtime_->stepDt);
  }
}

void World::forActiveRanges(std::uint32_t count, bool gravity) {
  const std::uint32_t lanes = static_cast<std::uint32_t>(runtime_->jobs.GetMaxConcurrency());
  if (lanes > 1 && count >= kMinParallelRows) {
    const std::uint32_t chunk = (count + lanes - 1) / lanes;
    JPH::JobSystem::Barrier* barrier = runtime_->jobs.CreateBarrier();
    for (std::uint32_t begin = 0; begin < count; begin += chunk) {
      const std::uint32_t end = std::min(count, begin + chunk);
      if (gravity) {
        barrier->AddJob(runtime_->jobs.CreateJob("gravity rows", JPH::Color::sWhite, [this, begin, end] { gravityRange(begin, end); }));
      } else {
        barrier->AddJob(runtime_->jobs.CreateJob("readback rows", JPH::Color::sWhite, [this, begin, end] { syncRange(begin, end); }));
      }
    }
    runtime_->jobs.WaitForJobs(barrier);
    runtime_->jobs.DestroyBarrier(barrier);
    return;
  }
  if (gravity) {
    gravityRange(0, count);
  } else {
    syncRange(0, count);
  }
}

void World::applyRadialGravity(JPH::PhysicsSystem& system, float dt) {
  if (runtime_ == nullptr || planetBody_ == kNoBody) return;
  runtime_->activeIds = system.GetActiveBodiesUnsafe(JPH::EBodyType::RigidBody);
  runtime_->stepDt = dt;
  forActiveRanges(system.GetNumActiveBodies(JPH::EBodyType::RigidBody), true);
}

std::uint32_t World::wakeCount(std::uint32_t count) const {
  if (spawnAsleep_) return 0;
  if (awakeBudget_ == 0) return count;
  if (heldCursor_ != kNoHeld) return 0;
  const std::uint32_t active = runtime_->physics.GetNumActiveBodies(JPH::EBodyType::RigidBody);
  return active >= awakeBudget_ ? 0 : std::min(count, awakeBudget_ - active);
}

void World::releaseHeld() {
  if (heldCursor_ == kNoHeld) return;
  const std::uint32_t active = runtime_->physics.GetNumActiveBodies(JPH::EBodyType::RigidBody);
  std::uint32_t room = awakeBudget_ == 0 ? fresh_ : (active >= awakeBudget_ ? 0 : awakeBudget_ - active);
  JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterface();
  JPH::BodyID* batch = asBodyIds(batch_);
  std::uint32_t released = 0;
  while (room > 0 && heldCursor_ < fresh_) {
    const std::uint32_t slot = heldCursor_;
    heldCursor_ += 1;
    if (alive_[slot] != kSlotHeld) continue;
    batch[released] = JPH::BodyID(bodyIds_[slot]);
    released += 1;
    alive_[slot] = kSlotAlive;
    room -= 1;
  }
  if (released > 0) {
    const JPH::BodyInterface::AddState state = bodies.AddBodiesPrepare(batch, static_cast<int>(released));
    bodies.AddBodiesFinalize(batch, static_cast<int>(released), state, JPH::EActivation::Activate);
    const JPH::BodyLockInterfaceNoLock& locks = runtime_->physics.GetBodyLockInterfaceNoLock();
    for (std::uint32_t i = 0; i < released; ++i) {
      const JPH::Body* body = locks.TryGetBody(batch[i]);
      if (body != nullptr) sync(static_cast<std::uint32_t>(body->GetUserData() - 1));
    }
  }
  if (heldCursor_ >= fresh_) heldCursor_ = kNoHeld;
}

Status World::setAwakeBudget(std::uint32_t bodies) {
  if (runtime_ == nullptr) return kNotConfigured;
  awakeBudget_ = bodies;
  return kOk;
}

Status World::setTuning(std::uint32_t flags) {
  if (runtime_ == nullptr) return kNotConfigured;
  return applyTuning(flags);
}

Status World::applyTuning(std::uint32_t flags) {
  if ((flags & ~kTuneAll) != 0) return kRange;
#if defined(ENGINE_BROADPHASE_INTERVAL)
  JPH::BroadPhaseQuadTree::sRebuildInterval = (flags & kTuneBroadphaseInterval) != 0 ? kBroadphaseRebuildSteps : 1;
#else
  if ((flags & kTuneBroadphaseInterval) != 0) return kRange;
#endif
  const bool wasAirborne = (tuning_ & kTuneAirborne) != 0;
  tuning_ = flags;
  JPH::PhysicsSettings settings = runtime_->physics.GetPhysicsSettings();
  settings.mUseLargeIslandSplitter = (flags & kTuneWholeIslands) == 0;
  runtime_->physics.SetPhysicsSettings(settings);
  if (wasAirborne && (flags & kTuneAirborne) == 0) {
    JPH::BodyInterface& bodies = runtime_->physics.GetBodyInterfaceNoLock();
    for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
      if ((air_[slot] & kAirNow) != 0) bodies.SetObjectLayer(JPH::BodyID(bodyIds_[slot]), movingLayerOf(slot));
      air_[slot] = 0;
    }
  }
  return kOk;
}

Status World::setSpawnAsleep(bool asleep) {
  if (runtime_ == nullptr) return kNotConfigured;
  spawnAsleep_ = asleep;
  return kOk;
}

Status World::setSleep(float seconds, float pointSpeed) {
  if (runtime_ == nullptr) return kNotConfigured;
  if (!(seconds > 0.0f) || !(pointSpeed > 0.0f)) return kRange;
  JPH::PhysicsSettings settings = runtime_->physics.GetPhysicsSettings();
  settings.mTimeBeforeSleep = seconds;
  settings.mPointVelocitySleepThreshold = pointSpeed;
  runtime_->physics.SetPhysicsSettings(settings);
  return kOk;
}

std::uint32_t World::airborneBodies() const {
  std::uint32_t airborne = 0;
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) airborne += (air_[slot] & kAirNow) != 0 && alive_[slot] != kSlotFree ? 1 : 0;
  return airborne;
}

std::uint32_t World::heldBodies() const {
  std::uint32_t held = 0;
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) held += alive_[slot] == kSlotHeld ? 1 : 0;
  return held;
}

void World::optimize() {
  if (runtime_ == nullptr) return;
  runtime_->physics.OptimizeBroadPhase();
}

void World::step(std::uint32_t steps) {
  const float dt = 1.0f / static_cast<float>(tickRate_);
  for (std::uint32_t s = 0; s < steps; ++s) {
    if (runtime_ != nullptr) {
      updateCharacters(dt);
      {
        engine::phase::Scope scope(engine::phase::kPhysics);
        releaseHeld();
        runtime_->stepDt = dt;
        if ((tuning_ & kTuneGravityAfterStep) == 0) applyRadialGravity(runtime_->physics, dt);
        applyAirLayers();
        runtime_->physics.Update(dt, 1, &runtime_->temp, &runtime_->jobs);
      }
      {
        engine::phase::Scope scope(engine::phase::kReadback);
        runtime_->activeIds = runtime_->physics.GetActiveBodiesUnsafe(JPH::EBodyType::RigidBody);
        forActiveRanges(runtime_->physics.GetNumActiveBodies(JPH::EBodyType::RigidBody), false);
        for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
          const std::uint8_t state = alive_[slot];
          if (state == kSlotAwakeSynced) {
            alive_[slot] = kSlotAlive;
          } else if (state == kSlotAlive) {
            sync(slot);
            alive_[slot] = kSlotAsleepSynced;
          }
        }
      }
    }
    tick_ += 1;
  }
}

Status World::applyPoses(const Transform* rows, std::uint32_t count) {
  if (transforms_ == nullptr || count != limits_.bodies) return kRange;
  std::memcpy(transforms_, rows, static_cast<std::size_t>(count) * sizeof(Transform));
  for (std::uint32_t slot = 0; slot < fresh_; ++slot) {
    if (alive_[slot] != kSlotFree && alive_[slot] != kSlotHeld) alive_[slot] = kSlotAlive;
  }
  return kOk;
}

void World::setTick(std::uint64_t tick) {
  tick_ = tick;
}

std::uint32_t World::physicsBodies() const {
  return runtime_ == nullptr ? 0 : runtime_->physics.GetNumBodies() - (capacity_ - live_);
}

std::uint32_t World::activeBodies() const {
  return runtime_ == nullptr ? 0 : runtime_->physics.GetNumActiveBodies(JPH::EBodyType::RigidBody);
}

int World::resolve(std::uint32_t handle) const {
  const std::uint32_t slot = handle & kSlotMask;
  if (slot >= fresh_ || alive_[slot] == 0) return -1;
  if (generations_[slot] != (handle >> kSlotBits)) return -1;
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

void World::hide(std::uint32_t slot) {
  Transform& transform = transforms_[slot];
  transform.qx = 0.0f;
  transform.qy = 0.0f;
  transform.qz = 0.0f;
  transform.qw = 0.0f;
}

void World::sync(std::uint32_t slot) {
  const JPH::Body* body = runtime_->physics.GetBodyLockInterfaceNoLock().TryGetBody(JPH::BodyID(bodyIds_[slot]));
  if (body == nullptr) return;
  const JPH::RVec3 p = body->GetPosition();
  const JPH::Vec3 v = body->GetLinearVelocity();
  const JPH::Quat q = body->GetRotation();
  const PhysicsOrigin& o = physicsOrigin();
  double* position = positions_ + slot * 3;
  double* velocity = velocities_ + slot * 3;
  const bool anchored = static_cast<float>(position[0] - o.x) == p.GetX() && static_cast<float>(position[1] - o.y) == p.GetY() &&
                        static_cast<float>(position[2] - o.z) == p.GetZ();
  if (!anchored) {
    position[0] = p.GetX() + o.x;
    position[1] = p.GetY() + o.y;
    position[2] = p.GetZ() + o.z;
  }
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
