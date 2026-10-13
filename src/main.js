import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { mergeStatic, bvh } from './optimize.js';
import { buildHouse } from './house.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Blaster, MAG_SIZE } from './blaster.js';
import { Darts } from './darts.js';
import { Targets } from './targets.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);

// ---------- quality presets ----------
const QUALITY = [
  { name: 'DÜŞÜK', scale: 0.75, msaa: 0, ao: false, bloom: false, shadowSize: 2048, shadowHz: 0 },
  { name: 'ORTA', scale: 1.0, msaa: 2, ao: false, bloom: true, shadowSize: 2048, shadowHz: 10 },
  { name: 'YÜKSEK', scale: 1.0, msaa: 4, ao: true, bloom: true, shadowSize: 4096, shadowHz: 20 },
];
let qi = 2;
try { const s = localStorage.getItem('foam.quality'); if (s !== null) qi = Math.max(0, Math.min(2, +s)); } catch { /* ignore */ }

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('app').appendChild(renderer.domElement);

const gpuName = (() => {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'GPU ?';
  const m = /ANGLE \([^,]+, ([^(]+?)(\s*\(|,|$)/.exec(raw);
  return (m ? m[1] : raw).trim();
})();

const scene = new THREE.Scene();
const vmScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 2000);
const sfx = new Sfx();

$('loading').textContent = 'Ev yükleniyor…';
const [house, world] = await Promise.all([buildHouse(scene, renderer), buildWorld(scene, renderer)]);
if (typeof world.exposure === 'number') renderer.toneMappingExposure = world.exposure;

const stats = mergeStatic(house.root, house.hitMeshes);
console.info(`[optimize] static meshes ${stats.before} → ${stats.after} draw groups`);

// viewmodel lighting (shares the env map)
vmScene.environment = scene.environment;
vmScene.environmentRotation.copy(scene.environmentRotation);
vmScene.environmentIntensity = 0.45;
const vmKey = new THREE.DirectionalLight(0xfff0dd, 1.3); vmKey.position.set(0.6, 1, 0.4);
const vmFill = new THREE.HemisphereLight(0xdfe8ff, 0x5a4a3a, 0.45);
vmScene.add(vmKey, vmFill);

// ---------- HUD ----------
const hudEl = $('hud'), cross = $('crosshair'), hm = $('hitmarker');
const pips = $('ammo-pips');
for (let i = 0; i < MAG_SIZE; i++) pips.appendChild(document.createElement('b'));
let score = 0, crossSpread = 0, msgTimer = 0;
const hud = {
  fired(spread) { crossSpread = Math.max(crossSpread, spread * 900 + 6); },
  message(t, dur = 2) { $('ammo-msg').textContent = t; last.msg = t; msgTimer = dur; },
  hit(big) {
    hm.classList.remove('show'); void hm.offsetWidth;
    hm.classList.toggle('big', big); hm.classList.add('show');
  },
  popup(text, gold) {
    const el = document.createElement('div');
    el.className = 'popup' + (gold ? ' gold' : '');
    el.textContent = text;
    el.style.left = (24 + Math.random() * 30) + 'px';
    $('popups').appendChild(el);
    setTimeout(() => el.remove(), 950);
  },
};

// ---------- game objects ----------
const player = new Player(camera, house.colliders, house.spawn, sfx);
scene.add(player.body);
player.body.traverse(o => { if (o.isMesh && o.material.colorWrite === false) o.layers.set(1); });
world.sun.shadow.camera.layers.enable(1);

const darts = new Darts(scene, house.hitMeshes, sfx);
const targets = new Targets(scene, house, sfx, (pts, label, big) => {
  score += pts; $('score-val').textContent = score;
  hud.popup(label, big); hud.hit(big);
});
bvh(house.hitMeshes);
darts.onHit = (dart, hit, n) => targets.handleHit(dart, hit, n);
const blaster = new Blaster(vmScene, camera, { darts, sfx, player, aimMeshes: house.hitMeshes, hud });

// ---------- post processing ----------
class OverlayPass extends Pass {
  constructor(s, c) { super(); this.s = s; this.c = c; this.needsSwap = false; }
  render(r, writeBuffer, readBuffer) {
    r.setRenderTarget(this.renderToScreen ? null : readBuffer);
    const ac = r.autoClear; r.autoClear = false;
    r.clearDepth();
    r.render(this.s, this.c);
    r.autoClear = ac;
  }
}
let composer, gtao, bloom;
function setupPipeline() {
  const q = QUALITY[qi];
  renderer.setPixelRatio(q.scale);
  if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); gtao?.dispose?.(); bloom?.dispose?.(); }
  const w = Math.floor(innerWidth * q.scale), h = Math.floor(innerHeight * q.scale);
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: q.msaa });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(q.scale);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  gtao = null; bloom = null;
  if (q.ao) {
    gtao = new GTAOPass(scene, camera, w, h);
    const base = gtao.setSize.bind(gtao);
    gtao.setSize = (sw, sh) => base(Math.max(1, sw >> 1), Math.max(1, sh >> 1));   // AO at half resolution
    gtao.setSize(w, h);
    gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1.2, samples: 12 });
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
  }
  composer.addPass(new OverlayPass(vmScene, camera));
  if (q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.12, 0.35, 1.6); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  world.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
  world.sun.shadow.map?.dispose(); world.sun.shadow.map = null;
  renderer.shadowMap.needsUpdate = true;
  $('quality').textContent = `KALİTE: ${q.name} [F2]`;
  try { localStorage.setItem('foam.quality', String(qi)); } catch { /* ignore */ }
}
setupPipeline();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- input ----------
const canvas = renderer.domElement;
const startEl = $('start');
$('loading').textContent = '';
$('play').disabled = false;
const lock = () => { sfx.init(); canvas.requestPointerLock(); };
$('play').addEventListener('click', lock);
canvas.addEventListener('click', () => { if (!player.locked) lock(); });
document.addEventListener('pointerlockchange', () => {
  player.locked = document.pointerLockElement === canvas;
  startEl.classList.toggle('hidden', player.locked);
  hudEl.classList.toggle('hidden', !player.locked);
  if (!player.locked) { blaster.trigger = false; blaster.aim = false; player.aiming = false; }
});
addEventListener('mousedown', e => {
  if (!player.locked) return;
  if (e.button === 0) blaster.trigger = true;
  if (e.button === 2) { blaster.aim = true; player.aiming = true; }
});
addEventListener('mouseup', e => {
  if (e.button === 0) blaster.trigger = false;
  if (e.button === 2) { blaster.aim = false; player.aiming = false; }
});
addEventListener('contextmenu', e => e.preventDefault());
let lampsOn = true;
addEventListener('keydown', e => {
  if (e.code === 'F2') { e.preventDefault(); qi = (qi + 2) % 3; autoDowngraded = true; setupPipeline(); hud.message(`KALİTE: ${QUALITY[qi].name}`, 1.5); return; }
  if (!player.locked) return;
  if (e.code === 'KeyR') { if (!blaster.startReload() && blaster.reserve <= 0 && blaster.mag < MAG_SIZE) hud.message('YEDEK DART YOK'); }
  if (e.code === 'KeyT') { targets.reset(); hud.message('HEDEFLER SIFIRLANDI', 1.2); }
  if (e.code === 'KeyL') { lampsOn = !lampsOn; house.setLamps(lampsOn); }
  if (e.code === 'KeyE') {
    const n = darts.collect(new THREE.Vector3(player.pos.x, player.pos.y + 0.7, player.pos.z), 2.3);
    if (n) { blaster.addReserve(n); sfx.pickup(); hud.popup(`+${n} dart`, false); }
  }
});

// ---------- HUD (only touch the DOM when something changed) ----------
const feet = new THREE.Vector3();
const els = { mag: $('ammo-mag'), res: $('ammo-res'), ammo: $('ammo'), msg: $('ammo-msg'), pickup: $('pickup'), fps: $('fps') };
const last = {};
const setText = (k, v) => { if (last[k] !== v) { last[k] = v; els[k].textContent = v; } };
let pickupTimer = 0;
function updateHud(dt) {
  setText('mag', String(blaster.mag));
  setText('res', String(blaster.reserve));
  if (last.pips !== blaster.mag) { last.pips = blaster.mag; [...pips.children].forEach((b, i) => b.classList.toggle('empty', i >= blaster.mag)); els.ammo.classList.toggle('low', blaster.mag <= 3); }
  if (blaster.reloading) setText('msg', 'ŞARJÖR DEĞİŞİYOR…');
  else if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) setText('msg', ''); }
  else if (blaster.mag === 0) setText('msg', blaster.reserve > 0 ? '[R] ŞARJÖR' : 'DART YOK · [E] TOPLA');
  else setText('msg', '');
  const base = blaster.aim ? 2 : 6 + player.moveAmt * 10 + (player.onGround ? 0 : 12);
  crossSpread += (base - crossSpread) * Math.min(1, dt * 10);
  const sp = crossSpread.toFixed(0);
  if (last.spread !== sp) { last.spread = sp; cross.style.setProperty('--spread', sp + 'px'); }
  const ads = blaster.adsT > 0.5;
  if (last.ads !== ads) { last.ads = ads; cross.classList.toggle('ads', ads); }
  pickupTimer -= dt;
  if (pickupTimer <= 0) {
    pickupTimer = 0.2;
    const near = darts.countNear(feet.set(player.pos.x, player.pos.y + 0.7, player.pos.z), 2.3);
    setText('pickup', near ? `[E] ${near} dart topla` : '');
  }
}

// ---------- loop ----------
const timer = new THREE.Timer();
let fpsAcc = 0, fpsN = 0, shadowAcc = 0, lowFor = 0, autoDowngraded = false;
renderer.shadowMap.needsUpdate = true;

function frame() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 1 / 30);
  player.update(player.locked ? dt : 0);
  blaster.update(dt);
  darts.update(dt);
  targets.update(dt);

  const got = darts.collect(feet.set(player.pos.x, 0.05, player.pos.z), 0.55, (d, p) => d.state === 'rest' && p.y < 0.2);
  if (got) { blaster.addReserve(got); sfx.pickup(); hud.popup(`+${got} dart`, false); }

  // sun shadows: geometry is mostly static, so refresh only a few times per second
  const hz = QUALITY[qi].shadowHz;
  if (hz > 0) { shadowAcc += dt; if (shadowAcc >= 1 / hz) { shadowAcc = 0; renderer.shadowMap.needsUpdate = true; } }

  sfx.setListener(camera);
  updateHud(dt);
  composer.render(dt);

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    const fps = Math.round(fpsN / fpsAcc);
    setText('fps', `${fps} FPS · ${gpuName}`);
    // auto-downgrade if it can't hold ~50 fps
    if (player.locked && fps < 48) lowFor += fpsAcc; else lowFor = 0;
    if (lowFor > 3 && qi > 0 && !autoDowngraded) { qi--; lowFor = 0; setupPipeline(); hud.message(`KALİTE OTOMATİK: ${QUALITY[qi].name}`, 2.5); if (qi === 0) autoDowngraded = true; }
    fpsAcc = 0; fpsN = 0;
  }
  requestAnimationFrame(frame);
}
player.update(0);
frame();

window.__game = { scene, camera, player, blaster, darts, targets, house, renderer, sfx, setQuality: (i) => { qi = i; setupPipeline(); } };
