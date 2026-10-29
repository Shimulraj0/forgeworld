import * as THREE from 'three';
import type { Cost } from './catalog';

export type NodeKind = 'tree' | 'rock' | 'scrap' | 'plastic' | 'crystal' | 'terminal';

export type NodeDef = {
  label: string;
  verb: string;
  yields: Cost;
  respawn: number;
  icon: string;
  range: number;
};

export const NODE_DEF: Record<NodeKind, NodeDef> = {
  tree: { label: 'Silverleaf tree', verb: 'Chop', yields: { wood: 4 }, respawn: 24, icon: '🪵', range: 3.4 },
  rock: { label: 'Stone outcrop', verb: 'Mine', yields: { stone: 3, metal: 1 }, respawn: 30, icon: '🪨', range: 3.2 },
  scrap: { label: 'Scrap heap', verb: 'Salvage', yields: { metal: 3 }, respawn: 26, icon: '🔩', range: 3.2 },
  plastic: { label: 'Polymer drums', verb: 'Collect', yields: { polymer: 4 }, respawn: 22, icon: '🧴', range: 3.2 },
  crystal: { label: 'Silica crystal', verb: 'Harvest', yields: { glass: 2, data: 1 }, respawn: 38, icon: '🔹', range: 3.2 },
  terminal: { label: 'Dead terminal', verb: 'Extract', yields: { data: 3 }, respawn: 44, icon: '💠', range: 3.0 },
};

const COLORS = {
  bark: '#5f4429',
  leafA: '#3f7d3b',
  leafB: '#51914a',
  stone: '#7d858f',
  rust: '#8a5a3c',
  steel: '#9aa7b4',
  drum: '#2b6f9f',
  drumTop: '#1c4f74',
  crystal: '#2ee6c8',
  screen: '#7c5cff',
};

function mat(color: string, opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05, ...opts });
}

export class ResourceNode {
  readonly group = new THREE.Group();
  readonly visual = new THREE.Group();
  readonly ring: THREE.Mesh;
  cooldown = 0;
  private grow = 1;
  private rnd: () => number;

  constructor(
    readonly id: number,
    readonly kind: NodeKind,
    x: number,
    z: number,
    seed: number,
  ) {
    let s = seed;
    this.rnd = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    this.group.position.set(x, 0, z);
    this.group.rotation.y = this.rnd() * Math.PI * 2;
    this.group.add(this.visual);
    this.build();

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.32, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffc247,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.035;
    this.ring.visible = false;
    this.group.add(this.ring);

    this.visual.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }

  get position() {
    return this.group.position;
  }

  get ready() {
    return this.cooldown <= 0;
  }

  private build() {
    const r = this.rnd;
    switch (this.kind) {
      case 'tree': {
        const h = 2.6 + r() * 1.1;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.32, h, 7), mat(COLORS.bark, { roughness: 1 }));
        trunk.position.y = h / 2;
        this.visual.add(trunk);
        const blobs = 3;
        for (let i = 0; i < blobs; i++) {
          const rad = 0.95 + r() * 0.55;
          const leaf = new THREE.Mesh(
            new THREE.IcosahedronGeometry(rad, 0),
            mat(i % 2 ? COLORS.leafA : COLORS.leafB, { flatShading: true, roughness: 0.95 }),
          );
          leaf.position.set((r() - 0.5) * 0.8, h + 0.1 + i * 0.5, (r() - 0.5) * 0.8);
          leaf.scale.set(1, 0.9 + r() * 0.3, 1);
          this.visual.add(leaf);
        }
        // stump ring detail
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.12, 10), mat('#4b3520'));
        base.position.y = 0.06;
        this.visual.add(base);
        break;
      }
      case 'rock': {
        for (let i = 0; i < 4; i++) {
          const rad = 0.42 + r() * 0.62;
          const m = new THREE.Mesh(
            new THREE.DodecahedronGeometry(rad, 0),
            mat(COLORS.stone, { flatShading: true, roughness: 0.95 }),
          );
          m.position.set((r() - 0.5) * 1.15, rad * 0.72, (r() - 0.5) * 1.15);
          m.rotation.set(r() * 3, r() * 3, r() * 3);
          this.visual.add(m);
        }
        break;
      }
      case 'scrap': {
        const materials = [mat(COLORS.rust, { metalness: 0.4 }), mat(COLORS.steel, { metalness: 0.7, roughness: 0.55 })];
        for (let i = 0; i < 6; i++) {
          const w = 0.3 + r() * 0.55;
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(w, 0.12 + r() * 0.3, w * (0.5 + r())),
            materials[i % 2],
          );
          m.position.set((r() - 0.5) * 0.9, 0.12 + i * 0.11, (r() - 0.5) * 0.9);
          m.rotation.set(r() * 0.7, r() * 3, r() * 0.5);
          this.visual.add(m);
        }
        const pipe = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.12, 1.35, 8),
          mat(COLORS.steel, { metalness: 0.8, roughness: 0.45 }),
        );
        pipe.rotation.z = Math.PI / 2.4;
        pipe.position.y = 0.65;
        this.visual.add(pipe);
        break;
      }
      case 'plastic': {
        for (let i = 0; i < 2; i++) {
          const drum = new THREE.Mesh(
            new THREE.CylinderGeometry(0.34, 0.34, 0.86, 14),
            mat(COLORS.drum, { roughness: 0.55 }),
          );
          drum.position.set(i === 0 ? -0.38 : 0.42, 0.43, i === 0 ? -0.1 : 0.25);
          drum.rotation.y = r();
          const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.06, 14), mat(COLORS.drumTop));
          lid.position.y = 0.45;
          drum.add(lid);
          this.visual.add(drum);
        }
        for (let i = 0; i < 3; i++) {
          const cube = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.35), mat('#56c2b4', { roughness: 0.4 }));
          cube.position.set((r() - 0.5) * 1.2, 0.09, (r() - 0.5) * 1.2);
          cube.rotation.y = r() * 3;
          this.visual.add(cube);
        }
        break;
      }
      case 'crystal': {
        const glow = new THREE.MeshStandardMaterial({
          color: COLORS.crystal,
          emissive: COLORS.crystal,
          emissiveIntensity: 0.55,
          roughness: 0.15,
          metalness: 0.3,
          transparent: true,
          opacity: 0.92,
        });
        const rockBase = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), mat('#4d5a63', { flatShading: true }));
        rockBase.scale.y = 0.4;
        rockBase.position.y = 0.14;
        this.visual.add(rockBase);
        for (let i = 0; i < 4; i++) {
          const h = 0.6 + r() * 0.85;
          const shard = new THREE.Mesh(new THREE.ConeGeometry(0.2 + r() * 0.1, h, 5), glow);
          shard.position.set((r() - 0.5) * 0.7, 0.1 + h / 2, (r() - 0.5) * 0.7);
          shard.rotation.set((r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5);
          this.visual.add(shard);
        }
        break;
      }
      case 'terminal': {
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.15, 0.55), mat('#2b333d', { metalness: 0.5, roughness: 0.6 }));
        base.position.y = 0.58;
        const screen = new THREE.Mesh(
          new THREE.PlaneGeometry(0.72, 0.46),
          new THREE.MeshStandardMaterial({
            color: '#120b2e',
            emissive: COLORS.screen,
            emissiveIntensity: 0.8,
            roughness: 0.2,
          }),
        );
        screen.position.set(0, 0.78, 0.285);
        const antenna = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5),
          mat('#8b98a6', { metalness: 0.8 }),
        );
        antenna.position.set(0.3, 1.4, 0);
        const tip = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 8, 6),
          new THREE.MeshStandardMaterial({ color: '#ff4d6d', emissive: '#ff4d6d', emissiveIntensity: 1 }),
        );
        tip.position.set(0.3, 1.66, 0);
        this.visual.add(base, screen, antenna, tip);
        break;
      }
    }
  }

  harvest(): Cost {
    this.cooldown = NODE_DEF[this.kind].respawn;
    this.grow = 1;
    return { ...NODE_DEF[this.kind].yields };
  }

  update(dt: number, elapsed: number, near: boolean) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    const target = this.cooldown > 0 || !this.ready ? 0.06 : 1;
    this.grow += (target - this.grow) * Math.min(1, dt * 4.2);
    const s = Math.max(0.02, this.grow * (0.94 + Math.sin(elapsed * 1.6 + this.id) * 0.01));
    this.visual.scale.setScalar(s);
    this.visual.position.y = (1 - this.grow) * -0.15;
    this.ring.visible = near && this.ready;
    if (this.ring.visible) {
      this.ring.rotation.z = elapsed * 0.7;
      const pulse = 1 + Math.sin(elapsed * 3) * 0.035;
      this.ring.scale.setScalar(pulse);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.32 + Math.sin(elapsed * 3) * 0.14;
    }
  }
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SavedNode = { k: NodeKind; x: number; z: number; c: number };

const PLAN: [NodeKind, number][] = [
  ['tree', 12],
  ['rock', 8],
  ['scrap', 7],
  ['plastic', 5],
  ['crystal', 4],
  ['terminal', 3],
];

export class NodeField {
  nodes: ResourceNode[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  generate(seed = Math.floor(Math.random() * 1e9)) {
    this.clear();
    const rnd = mulberry32(seed);
    const placed: [number, number][] = [];
    let id = 0;
    for (const [kind, count] of PLAN) {
      for (let i = 0; i < count; i++) {
        let x = 0;
        let z = 0;
        let ok = false;
        for (let tries = 0; tries < 60; tries++) {
          const a = rnd() * Math.PI * 2;
          const rad = 17.5 + Math.sqrt(rnd()) * 34;
          x = Math.cos(a) * rad;
          z = Math.sin(a) * rad;
          if (placed.every(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 > 4.2 ** 2)) {
            ok = true;
            break;
          }
        }
        if (!ok) continue;
        placed.push([x, z]);
        const node = new ResourceNode(id++, kind, x, z, seed + id * 7919);
        this.nodes.push(node);
        this.scene.add(node.group);
      }
    }
  }

  restore(data: SavedNode[]) {
    this.clear();
    data.forEach((d, i) => {
      const node = new ResourceNode(i, d.k, d.x, d.z, i * 7919 + 13);
      node.cooldown = Math.max(0, d.c);
      this.nodes.push(node);
      this.scene.add(node.group);
    });
  }

  serialize(): SavedNode[] {
    return this.nodes.map((n) => ({ k: n.kind, x: +n.position.x.toFixed(2), z: +n.position.z.toFixed(2), c: +n.cooldown.toFixed(1) }));
  }

  private clear() {
    for (const n of this.nodes) this.scene.remove(n.group);
    this.nodes = [];
  }

  nearest(pos: THREE.Vector3, maxDist = 3.4): { node: ResourceNode; dist: number } | null {
    let best: ResourceNode | null = null;
    let bestD = maxDist;
    for (const n of this.nodes) {
      if (!n.ready) continue;
      const d = Math.hypot(n.position.x - pos.x, n.position.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best ? { node: best, dist: bestD } : null;
  }

  update(dt: number, elapsed: number, playerPos: THREE.Vector3) {
    const near = this.nearest(playerPos, 4.2);
    for (const n of this.nodes) {
      const d = Math.hypot(n.position.x - playerPos.x, n.position.z - playerPos.z);
      n.update(dt, elapsed, near?.node === n || d < 4.2);
    }
  }
}
