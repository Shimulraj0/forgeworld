import * as THREE from 'three';

const GRAVITY = -19;
const WALK = 4.1;
const RUN = 7.2;
const JUMP = 6.6;
const STEP = 0.42;

export type MoveInput = { x: number; z: number; sprint: boolean; jump: boolean };

export class Player {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3(0, 0, 8);
  readonly vel = new THREE.Vector3();
  facing = Math.PI;
  grounded = true;
  radius = 0.33;
  height = 1.74;

  private body = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private phase = 0;
  private bob = 0;

  constructor() {
    this.build();
    this.group.add(this.body);
    this.group.position.copy(this.pos);
  }

  private build() {
    const suit = new THREE.MeshStandardMaterial({ color: '#f07f2c', roughness: 0.62, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: '#232f3f', roughness: 0.75 });
    const skin = new THREE.MeshStandardMaterial({ color: '#d9a483', roughness: 0.85 });
    const helmet = new THREE.MeshStandardMaterial({ color: '#ffc247', roughness: 0.35, metalness: 0.25 });
    const visor = new THREE.MeshStandardMaterial({
      color: '#0f2a33',
      roughness: 0.16,
      metalness: 0.8,
      emissive: '#0b3a44',
      emissiveIntensity: 0.7,
    });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.5, 4, 12), suit);
    torso.position.y = 1.08;
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.34), dark);
    vest.position.set(0, 1.06, 0.02);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.1, 10), dark);
    collar.position.y = 1.44;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), skin);
    head.position.y = 1.58;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), helmet);
    cap.position.y = 1.6;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.14), helmet);
    brim.position.set(0, 1.585, 0.16);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.06), visor);
    face.position.set(0, 1.56, 0.14);

    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.18), dark);
    backpack.position.set(0, 1.1, -0.22);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8), helmet);
    tank.position.set(0.12, 1.18, -0.32);

    const legGeo = new THREE.BoxGeometry(0.17, 0.62, 0.2);
    const bootGeo = new THREE.BoxGeometry(0.19, 0.13, 0.27);
    for (const [leg, sx] of [
      [this.legL, -0.11],
      [this.legR, 0.11],
    ] as const) {
      const mesh = new THREE.Mesh(legGeo, dark);
      mesh.position.y = -0.31;
      const boot = new THREE.Mesh(bootGeo, dark);
      boot.position.set(0, -0.66, 0.04);
      leg.add(mesh, boot);
      leg.position.set(sx, 0.72, 0);
      this.body.add(leg);
    }

    const armGeo = new THREE.BoxGeometry(0.13, 0.46, 0.15);
    for (const [arm, sx] of [
      [this.armL, -0.33],
      [this.armR, 0.33],
    ] as const) {
      const upper = new THREE.Mesh(armGeo, suit);
      upper.position.y = -0.22;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), skin);
      hand.position.y = -0.47;
      arm.add(upper, hand);
      arm.position.set(sx, 1.3, 0);
      arm.rotation.z = sx > 0 ? -0.08 : 0.08;
      this.body.add(arm);
    }

    this.body.add(torso, vest, collar, head, cap, brim, face, backpack, tank);
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }

  setPosition(x: number, y: number, z: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.group.position.copy(this.pos);
  }

  update(dt: number, input: MoveInput, camYaw: number, colliders: THREE.Box3[]) {
    // ---- desired horizontal velocity, camera relative ----
    const len = Math.hypot(input.x, input.z);
    const target = new THREE.Vector3();
    if (len > 0.001) {
      const nx = input.x / len;
      const nz = input.z / len;
      const sin = Math.sin(camYaw);
      const cos = Math.cos(camYaw);
      target.set(nx * cos + nz * sin, 0, -nx * sin + nz * cos);
      target.multiplyScalar(input.sprint ? RUN : WALK);
      this.facing = Math.atan2(target.x, target.z);
    }
    const accel = this.grounded ? 14 : 5;
    this.vel.x += (target.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, accel * dt);

    // ---- vertical ----
    if (input.jump && this.grounded) {
      this.vel.y = JUMP;
      this.grounded = false;
    }
    this.vel.y += GRAVITY * dt;

    const prevY = this.pos.y;
    void prevY;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // ---- collide & support ----
    let support = 0;
    for (const b of colliders) {
      if (!this.overlapsXZ(b)) continue;
      const top = b.max.y;
      const bottom = b.min.y;
      const feet = this.pos.y;
      const head = feet + this.height;

      if (top <= feet + STEP && top > support) support = top;

      const verticalOverlap = head > bottom && feet + 0.06 < top;
      if (!verticalOverlap) continue;
      if (top - feet <= STEP && this.vel.y <= 0.01) continue; // walkable step

      // push out of the box along the shallowest axis
      const cx = THREE.MathUtils.clamp(this.pos.x, b.min.x, b.max.x);
      const cz = THREE.MathUtils.clamp(this.pos.z, b.min.z, b.max.z);
      const dx = this.pos.x - cx;
      const dz = this.pos.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-5) {
        if (dist < this.radius) {
          const push = (this.radius - dist) / dist;
          this.pos.x += dx * push;
          this.pos.z += dz * push;
        }
      } else {
        // centre is inside the footprint: eject on the closest face
        const left = this.pos.x - b.min.x;
        const right = b.max.x - this.pos.x;
        const front = this.pos.z - b.min.z;
        const back = b.max.z - this.pos.z;
        const min = Math.min(left, right, front, back);
        if (min === left) this.pos.x = b.min.x - this.radius;
        else if (min === right) this.pos.x = b.max.x + this.radius;
        else if (min === front) this.pos.z = b.min.z - this.radius;
        else this.pos.z = b.max.z + this.radius;
      }
    }

    if (this.pos.y <= support + 0.001) {
      if (this.vel.y <= 0) {
        this.pos.y = support;
        this.vel.y = 0;
        this.grounded = true;
      }
    } else {
      this.grounded = false;
    }

    // keep the player on the island (expanded map)
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 200) {
      this.pos.x *= 200 / r;
      this.pos.z *= 200 / r;
    }

    // ---- avatar ----
    this.group.position.copy(this.pos);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && speed > 0.4) {
      this.phase += dt * (4.6 + speed * 1.15);
      const swing = Math.sin(this.phase) * Math.min(0.85, speed * 0.12);
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.armL.rotation.x = -swing * 0.75;
      this.armR.rotation.x = swing * 0.75;
      this.bob = Math.abs(Math.sin(this.phase)) * 0.035;
    } else {
      this.legL.rotation.x *= 0.85;
      this.legR.rotation.x *= 0.85;
      this.armL.rotation.x *= 0.85;
      this.armR.rotation.x *= 0.85;
      this.bob += (0 - this.bob) * Math.min(1, dt * 8);
      if (!this.grounded) {
        this.legL.rotation.x = -0.25;
        this.legR.rotation.x = 0.35;
        this.armL.rotation.x = -0.5;
        this.armR.rotation.x = -0.5;
      }
    }
    this.body.position.y = this.bob;

    // smooth facing
    let diff = this.facing - this.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, dt * 14);

    // fell off? reset to plaza
    if (this.pos.y < -6) this.setPosition(0, 0, 8);

    void prevY;
  }

  private overlapsXZ(b: THREE.Box3) {
    const cx = THREE.MathUtils.clamp(this.pos.x, b.min.x, b.max.x);
    const cz = THREE.MathUtils.clamp(this.pos.z, b.min.z, b.max.z);
    return (this.pos.x - cx) ** 2 + (this.pos.z - cz) ** 2 < this.radius * this.radius;
  }
}
