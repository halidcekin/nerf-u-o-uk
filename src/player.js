import * as THREE from 'three';

const RADIUS = 0.24;
const HEIGHT = 1.38;      // kid height
const EYE = 1.24;
const CROUCH_EYE = 0.86;

// First-person kid controller: pointer-lock look, WASD, sprint, jump, crouch, AABB collision.
export class Player {
  constructor(camera, colliders, spawn, sfx) {
    this.camera = camera;
    this.colliders = colliders;
    this.sfx = sfx;
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = spawn.yaw; this.pitch = 0;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.eye = EYE;
    this.onGround = true;
    this.keys = new Set();
    this.stride = 0;        // walk phase (radians)
    this.moveAmt = 0;       // 0..1 smoothed horizontal speed factor
    this.sprinting = false;
    this.crouching = false;
    this.aiming = false;
    this.landKick = 0;
    this.mouseDX = 0; this.mouseDY = 0;   // per-frame deltas for weapon sway
    this.locked = false;
    this._lastStep = 0;

    addEventListener('keydown', e => { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      const s = this.aiming ? 0.0013 : 0.0021;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });

    this.body = this._makeBody();
  }

  // shadow-casting body (invisible to the camera except legs when looking down)
  _makeBody() {
    const g = new THREE.Group();
    const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const shirt = new THREE.MeshStandardMaterial({ color: 0xd8402f, roughness: 0.9 });
    const jeans = new THREE.MeshStandardMaterial({ color: 0x34507a, roughness: 0.9 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
    const sole = new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 });
    const add = (geo, mat, x, y, z, parent = g, cast = true) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; parent.add(m); return m;
    };
    add(new THREE.SphereGeometry(0.12, 16, 12), shadowOnly, 0, 1.25, 0.02);                 // head
    add(new THREE.CapsuleGeometry(0.15, 0.3, 4, 12), shadowOnly, 0, 0.9, 0.04);             // torso
    add(new THREE.CapsuleGeometry(0.045, 0.32, 4, 8), shadowOnly, 0.2, 0.95, -0.12);        // arms toward blaster
    add(new THREE.CapsuleGeometry(0.045, 0.32, 4, 8), shadowOnly, -0.12, 0.98, -0.2);
    add(new THREE.BoxGeometry(0.06, 0.08, 0.5), shadowOnly, 0.08, 1.05, -0.35);            // blaster silhouette
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 0.08, 0.62, 0.06); g.add(hip);
      add(new THREE.CapsuleGeometry(0.06, 0.42, 4, 10), jeans, 0, -0.3, 0, hip);
      add(new THREE.BoxGeometry(0.1, 0.07, 0.22), shoe, 0, -0.58, -0.04, hip);
      add(new THREE.BoxGeometry(0.105, 0.02, 0.23), sole, 0, -0.62, -0.04, hip);
      this.legs.push(hip);
    }
    return g;
  }

  get eyePos() { return this.camera.position; }

  update(dt) {
    const k = this.keys;
    this.crouching = k.has('KeyC') || k.has('ControlLeft');
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    this.sprinting = k.has('ShiftLeft') && fwd > 0 && !this.aiming && !this.crouching;
    const speed = this.crouching ? 1.5 : this.aiming ? 1.9 : this.sprinting ? 5.2 : 3.1;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(-sin * fwd + cos * side, 0, -cos * fwd - sin * side);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(speed);
    const accel = this.onGround ? 14 : 3;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);

    if (this.onGround && k.has('Space') && !this.crouching) { this.vel.y = 3.7; this.onGround = false; }
    this.vel.y -= 13 * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      if (!this.onGround && this.vel.y < -2.5) { this.landKick = Math.min(1, -this.vel.y / 6); this.sfx.step(); }
      this.pos.y = 0; this.vel.y = 0; this.onGround = true;
    }
    for (let i = 0; i < 3; i++) this._collide();

    // head bob / stride
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.moveAmt += ((this.onGround ? Math.min(1, hs / 3.1) : 0) - this.moveAmt) * Math.min(1, dt * 10);
    this.stride += hs * dt * (this.sprinting ? 2.3 : 2.7);
    const stepPhase = Math.floor(this.stride / Math.PI);
    if (stepPhase !== this._lastStep && this.onGround && hs > 0.5) { this._lastStep = stepPhase; this.sfx.step(); }

    // recoil recovers
    this.recoilPitch *= Math.exp(-dt * 9);
    this.recoilYaw *= Math.exp(-dt * 9);
    this.landKick *= Math.exp(-dt * 8);

    const targetEye = this.crouching ? CROUCH_EYE : EYE;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12);
    const bobY = Math.abs(Math.sin(this.stride)) * 0.03 * this.moveAmt - this.landKick * 0.08;
    const bobX = Math.cos(this.stride) * 0.018 * this.moveAmt;

    const cam = this.camera;
    cam.position.set(this.pos.x + cos * bobX, this.pos.y + this.eye + bobY, this.pos.z - sin * bobX);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + this.recoilYaw;
    cam.rotation.x = this.pitch + this.recoilPitch;
    cam.rotation.z = -Math.cos(this.stride) * 0.006 * this.moveAmt;

    // body follows
    this.body.position.copy(this.pos);
    if (this.crouching) this.body.position.y -= 0.3;
    this.body.rotation.y = this.yaw;
    const swing = Math.sin(this.stride) * 0.55 * this.moveAmt;
    this.legs[0].rotation.x = swing; this.legs[1].rotation.x = -swing;
  }

  _collide() {
    const p = this.pos, r = RADIUS;
    const top = p.y + (this.crouching ? 0.95 : HEIGHT);
    for (const a of this.colliders) {
      if (a.maxY < p.y + 0.12 || a.minY > top) continue;
      const cx = Math.max(a.minX, Math.min(p.x, a.maxX));
      const cz = Math.max(a.minZ, Math.min(p.z, a.maxZ));
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        p.x += dx * push; p.z += dz * push;
        // kill velocity into the surface
        const nx = dx / d, nz = dz / d, vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) { this.vel.x -= vn * nx; this.vel.z -= vn * nz; }
      } else {
        // center inside box: push out along the shallowest axis
        const ox = Math.min(p.x - a.minX, a.maxX - p.x), oz = Math.min(p.z - a.minZ, a.maxZ - p.z);
        if (ox < oz) p.x = (p.x - a.minX < a.maxX - p.x) ? a.minX - r : a.maxX + r;
        else p.z = (p.z - a.minZ < a.maxZ - p.z) ? a.minZ - r : a.maxZ + r;
      }
    }
  }

  kick(pitch, yaw) {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
  }
}
