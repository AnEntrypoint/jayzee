import * as THREE from 'three'

export function createVATMaterial(vatData, opts = {}) {
  const moveVatData = opts.moveVatData || null
  const mat = new THREE.MeshLambertMaterial({ color: opts.color ?? 0xd8b48c })
  const hasNormalVAT = !!(vatData.normalTexture || (moveVatData && moveVatData.normalTexture))
  mat._vatHasNormal = hasNormalVAT
  mat.customProgramCacheKey = () => `${moveVatData ? 'playerVAT-blend' : 'playerVAT'}${hasNormalVAT ? '_n' : ''}`
  mat.onBeforeCompile = shader => {
    shader.uniforms.vatTexture = { value: vatData.texture }
    shader.uniforms.vatWidth = { value: vatData.width }
    shader.uniforms.vatRowsPerFrame = { value: vatData.rowsPerFrame }
    shader.uniforms.vatFrameCount = { value: vatData.frameCount }
    shader.uniforms.vatHeight = { value: vatData.rowsPerFrame * vatData.frameCount }
    if (vatData.normalTexture) shader.uniforms.vatNormalTexture = { value: vatData.normalTexture }
    shader.vertexShader = 'attribute float vatVertexIndex;\n' + shader.vertexShader
    let uniformDecls = `#include <common>
      uniform highp sampler2D vatTexture;
      uniform float vatWidth;
      uniform float vatRowsPerFrame;
      uniform float vatFrameCount;
      uniform float vatHeight;
      ${vatData.normalTexture ? 'uniform highp sampler2D vatNormalTexture;' : ''}`
    if (moveVatData) {
      shader.uniforms.vatTexture2 = { value: moveVatData.texture }
      shader.uniforms.vatWidth2 = { value: moveVatData.width }
      shader.uniforms.vatRowsPerFrame2 = { value: moveVatData.rowsPerFrame }
      shader.uniforms.vatFrameCount2 = { value: moveVatData.frameCount }
      shader.uniforms.vatHeight2 = { value: moveVatData.rowsPerFrame * moveVatData.frameCount }
      if (moveVatData.normalTexture) shader.uniforms.vatNormalTexture2 = { value: moveVatData.normalTexture }
      uniformDecls += `
      uniform highp sampler2D vatTexture2;
      uniform float vatWidth2;
      uniform float vatRowsPerFrame2;
      uniform float vatFrameCount2;
      uniform float vatHeight2;
      ${moveVatData.normalTexture ? 'uniform highp sampler2D vatNormalTexture2;' : ''}`
    }
    const sampleClipFn = `
      void vatFrameUV(float width, float rowsPerFrame, float frameCount, float height, float phase, out vec2 uv0, out vec2 uv1, out float falpha) {
        float frame = mod(phase, 1.0) * (frameCount - 1.0);
        float f0 = floor(frame);
        float f1 = min(f0 + 1.0, frameCount - 1.0);
        falpha = frame - f0;
        float col = mod(vatVertexIndex, width);
        float rowInFrame = floor(vatVertexIndex / width);
        float row0 = f0 * rowsPerFrame + rowInFrame;
        float row1 = f1 * rowsPerFrame + rowInFrame;
        uv0 = vec2((col + 0.5) / width, (row0 + 0.5) / height);
        uv1 = vec2((col + 0.5) / width, (row1 + 0.5) / height);
      }
      vec3 vatSampleClip(sampler2D tex, float width, float rowsPerFrame, float frameCount, float height, float phase) {
        vec2 uv0, uv1; float falpha;
        vatFrameUV(width, rowsPerFrame, frameCount, height, phase, uv0, uv1, falpha);
        vec3 d0 = texture2D(tex, uv0).xyz;
        vec3 d1 = texture2D(tex, uv1).xyz;
        return mix(d0, d1, falpha);
      }`
    shader.vertexShader = shader.vertexShader.replace('#include <common>', uniformDecls + '\n' + sampleClipFn)
    const beginVertexBody = moveVatData
      ? `#include <begin_vertex>
      {
        vec3 deltaIdle = vatSampleClip(vatTexture, vatWidth, vatRowsPerFrame, vatFrameCount, vatHeight, vatIdlePhase);
        vec3 deltaMove = vatSampleClip(vatTexture2, vatWidth2, vatRowsPerFrame2, vatFrameCount2, vatHeight2, vatPhase);
        vec3 delta = mix(deltaIdle, deltaMove, clamp(vatBlend, 0.0, 1.0));
        transformed += delta;
      }`
      : `#include <begin_vertex>
      {
        vec3 delta = vatSampleClip(vatTexture, vatWidth, vatRowsPerFrame, vatFrameCount, vatHeight, vatPhase);
        transformed += delta;
      }`
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', beginVertexBody)
    if (hasNormalVAT) {
      const normalBody = moveVatData
        ? `#include <beginnormal_vertex>
        {
          vec3 nDeltaIdle = ${vatData.normalTexture ? 'vatSampleClip(vatNormalTexture, vatWidth, vatRowsPerFrame, vatFrameCount, vatHeight, vatIdlePhase)' : 'vec3(0.0)'};
          vec3 nDeltaMove = ${moveVatData.normalTexture ? 'vatSampleClip(vatNormalTexture2, vatWidth2, vatRowsPerFrame2, vatFrameCount2, vatHeight2, vatPhase)' : 'vec3(0.0)'};
          objectNormal += mix(nDeltaIdle, nDeltaMove, clamp(vatBlend, 0.0, 1.0));
        }`
        : `#include <beginnormal_vertex>
        {
          vec3 nDelta = vatSampleClip(vatNormalTexture, vatWidth, vatRowsPerFrame, vatFrameCount, vatHeight, vatPhase);
          objectNormal += nDelta;
        }`
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', normalBody)
    }
  }
  return mat
}
