import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
function stripes(a, b, n) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, i * 256 / n, 64, 256 / n); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// side graphics: red STRIKE lettering, ULTRA badge, pinstripe
function ultraDecal() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 224;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 224);
  g.fillStyle = '#c8161e';
  g.font = '600 74px "Segoe UI", Arial, sans-serif';
  if ('letterSpacing' in g) g.letterSpacing = '14px';
  g.fillText('STRIKE', 150, 118);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.fillStyle = '#17181b';
  g.fillRect(60, 140, 470, 5); g.fillRect(560, 140, 440, 5);
  g.save(); g.translate(640, 70); g.transform(1, 0, -0.25, 1, 0, 0);
  g.fillStyle = '#17181b'; g.fillRect(0, 0, 300, 64);
  g.fillStyle = '#c8161e'; g.font = 'italic 900 58px "Segoe UI", Arial, sans-serif'; g.fillText('ULTRA', 26, 54);
  g.restore();
  g.fillStyle = '#c8161e'; g.font = 'italic 800 44px "Segoe UI", Arial, sans-serif'; g.fillText('FOAM', 20, 60);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export const MAG_SIZE = 10;
const FIRE_INTERVAL = 0.17;   // ~6 darts/s full-auto: tak-tak-tak
const SPINUP = 0.16;          // flywheel spin-up before the first dart
const RELOAD_TIME = 1.55;
const MUZZLE_SPEED = 27;

const HIP = new THREE.Vector3(0.12, -0.135, -0.3);
const GUN_SCALE = 0.8;

// First-person flywheel blaster: model, hands, motion (sway/bob/recoil/ADS/sprint/reload) and firing.
export class Blaster {
  constructor(vmScene, camera, { darts, sfx, player, aimMeshes, hud }) {
    this.vmScene = vmScene; this.camera = camera;
    this.darts = darts; this.sfx = sfx; this.player = player; this.aimMeshes = aimMeshes; this.hud = hud;

    this.mag = MAG_SIZE;
    this.reserve = 30;
    this.cool = 0;
    this.spin = 0;            // flywheel 0..1
    this.bloom = 0;           // accumulated spread
    this.adsT = 0; this.sprintT = 0;
    this.reloading = false; this.reloadT = 0; this._reloadStage = -1;
    this.trigger = false; this.aim = false;
    this.time = 0;

    // springs
    this.rec = { z: 0, vz: 0, rx: 0, vrx: 0, ry: 0, vry: 0, rz: 0, vrz: 0 };
    this.sway = { x: 0, y: 0, vx: 0, vy: 0 };
    this.triggerPull = 0;

    this.ray = new THREE.Raycaster();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();

    this.root = new THREE.Group();     // follows camera
    this.rig = new THREE.Group();      // motion offsets
    this.gun = new THREE.Group();      // the model
    this.root.add(this.rig); this.rig.add(this.gun);
    vmScene.add(this.root);
    this._build();
  }

  _build() {
    const g = this.gun;
    const plastic = (color, rough = 0.42, cc = 0.3) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, clearcoat: cc, clearcoatRoughness: 0.45 });
    const M = {
      white: plastic(0xf2f2ef, 0.42),
      red: plastic(0xc8161e, 0.4),
      redDark: plastic(0x8f0f15, 0.5),
      orange: plastic(0xff7414, 0.38),
      black: plastic(0x17181b, 0.55, 0.15),
      grey: plastic(0x3a3f46, 0.6, 0.1),
      hole: new THREE.MeshBasicMaterial({ color: 0x050505 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xe9b393, roughness: 0.62 }),
      sleeve: new THREE.MeshStandardMaterial({ map: stripes('#d8402f', '#f4efe6', 10), roughness: 0.9 }),
      cuff: new THREE.MeshStandardMaterial({ color: 0xd8402f, roughness: 0.9 }),
      dartBody: new THREE.MeshStandardMaterial({ color: 0x8e949b, roughness: 0.95 }),
      dartTip: new THREE.MeshStandardMaterial({ color: 0xc81b24, roughness: 0.5 }),
    };
    this.M = M;
    const RB = (w, h, d, mat, x, y, z, r = 0.008, parent = g) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), mat);
      m.position.set(x, y, z); parent.add(m); return m;
    };
    const CYL = (r0, r1, len, mat, x, y, z, parent = g, seg = 28) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg).rotateX(Math.PI / 2), mat);
      m.position.set(x, y, z); parent.add(m); return m;
    };
    const BAR = (a, b, w, h, mat, parent = g) => {   // rounded bar between two points (in the y/z plane)
      const dir = new THREE.Vector3().subVectors(b, a);
      const m = RB(w, h, dir.length(), mat, 0, 0, 0, Math.min(w, h) * 0.45, parent);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.lookAt(m.position.clone().add(dir));
      return m;
    };

    // --- receiver (white) ---
    RB(0.066, 0.112, 0.43, M.white, 0, 0.035, -0.19, 0.016);
    RB(0.05, 0.03, 0.31, M.white, 0, 0.1, -0.21, 0.012);                  // upper ridge
    RB(0.056, 0.03, 0.11, M.red, 0, 0.112, -0.13, 0.01);                  // red top block
    for (let i = 0; i < 4; i++) RB(0.058, 0.004, 0.014, M.redDark, 0, 0.128, -0.17 + i * 0.026, 0.002); // grip ridges on the block
    for (const s of [-1, 1]) {
      RB(0.003, 0.006, 0.34, M.black, s * 0.0335, 0.052, -0.215, 0.002);  // black side stripe
      RB(0.003, 0.03, 0.05, M.grey, s * 0.0335, 0.0, -0.36, 0.004);         // jam door panel
    }
    // mag well skirt
    RB(0.046, 0.034, 0.1, M.white, 0, -0.03, -0.13, 0.008);
    // --- orange handguard + barrel shroud ---
    RB(0.07, 0.075, 0.2, M.orange, 0, 0.005, -0.45, 0.014);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) RB(0.003, 0.012, 0.045, M.black, s * 0.0355, -0.008 + i * 0.0, -0.39 - i * 0.055, 0.003);
    RB(0.04, 0.03, 0.09, M.orange, 0, 0.075, -0.395, 0.01);               // hook bridging body→barrel
    CYL(0.026, 0.026, 0.4, M.orange, 0, 0.062, -0.6);
    for (const z of [-0.47, -0.6, -0.73]) CYL(0.031, 0.031, 0.014, M.orange, 0, 0.062, z);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {                  // long vent slots
      const v = RB(0.004, 0.009, 0.08, M.black, s * 0.0255, 0.062, -0.535 - i * 0.13, 0.002);
      v.rotation.z = 0;
    }
    for (let i = 0; i < 3; i++) RB(0.008, 0.004, 0.08, M.black, 0, 0.0885, -0.535 - i * 0.13, 0.002);
    CYL(0.034, 0.033, 0.034, M.orange, 0, 0.062, -0.81);                  // muzzle
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0155, 28), M.hole); hole.position.set(0, 0.062, -0.8275); g.add(hole);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.062, -0.84); g.add(this.muzzle);

    // --- sights (rear: red flip-up notch, front: orange post) ---
    const SIGHT_Y = 0.142;
    RB(0.034, 0.012, 0.024, M.red, 0, 0.117, -0.025, 0.004);               // base
    for (const s of [-1, 1]) RB(0.012, 0.04, 0.01, M.red, s * 0.0105, 0.13, -0.022, 0.003); // ears
    RB(0.018, 0.006, 0.01, M.red, 0, 0.13 - 0.011, -0.022, 0.002);         // notch floor (top at ≈ SIGHT_Y-0.02)
    RB(0.006, SIGHT_Y - 0.088 + 0.004, 0.018, M.orange, 0, (SIGHT_Y + 0.088) / 2 - 0.002, -0.78, 0.0025); // front post
    this.sightLocal = new THREE.Vector3(0, SIGHT_Y, -0.022);

    // --- stock (black skeleton, red pad) ---
    RB(0.03, 0.024, 0.16, M.black, 0, 0.068, 0.095, 0.008);
    BAR(new THREE.Vector3(0, -0.01, 0.03), new THREE.Vector3(0, -0.07, 0.17), 0.026, 0.02, M.black);
    BAR(new THREE.Vector3(0, 0.06, 0.12), new THREE.Vector3(0, -0.05, 0.13), 0.022, 0.018, M.black);
    RB(0.034, 0.028, 0.05, M.red, 0, 0.066, 0.16, 0.008);
    RB(0.04, 0.155, 0.03, M.red, 0, -0.005, 0.185, 0.01);                  // butt pad
    RB(0.042, 0.14, 0.012, M.black, 0, -0.005, 0.202, 0.004);

    // --- grip, trigger, guard ---
    const grip = RB(0.04, 0.125, 0.056, M.black, 0, -0.08, 0.035, 0.014); grip.rotation.x = 0.26;
    const gr = RB(0.042, 0.03, 0.048, M.red, 0, -0.142, 0.052, 0.008); gr.rotation.x = 0.26;
    for (let i = 0; i < 3; i++) { const t = RB(0.0425, 0.006, 0.03, M.grey, 0, -0.06 - i * 0.022, 0.012 + i * 0.006, 0.002); t.rotation.x = 0.26; }
    RB(0.022, 0.01, 0.09, M.black, 0, -0.07, -0.035, 0.004);
    RB(0.022, 0.06, 0.01, M.black, 0, -0.04, -0.08, 0.004);
    this.triggerMesh = RB(0.012, 0.036, 0.013, M.orange, 0, -0.035, -0.03, 0.005);
    this.triggerHome = this.triggerMesh.position.clone();

    // --- decals ---
    const decalMat = new THREE.MeshBasicMaterial({ map: ultraDecal(), transparent: true, depthWrite: false });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.074), decalMat);
      p.position.set(s * 0.0336, 0.03, -0.205); p.rotation.y = s * Math.PI / 2;
      g.add(p);
    }
    for (const [y, z] of [[0.075, -0.02], [-0.005, -0.05], [0.075, -0.33], [-0.005, -0.3]]) for (const s of [-1, 1]) {
      const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.003, 10).rotateZ(Math.PI / 2), M.grey);
      sc.position.set(s * 0.0335, y, z); g.add(sc);
    }

    // --- magazine (red, 10 darts, top dart visible) ---
    const makeMag = () => {
      const m = new THREE.Group();
      const body = new THREE.Group(); body.rotation.x = -0.1; m.add(body);
      RB(0.034, 0.19, 0.086, M.red, 0, -0.095, 0, 0.008, body);
      for (const s of [-1, 1]) for (let i = 0; i < 6; i++) RB(0.002, 0.008, 0.07, M.redDark, s * 0.0172, -0.04 - i * 0.024, 0, 0.002, body);
      RB(0.038, 0.016, 0.09, M.redDark, 0, -0.19, 0, 0.006, body);
      const top = new THREE.Group(); top.position.set(0, -0.004, 0); body.add(top);
      const bodyG = new THREE.CylinderGeometry(0.0072, 0.0072, 0.062, 10).rotateX(Math.PI / 2);
      const tipG = new THREE.CylinderGeometry(0.0078, 0.0078, 0.014, 10).rotateX(Math.PI / 2);
      top.add(new THREE.Mesh(bodyG, M.dartBody));
      const t = new THREE.Mesh(tipG, M.dartTip); t.position.z = -0.038; top.add(t);
      m.userData.top = top;
      return m;
    };
    this.magHome = new THREE.Vector3(0, -0.03, -0.13);
    this.magObj = makeMag(); this.magObj.position.copy(this.magHome); g.add(this.magObj);
    this.dropMag = makeMag(); this.dropMag.visible = false; this.rig.add(this.dropMag);
    this._setMagDarts(this.magObj, this.mag);

    // --- hands ---
    const limb = (a, b, r0, r1, mat, parent) => {
      const dir = this._v.copy(b).sub(a);
      const len = dir.length();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 18), mat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      parent.add(m); return m;
    };
    const finger = (parent, x, y, z, rx, ry, len = 0.032, r = 0.0085) => {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), M.skin);
      f.position.set(x, y, z); f.rotation.set(rx, ry, 0, 'YXZ'); parent.add(f); return f;
    };
    const rh = new THREE.Group(); g.add(rh);
    RB(0.05, 0.085, 0.07, M.skin, 0.006, -0.085, 0.068, 0.022, rh).rotation.x = 0.26;
    for (let i = 0; i < 3; i++) finger(rh, -0.003, -0.085 - i * 0.022, 0.012 - i * 0.005, 0, Math.PI / 2, 0.034, 0.0095).rotation.z = 0.3;
    const idx = finger(rh, 0.013, -0.045, -0.01, Math.PI / 2 - 0.3, 0.25, 0.03, 0.0088);
    this.indexFinger = idx; this.indexHome = idx.position.clone();
    finger(rh, -0.027, -0.05, 0.035, 0.9, -0.2, 0.034, 0.0095);
    limb(new THREE.Vector3(0.012, -0.125, 0.095), new THREE.Vector3(0.09, -0.27, 0.31), 0.032, 0.04, M.skin, rh);
    limb(new THREE.Vector3(0.04, -0.175, 0.17), new THREE.Vector3(0.16, -0.37, 0.49), 0.045, 0.06, M.sleeve, rh);
    limb(new THREE.Vector3(0.033, -0.163, 0.15), new THREE.Vector3(0.046, -0.187, 0.19), 0.047, 0.047, M.cuff, rh);
    const lh = new THREE.Group(); g.add(lh);
    this.leftHand = lh;
    RB(0.06, 0.03, 0.09, M.skin, -0.006, -0.045, -0.45, 0.012, lh);
    for (let i = 0; i < 4; i++) finger(lh, 0.05, -0.018, -0.485 + i * 0.022, 0, 0, 0.026, 0.0085).rotation.z = 0.35;
    finger(lh, -0.05, -0.012, -0.46, -0.2, 0, 0.03, 0.0095).rotation.z = -0.25;
    limb(new THREE.Vector3(-0.01, -0.06, -0.43), new THREE.Vector3(-0.13, -0.22, -0.2), 0.03, 0.036, M.skin, lh);
    limb(new THREE.Vector3(-0.075, -0.13, -0.33), new THREE.Vector3(-0.28, -0.4, 0.0), 0.042, 0.058, M.sleeve, lh);
    limb(new THREE.Vector3(-0.067, -0.121, -0.343), new THREE.Vector3(-0.085, -0.144, -0.316), 0.044, 0.044, M.cuff, lh);

    this.rig.traverse(o => { if (o.isMesh) o.frustumCulled = false; });

    // ADS: rear sight notch on the view axis, ~16 cm from the eye
    this.gun.scale.setScalar(GUN_SCALE);
    this.dropMag.scale.setScalar(GUN_SCALE);
    const d = this.sightLocal.clone().multiplyScalar(GUN_SCALE);
    this.ADS = new THREE.Vector3(-d.x, -d.y, -0.16 - d.z);
  }

  _setMagDarts(magObj, n) {
    magObj.userData.top.visible = n > 0;
  }

  get canFire() { return !this.reloading && this.sprintT < 0.35; }

  startReload() {
    if (this.reloading || this.mag >= MAG_SIZE || this.reserve <= 0) return false;
    this.reloading = true; this.reloadT = 0; this._reloadStage = -1;
    this.dropMag.visible = false;
    return true;
  }

  addReserve(n) { this.reserve += n; }

  _fire() {
    const cam = this.camera, p = this.player;
    // spread
    const moving = p.moveAmt;
    const base = this.aim ? 0.0025 : 0.011;
    const spread = base + moving * (this.aim ? 0.006 : 0.022) + (p.onGround ? 0 : 0.03) + this.bloom;
    this.bloom = Math.min(0.03, this.bloom + (this.aim ? 0.002 : 0.005));
    // aim direction (camera forward + random cone)
    const dir = cam.getWorldDirection(this._v);
    const right = this._v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = this._v3.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    // find what we're aiming at
    this.ray.set(cam.position, dir); this.ray.far = 80;
    const hit = this.ray.intersectObjects(this.aimMeshes, false)[0];
    const aimPoint = hit ? hit.point.clone() : cam.position.clone().addScaledVector(dir, 80);
    // spawn at the muzzle unless it's poking through a wall
    this.root.updateMatrixWorld(true);
    const muzzle = this.muzzle.getWorldPosition(new THREE.Vector3());
    const toMuzzle = muzzle.clone().sub(cam.position);
    this.ray.set(cam.position, toMuzzle.clone().normalize()); this.ray.far = toMuzzle.length() + 0.05;
    const blocked = this.ray.intersectObjects(this.aimMeshes, false).length > 0 || (hit && hit.distance < 0.6);
    const spawn = blocked ? cam.position.clone().addScaledVector(dir, 0.05) : muzzle;
    const vdir = aimPoint.clone().sub(spawn).normalize();
    if (vdir.dot(dir) < 0.5) vdir.copy(dir);
    const vel = vdir.multiplyScalar(MUZZLE_SPEED * (0.94 + Math.random() * 0.1));
    vel.x += p.vel.x * 0.8; vel.z += p.vel.z * 0.8; vel.y += p.vel.y * 0.5;
    this.darts.spawn(spawn, vel);
    // FX
    this.darts.puff(muzzle, toMuzzle.copy(dir), 4, 0xffffff, 1.6, 0.03, 0.22);
    this.sfx.fire();
    this.mag--;
    this._setMagDarts(this.magObj, this.mag);
    // recoil impulses
    const k = this.aim ? 0.55 : 1;
    this.rec.vz += 1.6 * k;
    this.rec.vrx += 5.5 * k;
    this.rec.vry += (Math.random() - 0.5) * 2.2 * k;
    this.rec.vrz += (Math.random() - 0.5) * 3.0 * k;
    p.kick((0.011 + Math.random() * 0.005) * k, (Math.random() - 0.5) * 0.006 * k);
    this.triggerPull = 1;
    this.hud.fired(spread);
  }

  update(dt) {
    this.time += dt;
    const p = this.player, cam = this.camera;
    this.cool -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.05);
    this.adsT += ((this.aim && !this.reloading && !p.sprinting ? 1 : 0) - this.adsT) * Math.min(1, dt * 14);
    this.sprintT += ((p.sprinting && !this.trigger ? 1 : 0) - this.sprintT) * Math.min(1, dt * 9);
    if (this.trigger && p.sprinting) p.sprinting = false;

    // flywheel
    const wantSpin = this.trigger && !this.reloading && this.mag > 0;
    this.spin = wantSpin ? Math.min(1, this.spin + dt / SPINUP) : Math.max(0, this.spin - dt / 0.6);

    // trigger
    if (this.trigger && this.canFire) {
      if (this.mag <= 0) {
        if (this.cool <= 0) { this.sfx.dryFire(); this.cool = 0.3; this.triggerPull = 1; if (!this.startReload()) this.hud.message(this.reserve <= 0 ? 'DART YOK · YERDEN TOPLA [E]' : ''); }
      } else if (this.spin >= 1 && this.cool <= 0) {
        this._fire();
        this.cool = FIRE_INTERVAL;
      }
    }

    // reload timeline
    if (this.reloading) {
      this.reloadT += dt;
      const t = this.reloadT / RELOAD_TIME;
      const stage = t < 0.18 ? -1 : t < 0.55 ? 0 : t < 0.78 ? 1 : 2;
      if (stage !== this._reloadStage && stage >= 0) {
        this.sfx.reload(stage);
        if (stage === 0) { // drop old mag
          this.dropMag.visible = true;
          this._setMagDarts(this.dropMag, this.mag);
          this.dropMag.userData.vel = new THREE.Vector3(0.05, -0.4, 0.05);
          this.dropMag.userData.spin = (Math.random() - 0.5) * 6;
          this.gun.updateMatrixWorld(true);
          this.magObj.getWorldPosition(this._v); this.rig.worldToLocal(this._v);
          this.dropMag.position.copy(this._v);
          this.dropMag.quaternion.copy(this.gun.quaternion);
          this.magObj.visible = false;
        }
        if (stage === 1) { // insert new mag
          const take = Math.min(MAG_SIZE - this.mag, this.reserve);
          this.mag += take; this.reserve -= take;
          this._setMagDarts(this.magObj, this.mag);
          this.magObj.visible = true;
        }
        this._reloadStage = stage;
      }
      if (this.dropMag.visible) {
        const u = this.dropMag.userData;
        u.vel.y -= 4 * dt;
        this.dropMag.position.addScaledVector(u.vel, dt);
        this.dropMag.rotation.x += u.spin * dt;
        if (this.dropMag.position.y < -0.8) this.dropMag.visible = false;
      }
      // new mag rises into the well during stage 1
      const insert = THREE.MathUtils.clamp((t - 0.55) / 0.22, 0, 1);
      const ease = 1 - Math.pow(1 - insert, 3);
      this.magObj.position.copy(this.magHome).add(this._v.set(0.02 * (1 - ease), -0.22 * (1 - ease), 0.03 * (1 - ease)));
      this.magObj.rotation.x = -0.4 * (1 - ease);
      // left hand goes down to fetch the mag
      const hand = Math.sin(THREE.MathUtils.clamp((t - 0.2) / 0.62, 0, 1) * Math.PI);
      this.leftHand.position.set(0.04 * hand, -0.2 * hand, 0.13 * hand);
      this.leftHand.rotation.x = 0.5 * hand;
      if (t >= 0.78 && t < 0.86) this.rec.vrx += 22 * dt; // slap
      if (t >= 1) {
        this.reloading = false;
        this.magObj.position.copy(this.magHome); this.magObj.rotation.x = 0;
        this.leftHand.position.set(0, 0, 0); this.leftHand.rotation.x = 0;
        this.dropMag.visible = false;
      }
    }

    // springs
    const R = this.rec;
    const spring = (x, v, k, c) => v + (-k * x - c * v) * dt;
    R.vz = spring(R.z, R.vz, 320, 24); R.z += R.vz * dt;
    R.vrx = spring(R.rx, R.vrx, 260, 20); R.rx += R.vrx * dt;
    R.vry = spring(R.ry, R.vry, 220, 20); R.ry += R.vry * dt;
    R.vrz = spring(R.rz, R.vrz, 220, 18); R.rz += R.vrz * dt;
    const S = this.sway;
    const tx = THREE.MathUtils.clamp(-p.mouseDX * 0.00045, -0.05, 0.05);
    const ty = THREE.MathUtils.clamp(p.mouseDY * 0.00045, -0.05, 0.05);
    p.mouseDX = 0; p.mouseDY = 0;
    S.vx += ((tx - S.x) * 180 - S.vx * 16) * dt; S.x += S.vx * dt;
    S.vy += ((ty - S.y) * 180 - S.vy * 16) * dt; S.y += S.vy * dt;
    this.triggerPull = Math.max(0, this.triggerPull - dt * 12);

    // compose pose
    const ads = this.adsT, sprint = this.sprintT;
    const swayK = 1 - ads * 0.7;
    const bobK = (1 - ads * 0.8) * p.moveAmt * (1 + sprint * 0.8);
    const st = p.stride;
    const breathe = Math.sin(this.time * 1.7) * 0.0018 * (1 - ads * 0.8);
    const reloadTilt = this.reloading ? Math.sin(Math.min(1, this.reloadT / RELOAD_TIME) * Math.PI) : 0;

    const pos = this._v.copy(HIP).lerp(this.ADS, ads);
    pos.x += Math.cos(st) * 0.011 * bobK + S.x * 0.6 * swayK - sprint * 0.04;
    pos.y += -Math.abs(Math.sin(st)) * 0.012 * bobK + S.y * 0.6 * swayK + breathe - sprint * 0.05 - reloadTilt * 0.03 - p.landKick * 0.04;
    pos.z += R.z * 0.05 + sprint * 0.03;
    this.rig.position.copy(pos);
    this.rig.rotation.set(
      R.rx * 0.06 + 0.075 * (1 - ads) + S.y * 1.2 * swayK - sprint * 0.35 + reloadTilt * 0.25,
      R.ry * 0.03 + 0.05 * (1 - ads) + S.x * 1.5 * swayK + sprint * 0.75 - reloadTilt * 0.2,
      R.rz * 0.03 + Math.cos(st) * 0.02 * bobK + sprint * 0.3 + reloadTilt * 0.55,
      'YXZ');

    this.triggerMesh.position.copy(this.triggerHome).z += this.triggerPull * 0.007;
    this.indexFinger.position.copy(this.indexHome).z += this.triggerPull * 0.007;

    // follow camera
    this.root.position.copy(cam.position);
    this.root.quaternion.copy(cam.quaternion);

    // FOV
    const fov = 62 - ads * 14 + sprint * 4;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}
