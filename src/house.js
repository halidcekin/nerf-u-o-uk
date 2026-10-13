import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';
import { initAssets, pbrMaterial, loadModel } from './assets.js';

// 3+1 house, ~16 x 12 m. Origin = north-west outer corner, +x east, +z south.
//
//  z=0  ┌──────────┬─────────┬──────┬────────┐
//       │  Oda 1   │  Oda 2  │Banyo │ Ebeveyn│
//  z=5  ├──┤ ├─────┴───┤ ├───┴┤ ├──┴┤ ├─────┤
//       │            Koridor                 ▌kapı
//  z=6.6├────┘     └──────┬───┤ ├───────────┤
//       │     Salon       ║     Mutfak      │
//  z=12 └─────────────────┴─────────────────┘
//      x=0               9.5               16

export const H = 2.75;   // ceiling height
const T = 0.14;          // wall thickness
const DOOR_TOP = 2.08;

export async function buildHouse(scene, renderer) {
  if (renderer) initAssets(renderer);
  performance.mark('house:start');
  const root = new THREE.Group();
  root.name = 'house';
  scene.add(root);

  const colliders = [];   // world AABBs {minX,maxX,minY,maxY,minZ,maxZ}
  const hitMeshes = [];   // meshes darts can hit
  const lamps = [];       // { light, mat }
  const targetSpots = []; // { pos, normal }
  const canSpots = [];    // { x, y, z, axis }

  // ---------- materials ----------
  const std = (p, surface) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, ...p });
    m.userData.surface = surface;
    return m;
  };
  // Poly Haven PBR sets (see scripts/fetch-polyhaven.mjs). size = real-world metres per texture tile.
  const fab = (id, o = {}) => pbrMaterial(id, { fallback: 0xb4b0a8, size: 0.27, res: {}, surface: 'soft', roughness: 1, normalScale: 0.8, ...o });
  const [wallM, floorM, tileFloor, tileBath, oakM, walnutM, fSheet, fBlue, fGreen, fBeige, fMustard, fTeal, fWaffle, fRunner, fShag] = await Promise.all([
    pbrMaterial('white_stucco', { fallback: 0xe4e0da, size: 2.0, surface: 'wall', roughness: 0.95, normalScale: 0.35 }),
    pbrMaterial('laminate_floor_02', { fallback: 0x9b7a58, size: 1.7, res: { diff: '2k', nor: '1k', arm: '1k' }, surface: 'wood', normalScale: 0.8 }),
    pbrMaterial('marble_01', { fallback: 0xcdbd98, size: 1.5, surface: 'tile', normalScale: 0.6 }),
    pbrMaterial('granite_tile', { fallback: 0x3a3a3c, size: 2.3, surface: 'tile', roughness: 0.75, normalScale: 0.6, color: 0xd8d8d8 }),
    pbrMaterial('oak_veneer_02', { fallback: 0xd9b78d, size: 1.0, surface: 'wood', normalScale: 0.5 }),
    pbrMaterial('black_walnut_veneer_02', { fallback: 0x7a5a42, size: 1.0, surface: 'wood', normalScale: 0.6 }),
    fab('jogging_melange'), fab('rough_linen'), fab('ribbed_corduroy'), fab('terlenka'),
    fab('bi_stretch'), fab('scuba_suede'), fab('waffle_pique_cotton', { size: 0.28 }), fab('jersey_melange', { size: 0.29 }),
    fab('curly_teddy_natural', { size: 0.33, normalScale: 1.2 }),
  ]);
  performance.mark('house:materials');
  const tint = (m, color) => { const c = m.clone(); c.color.set(color); c.userData = { ...m.userData }; return c; };

  const M = {
    wall: wallM,
    wallKid: tint(wallM, 0xa9cfe6),
    ceiling: std({ color: 0xf6f4f0, roughness: 0.95 }, 'wall'),
    parquet: floorM,
    tileFloor,
    tileBath,
    trim: std({ color: 0xf7f6f2, roughness: 0.45 }, 'wood'),
    frame: std({ color: 0xf2f2f0, roughness: 0.35 }, 'plastic'),
    glass: (() => {
      const m = new THREE.MeshStandardMaterial({ color: 0xdfeff5, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false });
      m.userData.surface = 'glass'; return m;
    })(),
    oak: oakM,
    walnut: walnutM,
    lacquer: std({ color: 0xf3f1ec, roughness: 0.3 }, 'wood'),
    lacquerGrey: std({ color: 0x5d6670, roughness: 0.35 }, 'wood'),
    sofa: tint(fSheet, 0xd2d6dc),
    sofaDark: tint(fSheet, 0xb4b9c0),
    cushionMustard: fMustard,
    cushionTeal: fTeal,
    sheet: fSheet,
    duvetBlue: fBlue,
    duvetGreen: fGreen,
    duvetBeige: fBeige,
    rug: fShag,
    rugKid: fWaffle,
    runner: fRunner,
    chrome: std({ color: 0xd8dadc, metalness: 1, roughness: 0.12 }, 'metal'),
    steel: std({ color: 0xb9bcbf, metalness: 1, roughness: 0.32 }, 'metal'),
    black: std({ color: 0x15171a, roughness: 0.25 }, 'plastic'),
    blackMatte: std({ color: 0x1d1f22, roughness: 0.7 }, 'plastic'),
    ceramic: std({ color: 0xfbfbfa, roughness: 0.08 }, 'tile'),
    mirror: std({ color: 0xffffff, metalness: 1, roughness: 0.02 }, 'glass'),
    water: std({ color: 0x9fc9d6, roughness: 0.05, metalness: 0.1 }, 'tile'),
    toyRed: std({ color: 0xd8342a, roughness: 0.4 }, 'plastic'),
    toyYellow: std({ color: 0xf2c230, roughness: 0.4 }, 'plastic'),
    toyBlue: std({ color: 0x2d68d8, roughness: 0.4 }, 'plastic'),
    toyGreen: std({ color: 0x3aa655, roughness: 0.4 }, 'plastic'),
    tv: (() => { const m = std({ color: 0x111111, roughness: 0.15, emissive: 0xffffff, emissiveIntensity: 0.55 }, 'glass'); m.emissiveMap = TX.tvScreen(); return m; })(),
    lampShade: std({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 0.6, roughness: 0.8 }, 'soft'),
    fixture: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d8, emissiveIntensity: 1.6, roughness: 0.5 }),
  };
  M.fixture.userData.surface = 'plastic';
  const books = [0xb03a2e, 0x1f618d, 0x117a65, 0xd4ac0d, 0x6c3483, 0xca6f1e, 0x2e4053, 0xf0ece2].map(c => std({ color: c, roughness: 0.7 }, 'soft'));

  // ---------- helpers ----------
  // box-projected UVs in metres: one texture tile = `scale` metres, continuous across neighbouring boxes
  function worldUV(geo, scale, ox, oy, oz) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + ox, y = p.getY(i) + oy, z = p.getZ(i) + oz;
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      if (ax >= ay && ax >= az) uv.setXY(i, z / scale, y / scale);
      else if (ay >= az) uv.setXY(i, x / scale, z / scale);
      else uv.setXY(i, x / scale, y / scale);
    }
    uv.needsUpdate = true;
  }
  const aabbOf = (obj) => {
    const b = new THREE.Box3().setFromObject(obj);
    return { minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y, minZ: b.min.z, maxZ: b.max.z };
  };
  function finish(m, { cast = true, hit = true, collide = false } = {}) {
    m.castShadow = cast; m.receiveShadow = true;
    root.add(m);
    if (hit) hitMeshes.push(m);
    if (collide) { m.updateMatrixWorld(true); colliders.push(aabbOf(m)); }
    return m;
  }
  // world-space box given min/max corners. Textured materials get world-space UVs automatically (opts.uv overrides the tile size).
  function wbox(x0, x1, y0, y1, z0, z1, mat, opts = {}) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return null;
    const geo = new THREE.BoxGeometry(w, h, d);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const tile = opts.uv ?? mat.userData.texSize;
    if (tile) worldUV(geo, tile, cx, cy, cz);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, cy, cz);
    return finish(m, opts);
  }
  // slab along a wall line: axis 'x' => runs along x at z=fixed
  function slab(axis, fixed, a, b, y0, y1, depth, mat, opts) {
    return axis === 'x'
      ? wbox(a, b, y0, y1, fixed - depth / 2, fixed + depth / 2, mat, opts)
      : wbox(fixed - depth / 2, fixed + depth / 2, y0, y1, a, b, mat, opts);
  }

  // ---------- walls ----------
  function wallSeg(axis, fixed, a, b, y0, y1, mat = M.wall) {
    if (b - a < 0.005 || y1 - y0 < 0.005) return;
    slab(axis, fixed, a, b, y0, y1, T, mat, { collide: true });
    if (y0 === 0) slab(axis, fixed, a, b, 0, 0.09, T + 0.026, M.trim, { cast: false });
  }
  function addWindow(axis, fixed, a, b, sill, top) {
    const fw = 0.055, fd = T + 0.02;
    slab(axis, fixed, a, b, sill - 0.03, sill, T + 0.1, M.tileFloor);        // stone sill ledge
    slab(axis, fixed, a, b, top - fw, top, fd, M.frame);                     // head
    slab(axis, fixed, a, a + fw, sill, top, fd, M.frame);                    // jambs
    slab(axis, fixed, b - fw, b, sill, top, fd, M.frame);
    slab(axis, fixed, a, b, sill, sill + fw, fd, M.frame);
    if (b - a > 1.1) { const c = (a + b) / 2; slab(axis, fixed, c - fw / 2, c + fw / 2, sill, top, fd, M.frame); }
    slab(axis, fixed, a, b, sill, top, 0.012, M.glass, { cast: false, collide: true });
  }
  function addCasing(axis, fixed, a, b, top) {
    const cw = 0.07, cd = T + 0.03;
    slab(axis, fixed, a - cw, a, 0, top + cw, cd, M.trim, { cast: false });
    slab(axis, fixed, b, b + cw, 0, top + cw, cd, M.trim, { cast: false });
    slab(axis, fixed, a - cw, b + cw, top, top + cw, cd, M.trim, { cast: false });
  }
  function wall(axis, fixed, a, b, openings = [], mat = M.wall) {
    let cur = a - T / 2;
    const end = b + T / 2;
    for (const o of [...openings].sort((p, q) => p.c - q.c)) {
      const oa = o.c - o.w / 2, ob = o.c + o.w / 2;
      const sill = o.sill ?? 0, top = o.top ?? DOOR_TOP;
      wallSeg(axis, fixed, cur, oa, 0, H, mat);
      if (sill > 0) wallSeg(axis, fixed, oa, ob, 0, sill, mat);
      wallSeg(axis, fixed, oa, ob, top, H, mat);
      if (o.win) addWindow(axis, fixed, oa, ob, sill, top);
      else if (!o.bare) addCasing(axis, fixed, oa, ob, top);
      cur = ob;
    }
    wallSeg(axis, fixed, cur, end, 0, H, mat);
  }
  const win = (c, w, sill = 0.9, top = 2.25) => ({ c, w, sill, top, win: true });
  const door = (c, w = 0.9) => ({ c, w });

  // exterior
  wall('x', 0, 0, 16, [win(2.75, 1.4), win(7.75, 1.4), win(11.25, 0.7, 1.55, 2.2), win(14.25, 1.4)]);
  wall('x', 12, 0, 16, [win(2.5, 2.2, 0.45, 2.35), win(6.8, 2.2, 0.45, 2.35), win(12.75, 1.6, 1.05, 2.25)]);
  wall('z', 0, 0, 12, [win(2.5, 1.2)]);
  wall('z', 16, 0, 12, [win(2.5, 1.2), door(5.8, 1.0), win(9.3, 1.2, 1.05, 2.25)]);
  // interior
  wall('x', 5, 0, 16, [door(4.6), door(9.1), door(11.3, 0.8), door(13.3)]);
  wall('z', 5.5, 0, 5);
  wall('z', 10, 0, 5);
  wall('z', 12.5, 0, 5);
  wall('x', 6.6, 0, 16, [{ c: 4.75, w: 4.5, top: 2.4 }, door(12.6, 1.0)]);
  wall('z', 9.5, 6.6, 12, [{ c: 9.3, w: 1.4, top: 2.1 }]);

  // kid room accent wall (thin paint panel on inner face of north wall, west of window)
  wbox(0.07, 2.03, 0.09, H, T / 2, T / 2 + 0.004, M.wallKid, { cast: false });
  wbox(3.47, 5.43, 0.09, H, T / 2, T / 2 + 0.004, M.wallKid, { cast: false });
  wbox(2.03, 3.47, 0.09, 0.87, T / 2, T / 2 + 0.004, M.wallKid, { cast: false });
  wbox(2.03, 3.47, 2.25, H, T / 2, T / 2 + 0.004, M.wallKid, { cast: false });

  // front door leaf
  {
    const x = 16, a = 5.3, b = 6.3;
    wbox(x - 0.03, x + 0.03, 0, DOOR_TOP, a, b, M.walnut, { collide: true });
    wbox(x - 0.075, x - 0.03, 1.0, 1.03, 5.4, 5.55, M.chrome);
    wbox(x - 0.06, x - 0.03, 0.95, 1.05, 5.42, 5.46, M.chrome);
    wbox(x - 0.036, x - 0.03, 1.55, 1.58, 5.78, 5.82, M.chrome); // peephole
  }

  // ---------- floors & ceiling ----------
  const floor = (x0, x1, z0, z1, mat) => wbox(x0, x1, -0.05, 0, z0, z1, mat, { cast: false });
  floor(0, 10, 0, 5, M.parquet);
  floor(10, 12.5, 0, 5, M.tileBath);
  floor(12.5, 16, 0, 5, M.parquet);
  floor(0, 16, 5, 6.6, M.parquet);
  floor(0, 9.5, 6.6, 12, M.parquet);
  floor(9.5, 16, 6.6, 12, M.tileFloor);
  wbox(-T / 2, 16 + T / 2, H, H + 0.14, -T / 2, 12 + T / 2, M.ceiling, { uv: 3 });
  // bath wall tiles (light stone above a dark granite floor)
  wbox(10 + T / 2, 12.5 - T / 2, 0, 1.5, T / 2, T / 2 + 0.008, M.tileFloor, { cast: false });
  wbox(10 + T / 2, 10 + T / 2 + 0.008, 0, 2.1, T / 2, 5 - T / 2, M.tileFloor, { cast: false });
  wbox(12.5 - T / 2 - 0.008, 12.5 - T / 2, 0, 2.1, T / 2, 5 - T / 2, M.tileFloor, { cast: false });

  // ---------- lights ----------
  // Emissive ceiling fixtures everywhere (one shared material => one draw call); only 4 real point lights (no shadows).
  const fixtureGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.05, 32);
  function fixture(x, z) {
    const m = new THREE.Mesh(fixtureGeo, M.fixture);
    m.position.set(x, H - 0.025, z);
    root.add(m);
  }
  function pointLamp(x, z, intensity) {
    const light = new THREE.PointLight(0xffe0bc, intensity, 0, 2);
    light.position.set(x, 1.95, z);
    root.add(light);
    lamps.push({ light, mat: M.fixture, on: intensity });
  }
  for (const [x, z] of [[2.75, 2.5], [7.75, 2.5], [11.25, 2.5], [14.25, 2.5], [4, 5.8], [12, 5.8], [2.6, 9.3], [12.75, 9.3]]) fixture(x, z);
  pointLamp(3.0, 2.6, 3);      // kid room (bleeds into room 2 / corridor)
  pointLamp(11.6, 3.0, 3);     // bathroom / master bedroom
  pointLamp(4.6, 9.3, 3.5);      // salon
  pointLamp(12.5, 9.3, 3);     // kitchen
  const pendantAt = { x: 7.2, z: 9.8 };

  // ---------- furniture (procedural) ----------
  function piece(x, z, rotY, build, { collide = true, y = 0 } = {}) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    const textured = (mat, px, py, pz, geo) => { if (mat.userData.texSize) worldUV(geo, mat.userData.texSize, px, py, pz); return geo; };
    const B = (w, h, d, mat, px, py, pz, o = {}) => {
      const r = o.r ? Math.min(o.r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3) : 0;
      const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
      textured(mat, px, py + h / 2, pz, geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py + h / 2, pz);
      if (o.rx) m.rotation.x = o.rx;
      if (o.ry) m.rotation.y = o.ry;
      if (o.rz) m.rotation.z = o.rz;
      g.add(m);
      return m;
    };
    const C = (rt, rb, h, mat, px, py, pz, seg = 20) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
      m.position.set(px, py + h / 2, pz);
      g.add(m);
      return m;
    };
    const S = (r, mat, px, py, pz, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
      m.position.set(px, py, pz); m.scale.set(sx, sy, sz);
      g.add(m);
      return m;
    };
    build({ B, C, S, g });
    root.add(g);
    g.updateMatrixWorld(true);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; hitMeshes.push(o); } });
    if (collide) colliders.push(aabbOf(g));
    return g;
  }
  const legs4 = (B, w, d, h, mat, s = 0.04, inset = 0.04) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(s, h, s, mat, sx * (w / 2 - inset), 0, sz * (d / 2 - inset));
  };

  // local convention: front faces +z, back at -z
  const sofa = (x, z, rot, w = 2.4) => piece(x, z, rot, ({ B }) => {
    B(w, 0.1, 0.9, M.blackMatte, 0, 0.03, 0);
    B(w, 0.3, 0.92, M.sofaDark, 0, 0.12, 0, { r: 0.04 });
    B(w - 0.06, 0.48, 0.24, M.sofa, 0, 0.38, -0.34, { r: 0.08 });
    for (const s of [-1, 1]) B(0.2, 0.62, 0.92, M.sofa, s * (w / 2 - 0.1), 0.12, 0, { r: 0.07 });
    const n = 3, cw = (w - 0.4) / n;
    for (let i = 0; i < n; i++) B(cw - 0.02, 0.14, 0.66, M.sofa, -w / 2 + 0.2 + cw * (i + 0.5), 0.42, 0.1, { r: 0.06 });
    for (let i = 0; i < n; i++) B(cw - 0.04, 0.4, 0.16, M.sofa, -w / 2 + 0.2 + cw * (i + 0.5), 0.55, -0.2, { r: 0.07, rx: -0.12 });
    B(0.42, 0.38, 0.12, M.cushionMustard, -w / 2 + 0.42, 0.56, -0.08, { r: 0.05, rz: 0.15, rx: -0.2 });
    B(0.4, 0.36, 0.12, M.cushionTeal, w / 2 - 0.42, 0.56, -0.08, { r: 0.05, rz: -0.12, rx: -0.2 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(0.04, 0.03, 0.04, M.walnut, sx * (w / 2 - 0.08), 0, sz * 0.38);
  });
  const tvOnUnit = (x, z, rot, top) => piece(x, z, rot, ({ B }) => {   // TV + stand on top of the sideboard model (top = its height)
    B(0.4, 0.03, 0.22, M.black, 0, top, 0.0);
    B(0.06, 0.15, 0.06, M.black, 0, top, -0.05);
    B(1.48, 0.86, 0.04, M.black, 0, top + 0.15, -0.02, { r: 0.008 });
    B(1.42, 0.8, 0.005, M.tv, 0, top + 0.18, 0.0);
    B(0.12, 0.6, 0.12, M.blackMatte, -0.85, top, 0.0, { r: 0.02 });
    B(0.12, 0.6, 0.12, M.blackMatte, 0.85, top, 0.0, { r: 0.02 });
  }, { collide: false });
  const diningTable = (x, z, rot) => piece(x, z, rot, ({ B }) => {
    B(1.6, 0.045, 0.9, M.walnut, 0, 0.73, 0, { r: 0.01 });
    B(1.5, 0.08, 0.8, M.walnut, 0, 0.66, 0);
    legs4(B, 1.6, 0.9, 0.73, M.walnut, 0.06, 0.08);
  });
  const bed = (x, z, rot, w, duvet) => piece(x, z, rot, ({ B }) => {
    B(w + 0.08, 0.28, 2.08, M.oak, 0, 0.06, 0, { r: 0.02 });
    B(w + 0.08, 0.95, 0.06, M.oak, 0, 0.06, -1.04, { r: 0.02 });
    B(w, 0.2, 2.0, M.sheet, 0, 0.32, 0, { r: 0.06 });
    B(w + 0.04, 0.09, 1.45, duvet, 0, 0.5, 0.3, { r: 0.04 });
    B(w + 0.06, 0.16, 0.25, duvet, 0, 0.47, 1.0, { r: 0.07 });
    const np = w > 1.2 ? 2 : 1;
    for (let i = 0; i < np; i++) B(Math.min(0.6, w - 0.12), 0.13, 0.36, M.sheet, np === 1 ? 0 : (i - 0.5) * (w / 2), 0.53, -0.76, { r: 0.06, rx: -0.15 });
    legs4(B, w + 0.04, 2.04, 0.06, M.walnut, 0.05);
  });
  const wardrobe = (x, z, rot, w = 1.2) => piece(x, z, rot, ({ B }) => {
    B(w, 2.15, 0.6, M.lacquer, 0, 0.05, 0, { r: 0.01 });
    B(w - 0.02, 0.05, 0.56, M.blackMatte, 0, 0, 0);
    const n = Math.round(w / 0.6);
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + (i + 0.5) * (w / n);
      B(w / n - 0.012, 2.1, 0.012, M.lacquer, cx, 0.07, 0.3);
      B(0.016, 0.3, 0.025, M.steel, cx + (i % 2 ? -1 : 1) * (w / n / 2 - 0.06), 1.0, 0.32);
    }
  });
  const desk = (x, z, rot) => piece(x, z, rot, ({ B, C }) => {
    B(1.2, 0.035, 0.6, M.oak, 0, 0.72, 0, { r: 0.008 });
    B(0.4, 0.68, 0.56, M.lacquer, 0.38, 0.04, 0, { r: 0.008 });
    for (const s of [-1, 1]) B(0.035, 0.72, 0.035, M.steel, -0.56, 0, s * 0.26);
    B(0.4, 0.26, 0.02, M.black, -0.15, 0.85, -0.2, { rx: -0.1 });           // laptop screen
    B(0.4, 0.015, 0.28, M.lacquerGrey, -0.15, 0.755, -0.05);
    C(0.07, 0.09, 0.02, M.blackMatte, 0.42, 0.755, -0.18);
    C(0.012, 0.012, 0.35, M.steel, 0.42, 0.775, -0.18, 8);
    C(0.05, 0.09, 0.1, M.lampShade, 0.42, 1.1, -0.12);
    for (let i = 0; i < 6; i++) B(0.035, 0.22 + (i % 3) * 0.02, 0.16, books[i], 0.2 + i * 0.04, 0.755, -0.2);
  });
  const deskChair = (x, z, rot) => piece(x, z, rot, ({ B, C }) => {
    C(0.28, 0.28, 0.04, M.blackMatte, 0, 0.02, 0, 5);
    C(0.025, 0.025, 0.4, M.steel, 0, 0.06, 0, 8);
    B(0.46, 0.08, 0.44, M.duvetBlue, 0, 0.46, 0, { r: 0.03 });
    B(0.42, 0.42, 0.06, M.duvetBlue, 0, 0.56, -0.22, { r: 0.03 });
  });
  const bookshelf = (x, z, rot, w = 1.2, h = 1.9, seed = 1) => piece(x, z, rot, ({ B }) => {
    const r = TX.rng(seed);
    B(w, h, 0.02, M.walnut, 0, 0, -0.16);
    for (const s of [-1, 1]) B(0.025, h, 0.34, M.walnut, s * (w / 2 - 0.0125), 0, 0);
    const shelves = 5;
    for (let i = 0; i <= shelves; i++) {
      const y = i * (h - 0.025) / shelves;
      B(w, 0.025, 0.34, M.walnut, 0, y, 0);
      if (i === shelves) continue;
      let bx = -w / 2 + 0.04;
      while (bx < w / 2 - 0.12) {
        const bw = 0.025 + r() * 0.03, bh = 0.18 + r() * 0.12;
        if (r() < 0.85) B(bw, bh, 0.2 + r() * 0.06, books[Math.floor(r() * books.length)], bx + bw / 2, y + 0.025, 0.02, { rz: r() < 0.1 ? 0.25 : 0 });
        bx += bw + 0.004;
        if (r() < 0.06) bx += 0.12;
      }
    }
  });
  const nightstand = (x, z, rot) => piece(x, z, rot, ({ B, C }) => {
    B(0.45, 0.48, 0.4, M.lacquer, 0, 0.06, 0, { r: 0.01 });
    legs4(B, 0.42, 0.36, 0.06, M.walnut, 0.03);
    B(0.4, 0.008, 0.01, M.steel, 0, 0.32, 0.2);
    C(0.06, 0.08, 0.03, M.ceramic, 0.08, 0.54, -0.04);
    C(0.01, 0.01, 0.22, M.steel, 0.08, 0.57, -0.04, 8);
    C(0.08, 0.12, 0.16, M.lampShade, 0.08, 0.76, -0.04);
  });
  const floorLamp = (x, z) => piece(x, z, 0, ({ C }) => {
    C(0.16, 0.16, 0.03, M.blackMatte, 0, 0, 0);
    C(0.012, 0.012, 1.45, M.blackMatte, 0, 0.03, 0, 8);
    C(0.15, 0.22, 0.28, M.lampShade, 0, 1.4, 0);
  });
  const toyBox = (x, z, rot) => piece(x, z, rot, ({ B, S }) => {
    B(0.6, 0.38, 0.38, M.toyBlue, 0, 0, 0, { r: 0.03 });
    S(0.09, M.toyRed, -0.12, 0.47, 0.02);
    B(0.12, 0.12, 0.12, M.toyYellow, 0.12, 0.38, 0, { ry: 0.4 });
    B(0.1, 0.1, 0.1, M.toyGreen, 0.15, 0.5, 0.02, { ry: 0.9 });
  });
  const shoeCabinet = (x, z, rot) => piece(x, z, rot, ({ B }) => {
    B(1.2, 0.9, 0.34, M.lacquer, 0, 0.05, 0, { r: 0.01 });
    B(1.18, 0.05, 0.3, M.blackMatte, 0, 0, 0);
    B(0.2, 0.06, 0.12, M.toyRed, -0.3, 0.95, 0.0, { r: 0.02 });
    B(0.3, 0.04, 0.2, M.oak, 0.3, 0.95, 0.0);
  });
  const coatRack = (x, z) => piece(x, z, 0, ({ C, S }) => {
    C(0.2, 0.2, 0.03, M.blackMatte, 0, 0, 0);
    C(0.018, 0.018, 1.75, M.blackMatte, 0, 0.03, 0, 8);
    S(0.04, M.blackMatte, 0, 1.8, 0);
    S(0.18, M.duvetGreen, 0.08, 1.4, 0.05, 0.8, 1.9, 0.6);
  });
  const rugPiece = (x0, x1, z0, z1, mat) => wbox(x0, x1, 0, 0.012, z0, z1, mat, { cast: false });

  // ---------- curtains (pleated panels + rod) beside windows on the north/south walls ----------
  const curtainMat = (m, color) => { const c = tint(m, color); c.side = THREE.DoubleSide; return c; };
  const curtains = { sand: curtainMat(fSheet, 0xfff4e2), blue: curtainMat(fBlue, 0xe6eefa), grey: curtainMat(fSheet, 0xf1efe9) };
  function curtainPanel(x0, x1, zFace, dir, mat) {
    const w = x1 - x0, y0 = 0.02, y1 = 2.52, segs = Math.max(8, Math.round(w / 0.05));
    const geo = new THREE.PlaneGeometry(w, y1 - y0, segs, 1);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    const waves = Math.round(w / 0.15);
    for (let i = 0; i < p.count; i++) {
      const u = (p.getX(i) + w / 2) / w;
      p.setZ(i, Math.sin(u * Math.PI * 2 * waves) * 0.055 * (p.getY(i) > 0 ? 1 : 1.25));
      uv.setXY(i, (x0 + u * w) / 0.27, p.getY(i) / 0.27);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, zFace + dir * 0.06);
    finish(m, { cast: false });
  }
  function curtainPair(cx, w, zFace, dir, mat) {
    const a = cx - w / 2, b = cx + w / 2;
    curtainPanel(a - 0.5, a + 0.2, zFace, dir, mat);
    curtainPanel(b - 0.2, b + 0.5, zFace, dir, mat);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, w + 1.3, 8), M.blackMatte);
    rod.rotation.z = Math.PI / 2; rod.position.set(cx, 2.56, zFace + dir * 0.08);
    finish(rod, { cast: false });
  }
  curtainPair(2.5, 2.2, 12 - T / 2, -1, curtains.sand);     // salon south windows
  curtainPair(6.8, 2.2, 12 - T / 2, -1, curtains.sand);
  curtainPair(2.75, 1.4, T / 2, 1, curtains.blue);          // kid room
  curtainPair(7.75, 1.4, T / 2, 1, curtains.grey);          // room 2
  curtainPair(14.25, 1.4, T / 2, 1, curtains.sand);         // master bedroom

  // ---------- Poly Haven models ----------
  // front = local axis the model faces (Poly Haven models are exported facing +z unless noted). rot = world yaw (0 faces +z).
  const FRONT_YAW = { z: 0, '-z': Math.PI, x: -Math.PI / 2, '-x': Math.PI / 2 };
  const modelTasks = [];
  const topOf = (g) => new THREE.Box3().setFromObject(g).max.y;
  const chain = (p, fn) => { const q = p.then(fn); modelTasks.push(q); return q; };   // follow-up work that must finish before buildHouse resolves
  function addModel(id, o = {}) {
    const task = (async () => {
      const m = await loadModel(id, { surface: o.surface });
      if (!m) return null;
      let s = o.scale ?? 1;
      if (o.fit) s = o.fit[1] / m.size[o.fit[0]];
      const c = m.box.getCenter(new THREE.Vector3());
      const inst = m.scene.clone(true);
      inst.position.set(-c.x, -m.box.min.y, -c.z);
      const pivot = new THREE.Group();
      pivot.scale.setScalar(s);
      pivot.rotation.y = FRONT_YAW[o.front || 'z'];
      pivot.add(inst);
      const g = new THREE.Group();
      g.add(pivot);
      g.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
      g.rotation.y = o.rot ?? 0;
      if (o.ceiling) g.position.y = H - m.size.y * s;
      root.add(g);
      g.updateMatrixWorld(true);
      g.traverse(n => {
        if (!n.isMesh) return;
        n.castShadow = o.cast !== false; n.receiveShadow = true;
        if (o.hit !== false) hitMeshes.push(n);
      });
      if (o.collide !== false) {
        const b = new THREE.Box3().setFromObject(g);
        const k = o.shrink ?? 1, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
        const hx = (b.max.x - b.min.x) / 2 * k, hz = (b.max.z - b.min.z) / 2 * k;
        colliders.push({ minX: cx - hx, maxX: cx + hx, minY: b.min.y, maxY: b.max.y, minZ: cz - hz, maxZ: cz + hz });
      }
      return g;
    })();
    modelTasks.push(task);
    return task;
  }
  // picture/clock on a wall: wallPos = coordinate of the wall surface along its normal, along = position along the wall,
  // cy = height of the centre, rot = facing (0: +z, PI: -z, PI/2: +x). The back of the model sits flush on the wall.
  const frameOn = (id, wallPos, along, cy, rot, width) => {
    const zAxis = Math.abs(Math.sin(rot)) < 0.5;
    return chain(addModel(id, { x: zAxis ? along : wallPos, z: zAxis ? wallPos : along, rot, fit: ['x', width], collide: false, surface: 'wood' }), (g) => {
      if (!g) return;
      const b = new THREE.Box3().setFromObject(g);
      const n = zAxis ? Math.cos(rot) : Math.sin(rot);                       // facing sign along the wall normal
      const depth = zAxis ? b.max.z - b.min.z : b.max.x - b.min.x;
      g.position.y += cy - (b.min.y + b.max.y) / 2;
      if (zAxis) g.position.z = wallPos + n * (depth / 2 + 0.003); else g.position.x = wallPos + n * (depth / 2 + 0.003);
      g.updateMatrixWorld(true);
    });
  };

  // --- Oda 1 (kid) ---
  bed(4.95, 1.12, 0, 0.9, M.duvetBlue);
  desk(0.37, 3.95, Math.PI / 2);
  deskChair(1.0, 3.95, -Math.PI / 2);
  wardrobe(2.35, 4.62, Math.PI);
  toyBox(3.6, 4.65, Math.PI);
  rugPiece(1.7, 3.9, 1.4, 3.4, M.rugKid);
  frameOn('hanging_picture_frame_02', T / 2 + 0.004, 4.95, 1.95, 0, 0.7);
  addModel('rubber_duck_toy', { x: 3.45, z: 3.0, y: 0.012, rot: 0.6, fit: ['y', 0.2], collide: false, surface: 'plastic' });
  addModel('wicker_basket_01', { x: 1.25, z: 4.7, rot: 0.2, scale: 1.0, collide: true, surface: 'soft' });
  canSpots.push({ x: 2.8, y: 0.012, z: 2.4, axis: 'x' });

  // --- Oda 2 ---
  bed(6.05, 1.15, 0, 0.9, M.duvetGreen);
  wardrobe(9.62, 1.6, -Math.PI / 2);
  desk(7.0, 4.62, Math.PI);
  deskChair(7.0, 4.0, 0);
  bookshelf(9.75, 3.9, -Math.PI / 2, 1.0, 1.8, 4);
  rugPiece(6.8, 8.6, 1.4, 3.2, M.runner);

  // --- Banyo ---
  piece(11.25, 0.47, 0, ({ B }) => {
    B(1.7, 0.56, 0.76, M.ceramic, 0, 0, 0, { r: 0.04 });
    B(1.54, 0.01, 0.6, M.water, 0, 0.5, 0);
    B(0.04, 0.2, 0.04, M.chrome, 0.7, 0.56, -0.3);
    B(0.18, 0.03, 0.04, M.chrome, 0.64, 0.74, -0.3);
  });
  addModel('rubber_duck_toy', { x: 11.05, z: 0.5, y: 0.5, rot: -0.5, fit: ['y', 0.11], collide: false, surface: 'plastic' });
  piece(12.12, 2.4, -Math.PI / 2, ({ B, C }) => {
    C(0.18, 0.15, 0.4, M.ceramic, 0, 0, 0.05);
    B(0.38, 0.05, 0.46, M.ceramic, 0, 0.4, 0.05, { r: 0.02 });
    B(0.38, 0.38, 0.17, M.ceramic, 0, 0.42, -0.2, { r: 0.03 });
    B(0.08, 0.02, 0.05, M.chrome, 0, 0.8, -0.2);
  });
  piece(10.34, 2.6, Math.PI / 2, ({ B, C }) => {
    B(0.8, 0.55, 0.46, M.walnut, 0, 0.3, 0, { r: 0.01 });
    B(0.82, 0.12, 0.48, M.ceramic, 0, 0.85, 0, { r: 0.02 });
    B(0.5, 0.01, 0.3, M.water, 0, 0.965, 0.02);
    C(0.012, 0.012, 0.2, M.chrome, 0, 0.97, -0.18, 8);
    B(0.03, 0.02, 0.12, M.chrome, 0, 1.15, -0.13);
  });
  wbox(10 + T / 2 + 0.008, 10 + T / 2 + 0.02, 1.25, 2.05, 2.25, 2.95, M.mirror, { cast: false });
  wbox(12.5 - T / 2 - 0.06, 12.5 - T / 2 - 0.008, 1.2, 1.23, 3.4, 4.0, M.chrome);
  wbox(12.5 - T / 2 - 0.05, 12.5 - T / 2 - 0.02, 0.7, 1.2, 3.45, 3.95, M.duvetBeige, { cast: false });

  // --- Ebeveyn ---
  bed(13.6, 2.4, Math.PI / 2, 1.6, M.duvetBeige);
  nightstand(12.82, 1.12, Math.PI / 2);
  nightstand(12.82, 3.68, Math.PI / 2);
  wardrobe(15.1, 4.62, Math.PI, 1.2);
  frameOn('fancy_picture_frame_01', 12.5 + T / 2, 2.4, 1.75, Math.PI / 2, 0.95);
  rugPiece(14.7, 15.7, 1.6, 3.2, M.rugKid);
  addModel('throw_pillows_01', { x: 13.12, z: 2.4, y: 0.56, rot: Math.PI / 2, fit: ['x', 0.86], collide: false, surface: 'soft' });
  addModel('modern_arm_chair_01', { x: 15.25, z: 0.8, rot: -Math.PI / 4, fit: ['x', 0.75], surface: 'soft' });

  // --- Koridor ---
  shoeCabinet(15.15, 6.36, Math.PI);
  addModel('potted_plant_04', { x: 15.15, z: 6.36, y: 0.95, fit: ['y', 0.28], collide: false, surface: 'tile' });
  coatRack(15.7, 5.2);
  rugPiece(1.0, 15.2, 5.45, 6.15, M.runner);
  frameOn('hanging_picture_frame_02', 5 + T / 2, 6.5, 1.75, 0, 0.8);
  frameOn('fancy_picture_frame_01', 6.6 - T / 2, 10.0, 1.75, Math.PI, 0.7);

  // --- Salon ---
  const tvTop = 0.68 * 0.8;
  addModel('modern_wooden_cabinet', { x: 0.3, z: 9.3, rot: Math.PI / 2, fit: ['x', 1.95], surface: 'wood' });
  tvOnUnit(0.3, 9.3, Math.PI / 2, tvTop);
  addModel('standing_picture_frame_01', { x: 0.3, z: 10.0, y: tvTop, rot: Math.PI / 2 - 0.25, fit: ['y', 0.27], collide: false, surface: 'wood' });
  addModel('ceramic_vase_01', { x: 0.3, z: 8.55, y: tvTop, fit: ['y', 0.32], collide: false, surface: 'tile' });
  sofa(3.95, 9.3, -Math.PI / 2, 2.4);
  chain(addModel('modern_coffee_table_01', { x: 2.2, z: 9.3, rot: 0, scale: 1.1, surface: 'wood' }), (g) => {
    if (!g) { canSpots.push({ x: 2.2, y: 0.43, z: 9.3, axis: 'z' }); return; }
    canSpots.push({ x: 2.2, y: topOf(g), z: 9.3, axis: 'z' });
    addModel('ceramic_vase_02', { x: 2.25, z: 8.8, y: topOf(g), fit: ['y', 0.2], collide: false, surface: 'tile' });
  });
  addModel('mid_century_lounge_chair', { x: 1.3, z: 7.5, rot: Math.PI / 4, fit: ['x', 0.78], surface: 'soft' });
  rugPiece(1.0, 3.6, 7.7, 10.9, M.rug);
  diningTable(7.2, 9.8, 0);
  addModel('dining_chair_02', { x: 6.8, z: 9.05, rot: 0, surface: 'soft' });
  addModel('dining_chair_02', { x: 7.6, z: 9.05, rot: 0, surface: 'soft' });
  addModel('dining_chair_02', { x: 6.8, z: 10.55, rot: Math.PI, surface: 'soft' });
  addModel('dining_chair_02', { x: 7.6, z: 10.55, rot: Math.PI, surface: 'soft' });
  addModel('ceramic_vase_01', { x: 7.2, z: 9.8, y: 0.775, fit: ['y', 0.3], collide: false, surface: 'tile' });
  addModel('modern_ceiling_lamp_01', { x: pendantAt.x, z: pendantAt.z, ceiling: true, scale: 1.0, collide: false, surface: 'metal' });
  chain(addModel('wooden_display_shelves_01', { x: 8.3, z: 6.6 + T / 2 + 0.19, rot: 0, front: 'x', fit: ['z', 1.2], surface: 'wood' }), (g) => {
    if (!g) return;
    addModel('ceramic_vase_04', { x: 8.0, z: 6.9, y: topOf(g), fit: ['y', 0.3], collide: false, surface: 'tile' });
    addModel('wicker_basket_01', { x: 8.55, z: 6.9, y: topOf(g), rot: 0.1, scale: 0.9, collide: false, surface: 'soft' });
  });
  addModel('potted_plant_01', { x: 0.55, z: 11.4, scale: 1.1, shrink: 0.5, surface: (n) => (/pot/.test(n) ? 'tile' : 'soft') });
  addModel('potted_plant_02', { x: 9.0, z: 11.4, scale: 1.0, shrink: 0.5, surface: (n) => (/pot/.test(n) ? 'tile' : 'soft') });
  chain(addModel('side_table_01', { x: 4.0, z: 10.9, rot: 0, surface: 'wood' }), (g) => {
    if (!g) return;
    addModel('potted_plant_04', { x: 4.0, z: 10.9, y: topOf(g), fit: ['y', 0.28], collide: false, surface: 'tile' });
  });
  floorLamp(4.9, 11.45);
  frameOn('fancy_picture_frame_01', 12 - T / 2, 4.6, 1.85, Math.PI, 1.0);

  // --- Mutfak (world coordinates) ---
  {
    const z0 = 11.33, z1 = 12 - T / 2, x0 = 9.5 + T / 2, x1 = 16 - T / 2;
    wbox(x0, x1, 0, 0.1, z0 + 0.06, z1, M.blackMatte, { collide: true });
    wbox(x0, x1, 0.1, 0.86, z0, z1, M.lacquerGrey, { collide: true });
    // door seams & handles
    for (let x = x0 + 0.6; x < x1; x += 0.6) wbox(x - 0.004, x + 0.004, 0.12, 0.84, z0 - 0.002, z0, M.blackMatte, { cast: false, hit: false });
    for (let x = x0 + 0.3; x < x1; x += 0.6) wbox(x - 0.1, x + 0.1, 0.78, 0.795, z0 - 0.025, z0 - 0.005, M.steel, { cast: false });
    wbox(x0, x1, 0.86, 0.9, z0 - 0.03, z1, M.oak);                      // worktop
    wbox(x0, x1, 0.9, 1.45, z1 - 0.012, z1, M.tileFloor, { cast: false });  // stone backsplash
    // sink under window
    wbox(12.45, 13.05, 0.88, 0.902, z0 + 0.08, z1 - 0.08, M.steel);
    wbox(12.72, 12.78, 0.9, 1.2, z1 - 0.07, z1 - 0.03, M.chrome);
    wbox(12.72, 12.78, 1.15, 1.18, z1 - 0.3, z1 - 0.03, M.chrome);
    // cooktop
    wbox(10.55, 11.35, 0.9, 0.91, z0 + 0.05, z1 - 0.05, M.black);
    for (const [dx, dz] of [[-0.2, -0.13], [0.2, -0.13], [-0.2, 0.13], [0.2, 0.13]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.006, 6, 24), M.steel);
      ring.rotation.x = Math.PI / 2; ring.position.set(10.95 + dx, 0.915, (z0 + z1) / 2 + dz);
      root.add(ring);
    }
    // oven front
    wbox(10.6, 11.3, 0.15, 0.8, z0 - 0.01, z0, M.black);
    wbox(10.65, 11.25, 0.72, 0.74, z0 - 0.04, z0 - 0.01, M.steel);
    // upper cabinets (skip window zone)
    for (const [a, b] of [[x0, 11.85], [13.65, x1]]) {
      wbox(a, b, 1.5, 2.2, z1 - 0.35, z1, M.lacquer, { collide: true });
      for (let x = a + 0.5; x < b - 0.05; x += 0.5) wbox(x - 0.003, x + 0.003, 1.5, 2.2, z1 - 0.352, z1 - 0.35, M.blackMatte, { cast: false, hit: false });
    }
    wbox(10.6, 11.3, 1.45, 1.5, z1 - 0.45, z1, M.steel); // hood
    // fridge
    piece(15.52, 7.12, -Math.PI / 2, ({ B }) => {
      B(0.7, 1.9, 0.68, M.steel, 0, 0, 0, { r: 0.02 });
      B(0.68, 0.006, 0.01, M.blackMatte, 0, 1.25, 0.34);
      B(0.02, 0.5, 0.03, M.chrome, 0.28, 1.35, 0.355);
      B(0.02, 0.4, 0.03, M.chrome, 0.28, 0.7, 0.355);
    });
    // island + stools
    piece(12.8, 9.2, 0, ({ B }) => {
      B(2.0, 0.86, 0.8, M.lacquer, 0, 0, 0, { r: 0.01 });
      B(2.1, 0.04, 0.95, M.oak, 0, 0.86, 0.05, { r: 0.01 });
      B(0.08, 0.08, 0.08, M.toyRed, -0.55, 0.9, 0.12, { r: 0.03 });
      B(0.07, 0.07, 0.07, M.toyYellow, -0.66, 0.9, 0.05, { r: 0.03 });
    });
    for (const x of [12.1, 12.8, 13.5]) piece(x, 9.98, 0, ({ B, C }) => {
      C(0.2, 0.2, 0.06, M.walnut, 0, 0.68, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(0.015, 0.02, 0.68, M.blackMatte, sx * 0.12, 0, sz * 0.12, 8);
      C(0.17, 0.17, 0.015, M.blackMatte, 0, 0.25, 0, 20);
    });
    addModel('potted_plant_04', { x: 13.75, z: 8.95, y: 0.9, fit: ['y', 0.28], collide: false, surface: 'tile' });
    addModel('vintage_electric_kettle', { x: 14.9, z: 11.62, y: 0.9, rot: Math.PI, fit: ['x', 0.26], collide: false, surface: 'metal' });
    frameOn('wall_clock', 6.6 + T / 2, 11.4, 1.95, 0, 0.32);
    canSpots.push({ x: 13.4, y: 0.9, z: 9.25, axis: 'x' });
  }

  performance.mark('house:geometry-built');
  for (let n = 0; n < modelTasks.length;) { const cur = modelTasks.slice(n); n = modelTasks.length; await Promise.all(cur); }

  performance.mark('house:models');

  // ---------- target spots (on walls, normal points into room) ----------
  const tp = (x, y, z, nx, nz) => targetSpots.push({ pos: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(nx, 0, nz) });
  tp(1.05, 1.55, T / 2, 0, 1);                 // oda 1
  tp(9.2, 1.6, T / 2, 0, 1);                   // oda 2
  tp(T / 2, 1.35, 5.8, 1, 0);                  // koridor sonu (uzun atış)
  tp(9.5 - T / 2, 1.55, 7.6, -1, 0);           // salon
  tp(16 - T / 2, 1.45, 10.45, -1, 0);          // mutfak
  tp(16 - T / 2, 1.55, 4.0, -1, 0);            // ebeveyn

  const setLamps = (on) => {
    lamps.forEach(l => { l.light.intensity = on ? l.on : 0; });
    M.fixture.emissiveIntensity = on ? 1.6 : 0;
  };

  return { root, colliders, hitMeshes, lamps, setLamps, targetSpots, canSpots, spawn: { x: 14.8, z: 5.8, yaw: Math.PI / 2 } };
}
