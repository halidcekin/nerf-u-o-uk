import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as TX from './textures.js';
import { initAssets, pbrMaterial, loadHDRI } from './assets.js';

// Outdoor: HDRI sky + image based lighting, sun, garden.
//
// The HDRI (Poly Haven, CC0) gives both the visible sky and the ambient/reflection lighting. Its own sun disc is clamped in the
// environment map and the real sun is a DirectionalLight pointing where the HDRI sun is (so window reflections and shadows agree).
const SKY = {
  file: 'kloofendal_48d_partly_cloudy_puresky_2k',
  sun: new THREE.Vector3(0.554, 0.742, 0.378),   // direction of the sun inside the HDRI (scripts/hdri-sun.mjs)
};
const SUN_AZIMUTH = THREE.MathUtils.degToRad(118);   // low afternoon sun from the south-west -> light through the salon windows
const ENV_INTENSITY = 0.5;
const SUN_INTENSITY = 8.0;
const EXPOSURE = 1.0;

export async function buildWorld(scene, renderer) {
  initAssets(renderer);
  performance.mark('world:start');

  // ---- sky + environment lighting
  const sunElev = Math.asin(SKY.sun.y);
  const sunDir = new THREE.Vector3(Math.cos(sunElev) * Math.cos(SUN_AZIMUTH), SKY.sun.y, Math.cos(sunElev) * Math.sin(SUN_AZIMUTH));
  // rotate the HDRI about Y so its sun lands on sunDir
  const envRotY = Math.atan2(SKY.sun.z, SKY.sun.x) - SUN_AZIMUTH;

  const hdri = loadHDRI(SKY.file).catch((e) => { console.warn('[assets] HDRI failed, using fallback sky:', e); return null; });
  const [sky, grass, stone] = await Promise.all([
    hdri,
    pbrMaterial('leafy_grass', { fallback: 0x6d9a45, size: 2.0, surface: 'soft', roughness: 1, normalScale: 0.7, color: new THREE.Color().setRGB(0.55, 0.95, 0.4) }),
    pbrMaterial('concrete_tiles_02', { fallback: 0x8a8780, size: 1.825, surface: 'tile', roughness: 1, normalScale: 0.8 }),
  ]);
  performance.mark('world:hdri+textures');
  if (sky) {
    scene.environment = sky.env;
    scene.environmentRotation.set(0, envRotY, 0);
    scene.background = sky.background;
    scene.backgroundRotation.set(0, envRotY, 0);
  } else {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    scene.background = new THREE.Color(0x9cc4ec);
  }
  scene.environmentIntensity = ENV_INTENSITY;
  scene.backgroundIntensity = 1.0;
  scene.backgroundBlurriness = 0;

  // ---- sun
  const center = new THREE.Vector3(8, 0, 6);
  const sun = new THREE.DirectionalLight(0xfff1dc, SUN_INTENSITY);
  sun.position.copy(center).addScaledVector(sunDir, 30);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const s = sun.shadow.camera;
  s.left = -15; s.right = 15; s.top = 15; s.bottom = -15; s.near = 5; s.far = 70;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xfff4e6, 0xd8bfa0, 1.2);   // interior bounce fill (the IBL has no occlusion, so keep this soft)
  scene.add(hemi);

  // ---- ground: lawn (macro-variation hides the tiling) + stone path to the front door
  grass.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
        float macro = texture2D(map, vMapUv * 0.043 + vec2(0.31, 0.77)).g + texture2D(map, vMapUv * 0.117 + vec2(0.52, 0.12)).g;
        diffuseColor.rgb *= mix(0.62, 1.38, smoothstep(0.1, 0.9, macro));
      #endif`);
  };
  const SIZE = 500;
  const gGeo = new THREE.PlaneGeometry(SIZE, SIZE);
  const uv = gGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * SIZE / grass.userData.texSize, uv.getY(i) * SIZE / grass.userData.texSize);
  const ground = new THREE.Mesh(gGeo, grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(8, -0.06, 6);
  ground.receiveShadow = true;
  scene.add(ground);

  for (let i = 0; i < 7; i++) {
    const g = new THREE.BoxGeometry(0.7, 0.04, 0.9);
    const p = new THREE.Mesh(g, stone);
    p.position.set(16.7 + i * 0.85, -0.04, 5.8 + Math.sin(i * 0.9) * 0.15);
    // world-space UVs so neighbouring slabs differ
    const pu = g.attributes.uv, pp = g.attributes.position;
    for (let k = 0; k < pu.count; k++) pu.setXY(k, (pp.getX(k) + p.position.x) / stone.userData.texSize, (pp.getZ(k) + p.position.z) / stone.userData.texSize);
    p.receiveShadow = true; scene.add(p);
  }

  // ---- trees & hedges
  const r = TX.rng(77);
  const leafTex = TX.foliage();
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.95 });
  const leaves = [0xd4e8c0, 0xc4deb0, 0xb4d2a0].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, map: leafTex, bumpMap: leafTex, bumpScale: 2, vertexColors: true }));
  const tree = (x, z, sc) => {
    const t = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * sc, 0.2 * sc, 2.4 * sc, 10), trunk);
    tr.position.y = 1.2 * sc; t.add(tr);
    for (let i = 0; i < 6; i++) {
      const rad = (1.0 + r() * 0.6) * sc;
      const geo = new THREE.SphereGeometry(rad, 24, 16);
      const p = geo.attributes.position, u = geo.attributes.uv;
      for (let k = 0; k < p.count; k++) {          // lumpy canopy (smooth normals: indexed sphere)
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const d = 1 + 0.12 * Math.sin(x * 3.1 + i) * Math.sin(y * 2.7 + 2 * i) * Math.cos(z * 3.3) + 0.05 * Math.sin(x * 9 + y * 7 + i * 3) * Math.cos(z * 8 - i);
        p.setXYZ(k, x * d, y * d * 0.85, z * d);
        u.setXY(k, u.getX(k) * 5, u.getY(k) * 3);
      }
      geo.computeVertexNormals();
      const col = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {            // dark underside / bright top: fake canopy occlusion
        const t = THREE.MathUtils.clamp(p.getY(k) / rad * 0.5 + 0.55, 0, 1), v = 0.6 + 0.55 * t;
        col[k * 3] = v; col[k * 3 + 1] = v; col[k * 3 + 2] = v * 0.95;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const b = new THREE.Mesh(geo, leaves[i % 3]);
      b.position.set((r() - 0.5) * 1.6 * sc, (2.7 + r() * 1.3) * sc, (r() - 0.5) * 1.6 * sc);
      t.add(b);
    }
    t.position.set(x, 0, z);
    t.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(t);
  };
  [[-6, -4, 1.3], [-5, 9, 1.1], [4, -7, 1.4], [12, -6, 1.2], [22, 0, 1.3], [23, 13, 1.1], [7, 19, 1.4], [-3, 17, 1.2], [15, 20, 1.0], [-9, 3, 1.5]].forEach(([x, z, sc]) => tree(x, z, sc));
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0xc8e0b0, roughness: 0.9, map: leafTex, bumpMap: leafTex, bumpScale: 2 });
  for (const [x, z, w, d] of [[3, 14.2, 7, 0.8], [12.5, 14.2, 8, 0.8], [-2.6, 6, 0.8, 12]]) {
    const geo = new THREE.BoxGeometry(w, 1.1, d, Math.ceil(w), 1, Math.ceil(d));
    const uvh = geo.attributes.uv, ph = geo.attributes.position, nh = geo.attributes.normal;
    for (let k = 0; k < uvh.count; k++) {
      const ax = Math.abs(nh.getX(k)), az = Math.abs(nh.getZ(k));
      uvh.setXY(k, (ax > az ? ph.getZ(k) : ph.getX(k)) * 1.2, ph.getY(k) * 1.2);
    }
    const h = new THREE.Mesh(geo, hedgeMat);
    h.position.set(x, 0.5, z); h.castShadow = h.receiveShadow = true; scene.add(h);
  }

  performance.mark('world:end');
  return { sun, hemi, exposure: EXPOSURE };
}
