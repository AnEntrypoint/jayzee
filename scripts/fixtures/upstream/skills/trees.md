# Trees

A tree is one geometry script you write (→geometry): bark tubes and a crown of twig-spray cards (→leaf-sprays).

```js
// scripts/tree.js: params { kind, h } (h: metres tall)
const SPECIES = {
  oak: { leaf: "broad", hue: 110, bark: "cdn/texture-oak-bark.png", base: 0.16, spread: 1.3, lobes: 9, trunk: 0.03, dome: 1 },
  birch: { leaf: "small", hue: 100, bark: "cdn/texture-white-birch-bark.png", base: 0.32, spread: 0.46, lobes: 8, trunk: 0.016 },
  fir: { leaf: "needle", hue: 140, bark: "cdn/texture-pine-bark.png", base: 0.08, spread: 0.42, trunk: 0.022, pow: 0.92, droop: 0.6 },
  pine: { leaf: "needle", hue: 135, bark: "cdn/texture-pine-bark.png", base: 0.28, spread: 0.42, trunk: 0.025, pow: 0.62, droop: 0.2 },
};
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const unit = (a) => add([0, 0, 0], a, 1 / (Math.hypot(...a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function geometry(ctx) {
  const sp = SPECIES[ctx.params.kind] ?? SPECIES.oak, H = ctx.params.h ?? 12, lod = ctx.lod, R = () => ctx.random();
  const r0 = H * sp.trunk, yb = H * sp.base, W = (H * sp.spread) / 2, c = [0, (yb + H) / 2, 0], r = [W, (H - yb) / 2, W];
  const uvs = [], normals = [];
  const quad = (P, N, U) => [[0, 1, 2], [0, 2, 3]].forEach((t) => { ctx.tri(...t.flatMap((k) => P[k])); t.forEach((k) => (normals.push(...N[k]), uvs.push(...U[k]))); });
  const tube = (path, rad, sides = 6) => path.slice(1).forEach((b, i) => {
    const a = path[i], ax = unit(add(b, a, -1)), s = unit(cross(ax, [0, 1, 0.01])), o = cross(ax, s);
    const d = (k, t = (k * 6.2832) / sides) => add(add([0, 0, 0], s, Math.cos(t)), o, Math.sin(t));
    for (let k = 0; k < sides; k++) {
      const d0 = d(k), d1 = d(k + 1), u0 = k / sides, u1 = (k + 1) / sides;
      quad([add(a, d1, rad[i]), add(b, d1, rad[i + 1]), add(b, d0, rad[i + 1]), add(a, d0, rad[i])], [d1, d1, d0, d0], [[u1, 0], [u1, 4], [u0, 4], [u0, 0]]);
    }
  });
  const cn = (p) => unit([(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1] + 0.35, (p[2] - c[2]) / r[2]]);
  // a card: foot at p, along up, front outward
  const card = (p, up, face, w, h) => {
    const m = cn(p), x = unit(cross(up, face)), e = (face[0] * m[0] + face[1] * m[1] + face[2] * m[2] < 0 ? -w : w) / 2, a = add(p, x, -e), b = add(p, x, e), P = [a, b, add(b, up, h), add(a, up, h)];
    quad(P, P.map(cn), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  };
  const hue = sp.hue + R() * 16 - 8, tint = (dl) => ctx.color(`oklch(${0.97 + dl} 0.02 ${hue})`);
  ctx.albedo(sp.bark);
  // sprays you write are 2 m, toward 3 m past an 18 m crown
  const size = (1.5 + lod / 2) * Math.max(1, Math.sqrt(W / 9)), leaves = `scripts/tex-leaves.js?kind=${sp.leaf}`;

  if (sp.droop) {
    tube([[0, -0.3, 0], [0, H / 2, 0], [0, H, 0]], [r0 * 1.4, r0 * 0.8, r0 * 0.15]);
    ctx.albedo(leaves);
    // drooping tiers whose boughs close each rim; near, a tilted cross card fills between tiers
    const tiers = Math.round((H - yb) / [0, 1.2, 1.6, 2.6, 4, 6][lod]);
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, rim = W * (1 - t) ** sp.pow + 0.4, per = Math.max(5, Math.ceil((4.8 * rim) / size));
      for (let j = 0; j < per; j++) {
        const a = ((j + R() * 0.6) / per) * 6.2832 + t * 3, out = unit([Math.cos(a), -sp.droop * (0.5 + R()), Math.sin(a)]), reach = rim * (0.8 + R() * 0.4);
        for (let k = 0, s = Math.min(size, reach); k < reach; k += s * 0.8) {
          const foot = add([0, yb + (H - yb) * t, 0], out, k);
          tint(-0.3 + 0.2 * t + R() * 0.08);
          card(foot, out, unit(add([0, 1, 0], out, 0.25)), s, s * 1.1);
          if (lod <= 2) tint(-0.3), card(foot, out, [-out[2], 0.58, out[0]], s, s);
        }
      }
    }
    if (lod >= 3) for (const k of [0, 1.05, 2.1]) card([0, yb, 0], [0, 1, 0], [Math.cos(k), 0, Math.sin(k)], W * 1.5, H - yb);
    return { uvs, normals };
  }

  tube([[0, -0.3, 0], [0, 0.4, 0], [0, yb, 0], [R() - 0.5, c[1], R() - 0.5]], [1.9, 1.15, 0.9, 0.45].map((k) => k * r0));
  // a big low lobe keeps the crown full from below
  const n = lod >= 4 ? Math.ceil(sp.lobes / 2) : sp.lobes, lw = W * 0.42, lv = r[1] * 0.5, lobes = [[0, H - lv, 0, 1], [0, c[1] - lv * 0.5, 0, 1.5]];
  for (let i = 1; i < n; i++) {
    const a = i * 2.4 + R() * 0.5, y = 1 - (i / (n - 1)) * 2, ring = (W - lw) * (sp.dome && y < 0 ? 1 : Math.sqrt(1 - y * y));
    const L = [Math.cos(a) * ring, c[1] + y * (r[1] - lv), Math.sin(a) * ring, 0.85 + R() * 0.3], t = R();
    const from = [0, yb * 0.95 + (c[1] - yb) * t * 0.6, 0], to = add(from, add(L, from, -1), 0.85);
    if (lod <= 3 && y < 0.64) tube([from, [to[0] * 0.4, to[1] - 0.2, to[2] * 0.4], to], [r0 * (0.6 - 0.25 * t), r0 * 0.35, r0 * 0.12], 5);
    lobes.push(L);
  }
  ctx.albedo(leaves);
  for (const L of lobes) {
    const w = lw * L[3], v = lv * L[3], cards = Math.ceil((3 / lod) * w * v);
    for (let j = 0; j < cards; j++) {
      const d = unit([R() * 2 - 1, R() * 2 - 1, R() * 2 - 1]), up = unit(add(d, [0, 1.5, 0])), s = size * (0.75 + R() * 0.5), q = 0.3 + 0.7 * Math.sqrt(R());
      tint(-0.36 + 0.26 * q + R() * 0.06);
      card(add(add(L, [d[0] * w, d[1] * v, d[2] * w], q), up, -s / 2), up, [d[0] + R() - 0.5, R() * 0.5, d[2] + R() - 0.5], s, s);
    }
  }
  return { uvs, normals };
}

export function collider(ctx) {
  const sp = SPECIES[ctx.params.kind] ?? SPECIES.oak, H = ctx.params.h ?? 12, r = H * sp.trunk, h = H * sp.base + 1;
  return { kind: "cylinder", radiusTop: r, radiusBottom: r * 1.3, height: h, center: [0, h / 2, 0] };
}
```

```js
// run_script: a wood. Each template has its own seed, so its copies share one mesh
const templates = [["oak", 14], ["birch", 13], ["fir", 19], ["pine", 16]].map(([kind, h], seed) => ({ primitive: { kind: "scripted", script: "scripts/tree.js", params: { kind, h }, seed }, material: { alphaTest: 0.5 }, physics: "static" }));
spawn("wood", { feetPosition: { x: 0, y: { terrain: 0 }, z: -60 }, scatter: { bounds: { shape: "circle", radius: 50 }, count: 110, seed: 7, variation: { scale: [0.8, 1.25], yaw: [0, 360] }, templates } });
```

- A species is a row; a new shape is a branch.
- A 12 m oak is 750 triangles at `ctx.lod` 1, 120 at 5. A far wood leaves physics off, so its bed draws every tree the device holds.