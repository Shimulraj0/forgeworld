import * as THREE from 'three';
import type { AssetLibrary } from './assets';
import type { AssetInfo } from './catalog';

export type Placed = {
  uid: string;
  id: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  object: THREE.Group;
  box: THREE.Box3;
};

const UP = new THREE.Vector3(0, 1, 0);
const GRID = 0.5;

export class Placer {
  activeId: string | null = null;
  ghost: THREE.Group | null = null;
  valid = false;
  rotation = 0;
  readonly point = new THREE.Vector3();
  private info: AssetInfo | null = null;
  private size = new THREE.Vector3(1, 1, 1);
  private ndc = new THREE.Vector2(0, 0);
  private hasPointer = false;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(UP, 0);
  private tmp = new THREE.Vector3();
  private ghostMats: THREE.MeshStandardMaterial[] = [];
  private marker: THREE.Group;
  private markerQuad: THREE.Mesh;
  private markerLine: THREE.LineLoop;
  private hovered: Placed | null = null;
  private uid = 0;

  constructor(
    private scene: THREE.Scene,
    private assets: AssetLibrary,
    private camera: THREE.Camera,
    private getPlaced: () => Placed[],
  ) {
    const quadMat = new THREE.MeshBasicMaterial({
      color: 0x7ce38b,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.markerQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), quadMat);
    this.markerQuad.rotation.x = -Math.PI / 2;
    const pts = [
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, 0.5),
      new THREE.Vector3(-0.5, 0, 0.5),
    ];
    const lineMat = new THREE.LineBasicMaterial({ color: 0x7ce38b, transparent: true, opacity: 0.9 });
    this.markerLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
    this.marker = new THREE.Group();
    this.marker.add(this.markerQuad, this.markerLine);
    this.marker.position.y = 0.045;
    this.marker.visible = false;
    scene.add(this.marker);
  }

  get active() {
    return this.activeId !== null;
  }

  get hoveredItem() {
    return this.hovered;
  }

  async begin(info: AssetInfo) {
    this.cancel();
    this.info = info;
    this.activeId = info.id;
    this.rotation = 0;
    const ghost = await this.assets.spawn(info);
    if (this.activeId !== info.id) {
      ghost.clear();
      return;
    }
    this.ghost = ghost;
    this.size.copy((ghost.userData.size as THREE.Vector3) ?? new THREE.Vector3(1, 1, 1));
    ghost.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = false;
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : (m.material as THREE.Material).clone();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        std.transparent = true;
        std.opacity = 0.62;
        std.depthWrite = false;
        if ('emissive' in std) {
          std.emissive = new THREE.Color(0x7ce38b);
          std.emissiveIntensity = 0.4;
        }
        this.ghostMats.push(std);
      }
    });
    this.scene.add(ghost);
    this.marker.visible = true;
    this.hasPointer = false;
  }

  cancel() {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost.clear();
    }
    for (const m of this.ghostMats) m.dispose();
    this.ghostMats = [];
    this.ghost = null;
    this.activeId = null;
    this.info = null;
    this.hovered = null;
    this.marker.visible = false;
    this.valid = false;
  }

  rotate(step: number) {
    this.rotation = (this.rotation + step) % (Math.PI * 2);
  }

  setPointer(ndcX: number, ndcY: number) {
    this.ndc.set(ndcX, ndcY);
    this.hasPointer = true;
  }

  clearPointer() {
    this.hasPointer = false;
    this.marker.visible = false;
    if (this.ghost) this.ghost.visible = false;
    this.hovered = null;
  }

  /** Runs every frame: resolves the cursor into a snapped world position. */
  update(playerPos: THREE.Vector3) {
    this.ray.setFromCamera(this.ndc, this.camera);
    this.hovered = this.pick(this.ray);

    if (!this.activeId || !this.ghost) return;
    if (!this.hasPointer) return;
    this.ghost.visible = true;

    const hit = this.surface(this.ray.ray);
    if (!hit) {
      this.valid = false;
      this.ghost.visible = false;
      this.marker.visible = false;
      return;
    }
    this.marker.visible = true;

    const x = Math.round(hit.x / GRID) * GRID;
    const z = Math.round(hit.z / GRID) * GRID;
    const y = hit.y;
    this.point.set(x, y, z);

    this.ghost.position.set(x, y, z);
    this.ghost.rotation.y = this.rotation;

    this.valid = this.check(x, y, z, this.rotation, playerPos);
    const color = this.valid ? 0x7ce38b : 0xff6b6b;
    for (const m of this.ghostMats) {
      m.emissive.setHex(color);
      m.opacity = this.valid ? 0.62 : 0.45;
    }
    (this.markerQuad.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.markerLine.material as THREE.LineBasicMaterial).color.setHex(color);

    const { ex, ez } = this.extents(this.rotation);
    this.marker.position.set(x, y + 0.045, z);
    this.marker.rotation.y = this.rotation;
    this.markerQuad.scale.set(ex * 2, ez * 2, 1);
    this.markerLine.scale.set(ex * 2, 1, ez * 2);
  }

  private extents(ry: number) {
    const c = Math.abs(Math.cos(ry));
    const s = Math.abs(Math.sin(ry));
    const hx = this.size.x / 2;
    const hz = this.size.z / 2;
    return { ex: hx * c + hz * s, ez: hx * s + hz * c };
  }

  private check(x: number, y: number, z: number, ry: number, playerPos: THREE.Vector3): boolean {
    const { ex, ez } = this.extents(ry);
    if (Math.hypot(x, z) + Math.max(ex, ez) > 57) return false;
    if (y < -0.01 || y + this.size.y > 14) return false;
    if (Math.hypot(x - playerPos.x, z - playerPos.z) < Math.max(ex, ez) + 0.55) return false;

    const minY = y + 0.002;
    const maxY = y + this.size.y - 0.002;
    for (const p of this.getPlaced()) {
      if (maxY <= p.box.min.y + 0.02 || minY >= p.box.max.y - 0.02) continue;
      const overlapX = Math.abs(x - (p.box.min.x + p.box.max.x) / 2) < ex + (p.box.max.x - p.box.min.x) / 2 - 0.03;
      const overlapZ = Math.abs(z - (p.box.min.z + p.box.max.z) / 2) < ez + (p.box.max.z - p.box.min.z) / 2 - 0.03;
      if (overlapX && overlapZ) return false;
    }
    return true;
  }

  private surface(ray: THREE.Ray): THREE.Vector3 | null {
    let bestDist = Infinity;
    let found: THREE.Vector3 | null = null;

    const g = ray.intersectPlane(this.plane, new THREE.Vector3());
    if (g && g.distanceTo(ray.origin) < bestDist) {
      bestDist = g.distanceTo(ray.origin);
      found = g;
    }

    for (const p of this.getPlaced()) {
      const h = ray.intersectBox(p.box, this.tmp);
      if (!h) continue;
      if (Math.abs(h.y - p.box.max.y) > 0.09) continue;
      const d = h.distanceTo(ray.origin);
      if (d < bestDist) {
        bestDist = d;
        found = h.clone();
      }
    }
    if (found) found.y = Math.max(0, found.y);
    return found;
  }

  private pick(ray: THREE.Raycaster): Placed | null {
    let best: Placed | null = null;
    let bestD = Infinity;
    for (const p of this.getPlaced()) {
      const h = ray.ray.intersectBox(p.box, this.tmp);
      if (!h) continue;
      const d = h.distanceTo(ray.ray.origin);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  pickAt(ndcX: number, ndcY: number): Placed | null {
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return this.pick(this.ray);
  }

  async confirm(): Promise<Placed | null> {
    if (!this.ghost || !this.info || !this.valid) return null;
    const info = this.info;
    const object = await this.assets.spawn(info);
    object.position.copy(this.ghost.position);
    object.rotation.y = this.rotation;
    this.scene.add(object);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const placed: Placed = {
      uid: `p${++this.uid}_${Math.floor(Math.random() * 9999)}`,
      id: info.id,
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
      ry: this.rotation,
      object,
      box,
    };
    return placed;
  }
}
