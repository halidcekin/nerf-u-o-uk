import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Loaders + caches for the CC0 Poly Haven assets in public/assets (see scripts/fetch-polyhaven.mjs).
//   public/assets/tex/<id>/<id>_{diff,nor_gl,arm}_<res>.ktx2   PBR texture sets (UASTC KTX2, transcoded to BC7/ASTC on the GPU)
//   public/assets/models/<id>/<id>.gltf                        simplified GLTF models (KHR_texture_basisu textures)
//   public/assets/hdri/<name>_2k.hdr                           environment maps

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
export const assetUrl = (p) => `${BASE}assets/${p}`;

let renderer = null;
let maxAniso = 8;
let ktx2 = null;
const gltfLoader = new GLTFLoader();
export function initAssets(r) {
  renderer = r;
  maxAniso = Math.min(8, r.capabilities.getMaxAnisotropy());
  if (!ktx2) {
    ktx2 = new KTX2Loader().detectSupport(r);   // transcoder is bundled by Vite (new URL(..., import.meta.url) inside KTX2Loader)
    gltfLoader.setKTX2Loader(ktx2);
  }
}

// ------------------------------------------------------------------ textures
const texCache = new Map();

function prep(t, srgb) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (renderer) renderer.initTexture(t);   // upload now (during loading) instead of stalling the first frame
  return t;
}

/** KTX2 texture (mipmaps are baked into the file). Not flipped: same convention as glTF textures. */
export function loadTexture(url, srgb = false) {
  const key = url + (srgb ? '#s' : '#l');
  if (!texCache.has(key)) texCache.set(key, ktx2.loadAsync(url).then((t) => prep(t, srgb)));
  return texCache.get(key);
}

/**
 * MeshStandardMaterial from a Poly Haven texture set.
 *   size   real-world size of one texture tile in metres (used by worldUV mapping in house.js)
 *   res    { diff, nor, arm } resolutions that were downloaded (default 1k each)
 *   arm    false => no AO/roughness/metal map (constant roughness)
 */
export async function pbrMaterial(id, o = {}) {
  const res = { diff: '1k', nor: '1k', arm: '1k', ...(o.res || {}) };
  const dir = `tex/${id}/${id}`;
  let map, normalMap, arm;
  try {
    [map, normalMap, arm] = await Promise.all([
      loadTexture(assetUrl(`${dir}_diff_${res.diff}.ktx2`), true),
      o.normal === false ? null : loadTexture(assetUrl(`${dir}_nor_gl_${res.nor}.ktx2`)),
      o.arm === false ? null : loadTexture(assetUrl(`${dir}_arm_${res.arm}.ktx2`)),
    ]);
  } catch (e) {                                   // assets missing / blocked (e.g. file:// without a server): plain colour, game stays playable
    console.warn('[assets] texture set failed:', id, e);
    const m = new THREE.MeshStandardMaterial({ color: o.fallback ?? 0xc8c4bc, roughness: 0.9 });
    m.userData.surface = o.surface || 'wall';
    m.userData.texSize = o.size || 1;
    return m;
  }
  const m = new THREE.MeshStandardMaterial({
    map,
    normalMap: normalMap || null,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
    color: o.color ?? 0xffffff,
  });
  if (normalMap) m.normalScale.set(o.normalScale ?? 1, -(o.normalScale ?? 1));   // textures are not flipped (like glTF): invert green
  if (arm) {
    m.aoMap = arm;
    m.aoMapIntensity = o.ao ?? 1;
    m.roughnessMap = arm;
    if (o.metal) m.metalnessMap = arm;
  }
  m.userData.surface = o.surface || 'wall';
  m.userData.texSize = o.size || 1;
  return m;
}

// ------------------------------------------------------------------ models
const modelCache = new Map();

const surfaceByName = (name) => {
  if (/glass|mirror/i.test(name)) return 'glass';
  if (/metal|steel|brass|chrome|legs/i.test(name)) return 'metal';
  return null;
};

/** Loads (once) a model from public/assets/models. Resolves to { scene, box, size } (a shared template: clone(true) it), or null if it could not be loaded. */
export function loadModel(id, { surface = 'wood' } = {}) {
  if (modelCache.has(id)) return modelCache.get(id);
  const p = gltfLoader.loadAsync(assetUrl(`models/${id}/${id}.gltf`)).catch((e) => { console.warn('[assets] model failed:', id, e); return null; }).then((gltf) => {
    if (!gltf) return null;
    const scene = gltf.scene;
    const seen = new Set();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      for (const n of ['tangent', 'color', 'uv1', 'uv2', 'uv3']) if (g.attributes[n]) g.deleteAttribute(n);
      for (const m of [].concat(o.material)) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (/artwork|canvas/i.test(m.name)) { m.roughnessMap = null; m.roughness = 0.8; }   // paintings: matte, no mirror-like glare
        m.userData.surface = (typeof surface === 'function' ? surface(m.name) : surface) || surfaceByName(m.name) || 'wood';
        for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
          const t = m[k]; if (t) { t.anisotropy = maxAniso; if (renderer) renderer.initTexture(t); }
        }
      }
    });
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    return { scene, box, size: box.getSize(new THREE.Vector3()) };
  });
  modelCache.set(id, p);
  return p;
}

// ------------------------------------------------------------------ HDRI
/**
 * Loads an equirect .hdr and returns { env, background }:
 *   env         PMREM texture for scene.environment, sun disc clamped so it doesn't double-count with the DirectionalLight
 *   background  equirect DataTexture for scene.background (sun clamped to a sane value for bloom)
 */
export async function loadHDRI(name, { envClamp = 6, bgClamp = 60 } = {}) {
  const loader = new HDRLoader();          // half-float data: positive half floats sort like their bit patterns
  const tex = await loader.loadAsync(assetUrl(`hdri/${name}.hdr`));
  const src = tex.image.data;
  const clampTo = (limit) => {
    const lim = THREE.DataUtils.toHalfFloat(limit);
    const out = new Uint16Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      out[i] = v > lim && v < 0x8000 ? lim : v;   // also catches +Inf / NaN of the saturated sun disc
    }
    return out;
  };
  const make = (data) => {
    const t = tex.clone();
    t.image = { data, width: tex.image.width, height: tex.image.height };
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.needsUpdate = true;
    return t;
  };
  const envTex = make(clampTo(envClamp));
  const bgTex = make(clampTo(bgClamp));
  bgTex.minFilter = bgTex.magFilter = THREE.LinearFilter;
  bgTex.generateMipmaps = false;
  tex.dispose();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(envTex).texture;
  envTex.dispose();
  pmrem.dispose();
  return { env, background: bgTex };
}
