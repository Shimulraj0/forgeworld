import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { AssetInfo } from './catalog';
import { CATEGORY_COLOR } from './catalog';

type Entry = {
  proto: THREE.Group;
  size: THREE.Vector3;
  live: number;
  fallback: boolean;
};

const MAX_PROTOS = 64;

/**
 * Streams glTF/GLB prototypes (meshopt + webp compressed) from the bundled
 * starter pack or straight from the Hugging Face dataset, then hands out clones.
 * Assets that fail to load degrade to a labelled proxy box so the game never breaks.
 */
export class AssetLibrary {
  private loader = new GLTFLoader();
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<Entry>>();
  private order: string[] = [];
  private active = 0;
  private waiters: (() => void)[] = [];
  private ready = false;

  async init() {
    if (this.ready) return;
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    try {
      await MeshoptDecoder.ready;
    } catch {
      /* meshopt wasm failed — compressed assets will fall back */
    }
    this.ready = true;
  }

  private async gate<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= 4) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }

  async load(info: AssetInfo): Promise<Entry> {
    const hit = this.entries.get(info.id);
    if (hit) {
      this.touch(info.id);
      return hit;
    }
    const inflight = this.pending.get(info.id);
    if (inflight) return inflight;

    const p = this.gate(() => this.loadProto(info))
      .then((entry) => {
        this.entries.set(info.id, entry);
        this.order.push(info.id);
        this.pending.delete(info.id);
        this.evict();
        return entry;
      })
      .catch((err) => {
        console.warn(`[assets] ${info.id} failed, using proxy`, err);
        const entry = proxyFor(info);
        this.entries.set(info.id, entry);
        this.pending.delete(info.id);
        return entry;
      });
    this.pending.set(info.id, p);
    return p;
  }

  private async loadProto(info: AssetInfo): Promise<Entry> {
    const gltf = await this.loader.loadAsync(info.glb);
    const root = gltf.scene;

    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (!isFinite(box.min.x) || box.isEmpty()) throw new Error('empty geometry');
    const size = box.getSize(new THREE.Vector3());

    // SimReady is authored at real-world scale; keep it, but tame outliers.
    let s = 1;
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 8) s = 8 / maxDim;
    if (size.y * s > 5) s = 5 / size.y;
    if (maxDim > 0 && maxDim < 0.02) s = 0.02 / maxDim;
    if (s !== 1) root.scale.multiplyScalar(s);

    root.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(root);
    const c = b2.getCenter(new THREE.Vector3());
    root.position.x -= c.x;
    root.position.z -= c.z;
    root.position.y -= b2.min.y;
    root.updateMatrixWorld(true);

    const finalSize = b2.getSize(new THREE.Vector3());

    let triangles = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const geo = m.geometry;
      if (geo?.index) triangles += geo.index.count / 3;
      else if (geo?.attributes.position) triangles += geo.attributes.position.count / 3;

      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std || !('isMeshStandardMaterial' in std)) continue;
        if (std.map) std.map.anisotropy = Math.min(8, std.map.anisotropy || 1);
        // SimReady glass/photogrammetry occasionally ships double-sided sheets.
        if (std.transparent) std.depthWrite = false;
      }
    });

    const wrap = new THREE.Group();
    wrap.name = info.id;
    wrap.add(root);
    const entry: Entry = {
      proto: wrap,
      size: finalSize,
      live: 0,
      fallback: false,
    };
    wrap.userData.tris = Math.round(triangles);
    return entry;
  }

  async spawn(info: AssetInfo): Promise<THREE.Group> {
    const entry = await this.load(info);
    entry.live++;
    const clone = entry.proto.clone(true);
    clone.userData.assetId = info.id;
    clone.userData.size = entry.size.clone();
    clone.userData.fallback = entry.fallback;
    clone.userData.tier = info.tier;
    return clone;
  }

  async sizeOf(info: AssetInfo): Promise<THREE.Vector3> {
    const entry = await this.load(info);
    return entry.size.clone();
  }

  releaseId(id: string) {
    const e = this.entries.get(id);
    if (e && e.live > 0) e.live--;
  }

  /** Warm a handful of prototypes in the background. */
  warm(list: AssetInfo[]) {
    for (const info of list) void this.load(info).catch(() => {});
  }

  private touch(id: string) {
    const i = this.order.indexOf(id);
    if (i >= 0) {
      this.order.splice(i, 1);
      this.order.push(id);
    }
  }

  private evict() {
    while (this.order.length > MAX_PROTOS) {
      const idx = this.order.findIndex((id) => (this.entries.get(id)?.live ?? 0) === 0);
      if (idx < 0) return;
      const id = this.order.splice(idx, 1)[0];
      const e = this.entries.get(id);
      if (!e) continue;
      disposeObject(e.proto);
      this.entries.delete(id);
    }
  }
}

export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat) continue;
      const anyMat = mat as THREE.MeshStandardMaterial;
      anyMat.map?.dispose();
      anyMat.alphaMap?.dispose();
      anyMat.normalMap?.dispose();
      anyMat.roughnessMap?.dispose();
      anyMat.metalnessMap?.dispose();
      anyMat.emissiveMap?.dispose();
      anyMat.aoMap?.dispose();
      mat.dispose();
    }
  });
}

function proxyFor(info: AssetInfo): Entry {
  const w = Math.min(2.2, Math.max(0.35, info.max[0] - info.min[0] || 0.6));
  const h = Math.min(2.4, Math.max(0.35, info.max[1] - info.min[1] || 0.6));
  const d = Math.min(2.2, Math.max(0.35, info.max[2] - info.min[2] || 0.6));
  const geo = new THREE.BoxGeometry(w, h, d);
  const color = new THREE.Color(CATEGORY_COLOR[info.cat]);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = h / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  edges.position.y = h / 2;
  const wrap = new THREE.Group();
  wrap.add(mesh, edges);
  wrap.userData.tris = 0;
  return {
    proto: wrap,
    size: new THREE.Vector3(w, h, d),
    live: 0,
    fallback: true,
  };
}
