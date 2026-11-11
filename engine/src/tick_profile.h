#pragma once
#if defined(ENGINE_TICK_PROFILE)
#include <Jolt/Jolt.h>
#include <Jolt/Core/Profiler.h>
#define ENGINE_PROFILE_JOIN2(a, b) a##b
#define ENGINE_PROFILE_JOIN(a, b) ENGINE_PROFILE_JOIN2(a, b)
#define ENGINE_PROFILE_SCOPE(name) JPH::ExternalProfileMeasurement ENGINE_PROFILE_JOIN(engineProfileScope, __LINE__)(name)
#else
#define ENGINE_PROFILE_SCOPE(name)
#endif
