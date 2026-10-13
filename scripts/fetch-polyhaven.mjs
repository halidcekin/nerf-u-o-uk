// Fetch + prepare the CC0 Poly Haven assets used by the game, output in ../public/assets:
//   tex/<id>/<id>_{diff,nor_gl,arm}_<res>.ktx2   PBR texture sets (UASTC KTX2 with mipmaps: 4x smaller in GPU memory than RGBA8)
//   models/<id>/<id>.gltf (+ .bin, textures/*.ktx2)   welded + simplified models, glass/animations removed
//   hdri/<name>_2k.hdr                              environment map
//
//   cd scripts && npm i && node fetch-polyhaven.mjs [--force]
//
// Downloads are cached in scripts/.cache (JPG sources, original glTFs); finished files in public/assets are skipped unless --force.
// Needs Node >= 18 (global fetch) and the packages in scripts/package.json (sharp, gltf-transform, meshoptimizer, ktx2-encoder).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFiles } from './ktx2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../public/assets');
const CACHE = path.resolve(HERE, '.cache');
const FORCE = process.argv.includes('--force');
const UA = { headers: { 'User-Agent': 'gameOS-house-assets/1.0' } };

const sharp = (await import('sharp')).default;

// ---------------------------------------------------------------- manifest
// Textures: { id: { diff, nor, arm } } = final size in px of each map (downloaded at 1k/2k, then downscaled).
// GPU memory matters more than disk here: roughness/AO (arm) and most normal maps are low frequency, so they stay small.
const T = (diff = 1024, nor = 512, arm = 512) => ({ diff, nor, arm });
export const TEXTURES = {
  // floors / walls / surfaces
  laminate_floor_02: T(2048, 1024, 512),
  marble_01: T(1024, 1024, 512),
  granite_tile: T(512, 512, 512),
  white_stucco: T(1024, 512, 512),
  oak_veneer_02: T(1024, 512, 512),
  black_walnut_veneer_02: T(1024, 512, 512),
  // fabrics (tiny real-world repeat: 512 is plenty)
  jogging_melange: T(512, 512, 256),
  terlenka: T(512, 512, 256),
  rough_linen: T(512, 512, 256),
  ribbed_corduroy: T(512, 512, 256),
  bi_stretch: T(512, 512, 256),
  scuba_suede: T(512, 512, 256),
  waffle_pique_cotton: T(512, 512, 256),
  jersey_melange: T(512, 512, 256),
  curly_teddy_natural: T(512, 512, 256),
  // outdoors
  leafy_grass: T(1024, 512, 512),
  concrete_tiles_02: T(512, 512, 256),
};

// Models (gltf, 1k): { id: { tex: max px of colour map, other: max px of normal/arm maps, tris: target triangle count } }
// Poly Haven models are very dense (a potted plant is 176k tris); we weld+simplify them, drop glass/animations and resize textures.
const M = (tex, tris, other = 512) => ({ tex, other, tris });
export const MODELS = {
  modern_wooden_cabinet: M(1024, 9000),
  modern_coffee_table_01: M(1024, 4500),
  modern_arm_chair_01: M(1024, 7000),
  mid_century_lounge_chair: M(1024, 6000),
  dining_chair_02: M(1024, 4500),
  wooden_display_shelves_01: M(512, 3200),
  potted_plant_01: M(512, 28000),
  potted_plant_02: M(512, 18000),
  potted_plant_04: M(512, 4000),
  side_table_01: M(512, 2800),
  modern_ceiling_lamp_01: M(512, 5000),
  ceramic_vase_01: M(512, 2500),
  ceramic_vase_02: M(512, 2500),
  ceramic_vase_04: M(512, 2500),
  throw_pillows_01: M(512, 5000),
  rubber_duck_toy: M(512, 4000),
  hanging_picture_frame_02: M(512, 3000),
  fancy_picture_frame_01: M(512, 900),
  standing_picture_frame_01: M(512, 1600),
  wall_clock: M(512, 3000),
  wicker_basket_01: M(512, 4000),
  vintage_electric_kettle: M(512, 4000),
};

// HDRIs: { id: res }
export const HDRIS = { kloofendal_48d_partly_cloudy_puresky: '2k' };

// ---------------------------------------------------------------- helpers
const exists = async (p) => { try { await fs.access(p); return true; } catch { return false; } };
const getJson = async (url) => {
  const r = await fetch(url, UA);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
async function download(url, dest) {
  if (!FORCE && await exists(dest)) return false;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const r = await fetch(url, UA);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
  return true;
}
// shrink a JPG in place to at most `max` px (sides rounded to multiples of 4 for block compression)
async function downscale(file, max) {
  const input = await fs.readFile(file);           // read to a buffer: sharp keeps file handles open on Windows
  const meta = await sharp(input).metadata();
  const k = Math.min(1, max / Math.max(meta.width, meta.height));
  const w = Math.max(4, Math.round(meta.width * k / 4) * 4), h = Math.max(4, Math.round(meta.height * k / 4) * 4);
  if (w === meta.width && h === meta.height) return;
  await fs.writeFile(file, await sharp(input).resize({ width: w, height: h, fit: 'fill' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer());
}
async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const it = q.shift(); await fn(it); } }));
}

async function optimizeModel(src, dest, cfg) {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
  const { weld, simplify, prune, dedup, textureCompress } = await import('@gltf-transform/functions');
  const { MeshoptSimplifier } = await import('meshoptimizer');
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(src);
  const root = doc.getRoot();
  root.listAnimations().forEach((a) => a.dispose());
  // glass / transmissive materials are dropped (they would add a transmission pass or sorting problems)
  for (const mat of root.listMaterials()) {
    const glassy = /glass/i.test(mat.getName()) || mat.getAlphaMode() === 'BLEND' || mat.getExtension('KHR_materials_transmission');
    if (glassy) { for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) if (p.getMaterial() === mat) p.dispose(); mat.dispose(); continue; }
    mat.setDoubleSided(mat.getAlphaMode() === 'MASK');   // closed solids: back faces are never visible
    for (const ext of mat.listExtensions()) if (ext.extensionName !== 'KHR_texture_transform') mat.setExtension(ext.extensionName, null);
  }
  const countTris = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  await doc.transform(weld());
  const before = countTris();
  const ratio = Math.min(1, cfg.tris / before);
  if (ratio < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: cfg.error ?? 0.02, lockBorder: false }));
  const after = countTris();
  await doc.transform(prune(), dedup());
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [cfg.other, cfg.other], quality: 90, slots: /normal|metallicRoughness|occlusion|emissive/ }));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [cfg.tex, cfg.tex], quality: 92, slots: /baseColor/ }));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await io.write(dest, doc);
  return `tris ${before} -> ${after}`;
}

// Turn a processed (JPG textured) glTF in the cache into the final KTX2 glTF in public/assets.
async function publishModel(id, outGltf, finalDir) {
  const srcDir = path.dirname(outGltf);
  const gltf = JSON.parse(await fs.readFile(outGltf, 'utf8'));
  const kindOf = new Map();                                  // texture index -> colour | normal | data
  const mark = (info, kind) => { if (info) kindOf.set(info.index, kindOf.get(info.index) === 'color' ? 'color' : kind); };
  for (const m of gltf.materials || []) {
    mark(m.pbrMetallicRoughness?.baseColorTexture, 'color'); mark(m.emissiveTexture, 'color');
    mark(m.normalTexture, 'normal');
    mark(m.pbrMetallicRoughness?.metallicRoughnessTexture, 'data'); mark(m.occlusionTexture, 'data');
  }
  const jobs = [];
  (gltf.textures || []).forEach((t, i) => {
    const img = gltf.images[t.source];
    const rel = img.uri.replace(/\.(jpe?g|png)$/i, '.ktx2');
    jobs.push({ src: path.join(srcDir, img.uri), dest: path.join(finalDir, rel), kind: kindOf.get(i) || 'data' });
    img.uri = rel; img.mimeType = 'image/ktx2';
    t.extensions = { ...(t.extensions || {}), KHR_texture_basisu: { source: t.source } };
    delete t.source;
  });
  gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed || []), 'KHR_texture_basisu'])];
  gltf.extensionsRequired = [...new Set([...(gltf.extensionsRequired || []), 'KHR_texture_basisu'])];
  await fs.mkdir(finalDir, { recursive: true });
  for (const b of gltf.buffers || []) await fs.copyFile(path.join(srcDir, b.uri), path.join(finalDir, b.uri));
  await fs.writeFile(path.join(finalDir, `${id}.gltf`), JSON.stringify(gltf));
  return jobs;
}

// ---------------------------------------------------------------- run
const ktxJobs = [];
const jobs = [];

for (const [id, cfg] of Object.entries(TEXTURES)) jobs.push(async () => {
  const files = await getJson(`https://api.polyhaven.com/files/${id}`);
  for (const [map, key, kind] of [['Diffuse', 'diff', 'color'], ['nor_gl', 'nor', 'normal'], ['arm', 'arm', 'data']]) {
    const px = cfg[key], res = px > 1024 ? '2k' : '1k';
    const name = `${id}_${map === 'Diffuse' ? 'diff' : map}_${res}`;
    const dest = path.join(ROOT, 'tex', id, `${name}.ktx2`);
    if (!FORCE && await exists(dest)) continue;
    const url = files[map]?.[res]?.jpg?.url;
    if (!url) { console.warn(`  !! ${id}: no ${map} ${res} jpg`); continue; }
    const jpg = path.join(CACHE, 'tex', id, `${name}.jpg`);
    await download(url, jpg);
    await downscale(jpg, px);
    ktxJobs.push({ src: jpg, dest, kind });
  }
  console.log('texture', id);
});

for (const [id, cfg] of Object.entries(MODELS)) jobs.push(async () => {
  const finalDir = path.join(ROOT, 'models', id);
  if (!FORCE && await exists(path.join(finalDir, `${id}.gltf`))) { console.log('model (cached)', id); return; }
  const files = await getJson(`https://api.polyhaven.com/files/${id}`);
  const g = files.gltf?.['1k']?.gltf;
  if (!g) { console.warn(`  !! ${id}: no 1k gltf`); return; }
  const dir = path.join(CACHE, 'models', id);
  await download(g.url, path.join(dir, `${id}_1k.gltf`));
  for (const [rel, f] of Object.entries(g.include)) await download(f.url, path.join(dir, rel));
  const outGltf = path.join(CACHE, 'models-out', id, `${id}.gltf`);
  const stats = await optimizeModel(path.join(dir, `${id}_1k.gltf`), outGltf, cfg);
  ktxJobs.push(...await publishModel(id, outGltf, finalDir));
  console.log('model', id, stats);
});

for (const [id, res] of Object.entries(HDRIS)) jobs.push(async () => {
  const files = await getJson(`https://api.polyhaven.com/files/${id}`);
  const url = files.hdri?.[res]?.hdr?.url;
  if (url) await download(url, path.join(ROOT, 'hdri', `${id}_${res}.hdr`));
  console.log('hdri', id);
});

await pool(jobs, 4, (j) => j());

console.log(`encoding ${ktxJobs.length} KTX2 textures...`);
await encodeFiles(ktxJobs);
console.log('done ->', ROOT);
