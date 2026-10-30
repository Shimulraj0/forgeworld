import * as THREE from 'three';
import { AssetLibrary } from './assets';
import { Placer, type Placed } from './build';
import {
  describeCost,
  addCost,
  emptyInventory,
  expandToRaw,
  trySpend,
  REFINE,
  type Inventory,
} from './economy';
import { getAsset, ITEM, loadCatalog, type AssetInfo, type Comp, type ItemId } from './catalog';
import { GOALS } from './goals';
import { NodeField, NODE_DEF } from './nodes';
import { Player } from './player';
import { sfx } from './sfx';
import { UI } from './ui';
import { World } from './world';
import { clearSave, loadSave, writeSave, type SaveData } from './save';

export type Stats = {
  harvested: Record<string, number>;
  refined: number;
  crafted: number;
  craftedCat: Record<string, number>;
  placedTotal: number;
  placedCat: Record<string, number>;
  unlocked: number;
};

const CAM_MIN = 2.4;
const CAM_MAX = 18;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly world: World;
  readonly assets = new AssetLibrary();
  readonly player = new Player();
  readonly nodes: NodeField;
  readonly placer: Placer;
  ui!: UI;

  catalog: AssetInfo[] = [];
  mats: Inventory = emptyInventory();
  props: Record<string, number> = {};
  unlockedOrder: string[] = [];
  placed: Placed[] = [];
  stats: Stats = {
    harvested: {},
    refined: 0,
    crafted: 0,
    craftedCat: {},
    placedTotal: 0,
    placedCat: {},
    unlocked: 0,
  };
  goalsDone = new Set<string>();
  timeOfDay = 0.34;
  buildMode = false;
  activeItem: string | null = null;
  camYaw = 0;
  camPitch = 0.36;
  camDist = 8.2;

  private clock = new THREE.Clock();
  private elapsed = 0;
  private keys = new Set<string>();
  private pointer = new THREE.Vector2();
  private pointerDown = false;
  private dragging = false;
  private downPos = new THREE.Vector2();
  private lastPointer = new THREE.Vector2();
  private cameraInit = false;
  private contextLost = false;
  private promptText = '';
  private saveTimer = 0;
  private bursts: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  private burstGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  private burstMats = new Map<string, THREE.MeshStandardMaterial>();
  private tmpV = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();

  constructor() {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 1600);
    this.camera.position.set(0, 6, 14);

    this.world = new World(this.renderer);
    this.world.scene.add(this.player.group);
    this.nodes = new NodeField(this.world.scene);
    this.placer = new Placer(this.world.scene, this.assets, this.camera, () => this.placed);

    window.addEventListener('resize', () => this.onResize());
    this.bindContextRecovery();
    this.bindInput();
  }

  // ---------------------------------------------------------------- context

  /**
   * A lost WebGL context (GPU reset, driver crash, tab suspended too long)
   * otherwise leaves a permanently black canvas. Pause the loop, and resume
   * rendering once the browser restores the context.
   */
  private bindContextRecovery() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.ui?.toast('Graphics context lost — restoring…', 'warn');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.clock.getDelta(); // drop the long gap so physics doesn't jump
      this.ui?.toast('Graphics restored', 'good');
    });
  }

  async boot() {
    this.ui = new UI(this);
    this.ui.init();
    this.ui.setLoading(0.12, 'Indexing the SimReady library…');

    await this.assets.init();
    this.ui.setLoading(0.3, 'Reading the asset catalog…');
    this.catalog = await loadCatalog();

    this.ui.setLoading(0.55, 'Raising the island…');
    const save = loadSave();
    if (save) {
      this.applySave(save);
      const placedCount = save.placed.length;
      this.ui.setLoading(0.7, `Restoring ${placedCount} props…`);
      await this.restorePlaced(save.placed);
    } else {
      this.nodes.generate();
      this.player.setPosition(0, 0, 10);
    }

    this.ui.setLoading(0.92, 'Warming the fabricator…');
    const local = this.catalog.filter((a) => a.local);
    this.assets.warm(local.slice(0, 6));
    this.ui.setLoading(1, 'Ready');

    const start = this.catalog.find((a) => a.local && a.id === 'pallet_a01');
    if (start && !save) this.props[start.id] = 1;

    this.ui.refresh();
    this.ui.hideLoading();

    if (!save) {
      this.ui.showIntro();
      this.saveTimer = 0;
    } else {
      this.ui.hideIntro();
    }

    this.clock.start();
    this.animate();
  }

  // ---------------------------------------------------------------- input

  private bindInput() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('pointerdown', (e) => {
      sfx.unlock();
      if (e.button === 2) return;
      this.pointerDown = true;
      this.dragging = false;
      this.downPos.set(e.clientX, e.clientY);
      this.lastPointer.set(e.clientX, e.clientY);
      canvas.classList.add('dragging');
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      this.updatePointerNDC(e.clientX, e.clientY);
      if (!this.pointerDown) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer.set(e.clientX, e.clientY);
      if (!this.dragging && Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 4) {
        this.dragging = true;
      }
      if (this.dragging) {
        this.camYaw -= dx * 0.005;
        this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004, 0.03, 1.32);
      }
    });

    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 2) return;
      this.pointerDown = false;
      canvas.classList.remove('dragging');
      if (!this.dragging) this.onClick();
    });

    canvas.addEventListener('pointerleave', () => {
      this.pointerDown = false;
      canvas.classList.remove('dragging');
      this.placer.clearPointer();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = THREE.MathUtils.clamp(this.camDist * Math.exp(e.deltaY * 0.0011), CAM_MIN, CAM_MAX);
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.buildMode || this.placer.active) this.removeUnderCursor();
    });

    window.addEventListener('keydown', (e) => {
      sfx.unlock();
      if (!this.ui) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (this.ui.anyModalOpen() && k !== 'escape') return;
      if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      this.keys.add(k);
      if (e.repeat) return;
      if (k === 'e') this.gather();
      else if (k === 'r') this.placer.rotate(Math.PI / 12);
      else if (k === 'b') this.toggleBuild();
      else if (k === 'c') this.ui.togglePanel('refine');
      else if (k === 'l') this.ui.togglePanel('library');
      else if (k === 'h') this.ui.showHelp();
      else if (k === 'escape') this.onEscape();
      else if (k === 'x' && this.buildMode) this.removeUnderCursor();
      else if (/^[1-8]$/.test(k)) this.ui.selectHotbar(Number(k) - 1);
    });

    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('beforeunload', () => this.save());
  }

  private updatePointerNDC(clientX: number, clientY: number) {
    this.pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  }

  private onClick() {
    if (this.placer.active) {
      void this.confirmPlace();
    }
  }

  private onEscape() {
    if (this.ui.anyModalOpen()) {
      this.ui.closeModal();
      return;
    }
    if (this.placer.active) {
      this.stopPlacing();
      return;
    }
    if (this.ui.panelOpen()) this.ui.closePanel();
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  // ---------------------------------------------------------------- actions

  toggleBuild() {
    if (this.placer.active) {
      this.stopPlacing();
      return;
    }
    this.buildMode = !this.buildMode;
    this.world.setBuildMode(this.buildMode);
    this.renderer.domElement.classList.toggle('placing', this.buildMode);
    if (this.buildMode) this.ui.openPanel('build');
    this.ui.refresh();
  }

  async selectPlace(id: string) {
    const info = getAsset(id);
    if (!info) return;
    if ((this.props[id] ?? 0) <= 0) {
      this.ui.toast(`Fabricate a ${info.name} first`, 'warn');
      sfx.error();
      return;
    }
    this.buildMode = true;
    this.world.setBuildMode(true);
    this.renderer.domElement.classList.add('placing');
    this.activeItem = id;
    await this.placer.begin(info);
    this.ui.refresh();
  }

  stopPlacing() {
    this.placer.cancel();
    this.activeItem = null;
    this.buildMode = false;
    this.world.setBuildMode(false);
    this.renderer.domElement.classList.remove('placing');
    this.ui.refresh();
  }

  private async confirmPlace() {
    const id = this.placer.activeId;
    const placed = await this.placer.confirm();
    if (!placed || !id) {
      sfx.error();
      return;
    }
    this.stats.placedTotal++;
    const cat = getAsset(id)?.cat ?? 'Prop';
    this.stats.placedCat[cat] = (this.stats.placedCat[cat] ?? 0) + 1;
    this.placed.push(placed);
    this.props[id] = Math.max(0, (this.props[id] ?? 0) - 1);
    this.burst(placed.object.position.clone().setY(placed.y + 0.1), new THREE.Color('#ffd28a'), 10);
    sfx.place();
    if (this.props[id] <= 0) {
      this.ui.toast(`That was the last ${getAsset(id)?.name ?? 'one'} — fabricate more`, 'warn');
      this.stopPlacing();
    }
    this.checkGoals();
    this.ui.refresh();
  }

  private removeUnderCursor() {
    const hit = this.placer.pickAt(this.pointer.x, this.pointer.y);
    if (hit) this.removePlaced(hit);
  }

  removePlaced(p: Placed) {
    this.world.scene.remove(p.object);
    this.assets.releaseId(p.id);
    const idx = this.placed.indexOf(p);
    if (idx >= 0) this.placed.splice(idx, 1);
    this.props[p.id] = (this.props[p.id] ?? 0) + 1;
    this.stats.placedTotal = Math.max(0, this.stats.placedTotal - 1);
    const cat = getAsset(p.id)?.cat ?? 'Prop';
    this.stats.placedCat[cat] = Math.max(0, (this.stats.placedCat[cat] ?? 0) - 1);
    this.burst(p.object.position.clone().setY(p.y + 0.5), new THREE.Color('#9fb3c8'), 8);
    sfx.remove();
    this.ui.toast(`Recovered ${getAsset(p.id)?.name ?? 'prop'}`, 'good');
    this.ui.refresh();
  }

  private gather() {
    const near = this.nodes.nearest(this.player.pos, 3.8);
    if (!near) {
      sfx.error();
      return;
    }
    const node = near.node;
    const gains = node.harvest();
    addCost(this.mats, gains);
    const def = NODE_DEF[node.kind];
    this.stats.harvested[node.kind] = (this.stats.harvested[node.kind] ?? 0) + 1;
    sfx.harvest();
    const p = node.position.clone().setY(1.1);
    this.burst(p, new THREE.Color(ITEM[Object.keys(gains)[0] as ItemId].color), 14);
    this.ui.floater(`+${describeCost(gains)}`, p);
    this.ui.toast(`${def.verb} · +${describeCost(gains)}`, 'good');
    this.checkGoals();
    this.ui.refresh();
  }

  craftComponent(comp: Comp): boolean {
    const cost = REFINE[comp];
    const next = trySpend(this.mats, cost);
    if (!next) {
      this.ui.toast(`Not enough stock for ${ITEM[comp].label}`, 'warn');
      sfx.error();
      return false;
    }
    this.mats = next;
    this.mats[comp] = (this.mats[comp] ?? 0) + 1;
    this.stats.refined++;
    sfx.craft();
    this.ui.toast(`Refined ${ITEM[comp].label} · −${describeCost(cost)}`);
    this.checkGoals();
    this.ui.refresh();
    return true;
  }

  fabricate(id: string): boolean {
    const info = getAsset(id);
    if (!info) return false;
    const next = trySpend(this.mats, info.cost);
    if (!next) {
      const raw = expandToRaw(info.cost);
      const missing = (Object.entries(raw) as [ItemId, number][])
        .filter(([k, v]) => (this.mats[k] ?? 0) < v)
        .map(([k, v]) => `${v - (this.mats[k] ?? 0)} ${ITEM[k].short}`);
      this.ui.toast(`Not enough stock: need ${missing.join(', ')}`, 'warn');
      sfx.error();
      return false;
    }
    this.mats = next;
    this.props[id] = (this.props[id] ?? 0) + 1;
    this.stats.crafted++;
    this.stats.craftedCat[info.cat] = (this.stats.craftedCat[info.cat] ?? 0) + 1;
    if (!this.unlockedOrder.includes(id)) {
      this.unlockedOrder.unshift(id);
      this.stats.unlocked = this.unlockedOrder.length;
      sfx.discover();
    } else {
      sfx.craft();
    }
    this.ui.toast(`Fabricated ${info.name}`, 'good');
    this.checkGoals();
    this.ui.refresh();
    return true;
  }

  async fabricateAndPlace(id: string) {
    if (this.fabricate(id)) {
      this.ui.closeModal();
      this.ui.closePanel();
      await this.selectPlace(id);
    }
  }

  checkGoals() {
    for (const g of GOALS) {
      if (this.goalsDone.has(g.id)) continue;
      const [n, total] = g.progress(this);
      if (n < total) continue;
      this.goalsDone.add(g.id);
      addCost(this.mats, g.reward, 1);
      sfx.goal();
      this.ui.toast(`Objective complete · ${g.label}`, 'good');
    }
  }

  // ---------------------------------------------------------------- save

  save() {
    if (!this.ui || this.catalog.length === 0) return;
    const data: SaveData = {
      v: 1,
      mats: this.mats,
      props: this.props,
      placed: this.placed.map((p) => ({ id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(3), z: +p.z.toFixed(2), ry: +p.ry.toFixed(3) })),
      unlocked: this.unlockedOrder,
      stats: this.stats,
      goals: [...this.goalsDone],
      tod: this.timeOfDay,
      player: [+this.player.pos.x.toFixed(2), +this.player.pos.y.toFixed(2), +this.player.pos.z.toFixed(2)],
      cam: [this.camYaw, this.camPitch, this.camDist],
      nodes: this.nodes.serialize(),
    };
    writeSave(data);
  }

  private applySave(s: SaveData) {
    this.mats = { ...emptyInventory(), ...s.mats };
    this.props = s.props ?? {};
    this.unlockedOrder = s.unlocked ?? [];
    this.stats = { ...this.stats, ...s.stats };
    this.goalsDone = new Set(s.goals ?? []);
    this.timeOfDay = s.tod ?? 0.34;
    if (s.player) this.player.setPosition(s.player[0], s.player[1], s.player[2]);
    if (s.cam) {
      this.camYaw = s.cam[0];
      this.camPitch = s.cam[1];
      this.camDist = s.cam[2];
    }
    if (s.nodes && s.nodes.length) this.nodes.restore(s.nodes);
    else this.nodes.generate();
  }

  private async restorePlaced(list: { id: string; x: number; y: number; z: number; ry: number }[]) {
    const results = await Promise.all(
      list.map(async (p) => {
        const info = getAsset(p.id);
        if (!info) return null;
        const obj = await this.assets.spawn(info);
        obj.position.set(p.x, p.y, p.z);
        obj.rotation.y = p.ry;
        this.world.scene.add(obj);
        obj.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(obj);
        return { uid: `s${Math.random().toString(36).slice(2, 8)}`, ...p, object: obj, box } as Placed;
      }),
    );
    this.placed = results.filter((r): r is Placed => r !== null);
    this.stats.placedTotal = this.placed.length;
  }

  resetWorld() {
    clearSave();
    window.location.reload();
  }

  // ---------------------------------------------------------------- burst

  private burst(pos: THREE.Vector3, color: THREE.Color, count: number) {
    let mat = this.burstMats.get(color.getHexString());
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5,
        roughness: 0.6,
      });
      this.burstMats.set(color.getHexString(), mat);
    }
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.burstGeo, mat);
      mesh.position.copy(pos);
      mesh.position.y += Math.random() * 0.4;
      this.world.scene.add(mesh);
      this.bursts.push({
        mesh,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 3.2,
          1.5 + Math.random() * 2.4,
          (Math.random() - 0.5) * 3.2,
        ),
        life: 0.7 + Math.random() * 0.5,
      });
    }
  }

  private updateBursts(dt: number) {
    // Remove completed bursts first
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dt;
      b.vel.y -= 9 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += dt * 6;
      b.mesh.rotation.y += dt * 4;
      b.mesh.scale.setScalar(Math.max(0.01, b.life * 1.4));
      if (b.life <= 0) {
        this.world.scene.remove(b.mesh);
        this.bursts.splice(i, 1);
      }
    }
  }

  private colliders(): THREE.Box3[] {
    return this.placed.map((p) => p.box);
  }

  private updateCamera(dt: number) {
    const target = this.tmpV.copy(this.player.pos);
    target.y += 1.4;
    const dir = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    ).normalize();

    let dist = this.camDist;
    this.raycaster.set(target, dir);
    for (const b of this.colliders()) {
      const hit = this.raycaster.ray.intersectBox(b, new THREE.Vector3());
      if (!hit) continue;
      const d = hit.distanceTo(target);
      if (d > 0.35 && d < dist) dist = Math.max(0.9, d - 0.3);
    }
    const desired = target.clone().addScaledVector(dir, dist);
    desired.y = Math.max(0.55, desired.y);
    if (!this.cameraInit) {
      this.camera.position.copy(desired);
      this.cameraInit = true;
    } else {
      this.camera.position.lerp(desired, 1 - Math.exp(-14 * dt));
    }
    this.camera.lookAt(target);
  }

  private updatePrompt() {
    let text = '';
    if (this.placer.active) {
      const name = getAsset(this.placer.activeId ?? '')?.name ?? '';
      text = this.placer.valid
        ? `<kbd>Click</kbd> place ${name} <span class="sep">·</span> <kbd>R</kbd> rotate <span class="sep">·</span> <kbd>Esc</kbd> cancel`
        : `<span class="warn">Blocked</span> <span class="sep">·</span> <kbd>R</kbd> rotate <span class="sep">·</span> <kbd>Esc</kbd> cancel`;
    } else {
      const near = this.nodes.nearest(this.player.pos, 3.8);
      if (near) {
        const def = NODE_DEF[near.node.kind];
        text = `<kbd>E</kbd> ${def.verb} <span class="node">${def.label}</span> <span class="sep">·</span> +${describeCost(def.yields)}`;
      } else if (this.buildMode && this.placer.hoveredItem) {
        text = `<kbd>X</kbd> / right-click remove ${getAsset(this.placer.hoveredItem.id)?.name ?? ''}`;
      } else if (this.buildMode) {
        text = 'Build mode <span class="sep">·</span> pick a prop from the fabricator <span class="sep">·</span> <kbd>B</kbd> exit';
      }
    }
    if (text !== this.promptText) {
      this.promptText = text;
      this.ui.setPrompt(text || null);
    }
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.contextLost) return;
    this.elapsed += dt;

    const forward = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    const strafe = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    this.player.update(
      dt,
      { x: strafe, z: -forward, sprint: this.keys.has('shift'), jump: this.keys.has(' ') },
      this.camYaw,
      this.colliders(),
    );

    this.placer.setPointer(this.pointer.x, this.pointer.y);
    this.placer.update(this.player.pos);

    this.timeOfDay = (this.timeOfDay + dt / 420) % 1;
    this.world.setTime(this.timeOfDay);
    this.world.sun.target.position.set(this.player.pos.x, 0, this.player.pos.z);
    this.world.sun.position.copy(this.world.sunDir).multiplyScalar(90).add(this.world.sun.target.position);
    this.world.sun.target.updateMatrixWorld();

    this.nodes.update(dt, this.elapsed, this.player.pos);
    this.updateCamera(dt);
    this.updateBursts(dt);
    this.world.update(dt, this.elapsed);
    this.updatePrompt();
    this.ui.tick(dt);

    this.saveTimer += dt;
    if (this.saveTimer > 15) {
      this.saveTimer = 0;
      this.save();
    }

    this.renderer.render(this.world.scene, this.camera);
  };
}
