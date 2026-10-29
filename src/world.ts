import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uGlow;
  void main() {
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.85));
    float sunAmt = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sunAmt, 900.0) * 2.2;
    col += uSunColor * pow(sunAmt, 8.0) * 0.16 * uGlow;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const DAY_TOP = new THREE.Color('#2a6fd6');
const DAY_HORIZON = new THREE.Color('#c3e0fa');
const DUSK_TOP = new THREE.Color('#2a2b5e');
const DUSK_HORIZON = new THREE.Color('#ff8a52');
const NIGHT_TOP = new THREE.Color('#04060d');
const NIGHT_HORIZON = new THREE.Color('#0b1524');
const SUN_WARM = new THREE.Color('#ffb072');
const SUN_COOL = new THREE.Color('#fff3df');

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

function noiseCanvas(
  size: number,
  base: string,
  speckles: number,
  speckleColors: string[],
  seed = 7,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(seed);
  for (let i = 0; i < speckles; i++) {
    ctx.fillStyle = speckleColors[(rnd() * speckleColors.length) | 0];
    const r = 0.5 + rnd() * 2.4;
    ctx.globalAlpha = 0.25 + rnd() * 0.5;
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly skyMat: THREE.ShaderMaterial;
  readonly grid: THREE.GridHelper;
  private water: THREE.Mesh;
  private clouds: THREE.Sprite[] = [];
  private stars: THREE.Points;
  private sunSprite: THREE.Sprite;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  private sky = new THREE.Mesh();
  private rnd = mulberry32(20261030);
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();

  constructor(renderer: THREE.WebGLRenderer) {
    const scene = this.scene;
    scene.fog = new THREE.Fog(0xc3e0fa, 90, 340);

    // ---- sky dome ----
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: DAY_TOP.clone() },
        uHorizon: { value: DAY_HORIZON.clone() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color('#fff2d6') },
        uGlow: { value: 1 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), this.skyMat);
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // ---- lights ----
    this.hemi = new THREE.HemisphereLight(0xbfe0ff, 0x4b5a3c, 1.1);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff3df, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    const s = 58;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun, this.sun.target);

    // A soft fill so shaded sides keep some form at night.
    const fill = new THREE.DirectionalLight(0x8fb8ff, 0.22);
    fill.position.set(-40, 30, -30);
    scene.add(fill);

    // ---- environment reflections ----
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new RoomEnvironment();
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    scene.environmentIntensity = 0.7;
    pmrem.dispose();

    // ---- ground ----
    const grass = noiseCanvas(256, '#4a6b3d', 2600, ['#3d5a33', '#5b7d47', '#6b8a4e', '#415f37'], 11);
    const grassTex = new THREE.CanvasTexture(grass);
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(26, 26);
    grassTex.colorSpace = THREE.SRGBColorSpace;
    grassTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const island = new THREE.Mesh(
      new THREE.CircleGeometry(62, 128),
      new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, metalness: 0 }),
    );
    island.rotation.x = -Math.PI / 2;
    island.receiveShadow = true;
    scene.add(island);

    // sandy rim
    const sandTex = new THREE.CanvasTexture(
      noiseCanvas(256, '#c8b48a', 1800, ['#b5a077', '#d8c9a4', '#a99168'], 23),
    );
    sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
    sandTex.repeat.set(30, 2);
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(61.5, 66, 128, 1),
      new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = -0.02;
    rim.receiveShadow = true;
    scene.add(rim);

    const waterGeo = new THREE.CircleGeometry(1400, 64);
    this.water = new THREE.Mesh(
      waterGeo,
      new THREE.MeshStandardMaterial({
        color: 0x1d5f7a,
        roughness: 0.12,
        metalness: 0.55,
        transparent: true,
        opacity: 0.94,
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -1.25;
    scene.add(this.water);

    // ---- build plaza ----
    const concrete = noiseCanvas(256, '#5a5f66', 2200, ['#4c5157', '#686e76', '#525860', '#737a83'], 5);
    const concTex = new THREE.CanvasTexture(concrete);
    concTex.wrapS = concTex.wrapT = THREE.RepeatWrapping;
    concTex.repeat.set(7, 7);
    concTex.colorSpace = THREE.SRGBColorSpace;
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(14, 96),
      new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.92, metalness: 0.05 }),
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.012;
    plaza.receiveShadow = true;
    scene.add(plaza);

    const edge = new THREE.Mesh(
      new THREE.RingGeometry(13.85, 14.15, 96),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.4 }),
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.02;
    scene.add(edge);

    this.grid = new THREE.GridHelper(60, 120, 0x7fe3d3, 0x3b5560);
    const gm = this.grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.2;
    this.grid.position.y = 0.03;
    this.grid.visible = false;
    scene.add(this.grid);

    // ---- scenery ----
    this.buildScenery();
    this.buildMountains();

    // ---- sun disc ----
    const glowC = document.createElement('canvas');
    glowC.width = glowC.height = 128;
    const gctx = glowC.getContext('2d')!;
    const grad = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,248,230,1)');
    grad.addColorStop(0.22, 'rgba(255,220,160,0.85)');
    grad.addColorStop(0.55, 'rgba(255,180,110,0.22)');
    grad.addColorStop(1, 'rgba(255,160,90,0)');
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 128, 128);
    const sunTex = new THREE.CanvasTexture(glowC);
    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sunTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.sunSprite.scale.setScalar(90);
    scene.add(this.sunSprite);

    // ---- stars ----
    const starGeo = new THREE.BufferGeometry();
    const count = 900;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(700);
      v.y = Math.abs(v.y) * 0.9 + 40;
      pos.set([v.x, v.y, v.z], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xdfe9ff,
        size: 2.4,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    );
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.setTime(0.34);
  }

  private buildScenery() {
    const rnd = this.rnd;
    const place: [number, number][] = [];
    const isFree = (x: number, z: number, min: number) =>
      place.every(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 > min * min);

    // trees
    const N_TREES = 46;
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.24, 2.1, 6).translate(0, 1.05, 0);
    const leafGeo = new THREE.IcosahedronGeometry(1.15, 0).translate(0, 2.7, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N_TREES);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, N_TREES);
    trunks.castShadow = leaves.castShadow = true;
    trunks.receiveShadow = leaves.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const color = new THREE.Color();

    for (let i = 0; i < N_TREES; i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 30; tries++) {
        const a = rnd() * Math.PI * 2;
        const r = 19 + Math.sqrt(rnd()) * 36;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        if (isFree(x, z, 4.4)) break;
      }
      place.push([x, z]);
      const sc = 0.8 + rnd() * 0.85;
      p.set(x, 0, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      s.set(sc, sc * (0.85 + rnd() * 0.4), sc);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      m.compose(p, q, s.clone().multiplyScalar(1));
      leaves.setMatrixAt(i, m);
      color.setHSL(0.26 + rnd() * 0.09, 0.32 + rnd() * 0.18, 0.28 + rnd() * 0.12);
      leaves.setColorAt(i, color);
      color.setHSL(0.07, 0.25 + rnd() * 0.1, 0.22 + rnd() * 0.08);
      trunks.setColorAt(i, color);
    }
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
    this.scene.add(trunks, leaves);

    // rocks
    const N_ROCKS = 34;
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, N_ROCKS);
    rocks.castShadow = rocks.receiveShadow = true;
    for (let i = 0; i < N_ROCKS; i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 24; tries++) {
        const a = rnd() * Math.PI * 2;
        const r = 17 + Math.sqrt(rnd()) * 40;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        if (isFree(x, z, 2.6)) break;
      }
      place.push([x, z]);
      const sc = 0.3 + rnd() * 1.1;
      p.set(x, sc * 0.35, z);
      q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd()));
      s.set(sc, sc * (0.55 + rnd() * 0.5), sc * (0.8 + rnd() * 0.5));
      m.compose(p, q, s);
      rocks.setMatrixAt(i, m);
      color.setHSL(0.58, 0.04 + rnd() * 0.05, 0.36 + rnd() * 0.14);
      rocks.setColorAt(i, color);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    this.scene.add(rocks);

    // shrubs
    const N_BUSH = 60;
    const bushGeo = new THREE.IcosahedronGeometry(0.55, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, N_BUSH);
    bushes.castShadow = bushes.receiveShadow = true;
    for (let i = 0; i < N_BUSH; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 16 + Math.sqrt(rnd()) * 42;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const sc = 0.5 + rnd() * 0.9;
      p.set(x, sc * 0.35, z);
      q.setFromEuler(new THREE.Euler(rnd() * 0.4, rnd() * 6, rnd() * 0.4));
      s.set(sc * 1.3, sc, sc * 1.2);
      m.compose(p, q, s);
      bushes.setMatrixAt(i, m);
      color.setHSL(0.27 + rnd() * 0.06, 0.3 + rnd() * 0.2, 0.26 + rnd() * 0.1);
      bushes.setColorAt(i, color);
    }
    bushes.instanceMatrix.needsUpdate = true;
    if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
    this.scene.add(bushes);

    // clouds
    const cloudC = document.createElement('canvas');
    cloudC.width = cloudC.height = 128;
    const cc = cloudC.getContext('2d')!;
    const cg = cc.createRadialGradient(64, 64, 4, 64, 64, 62);
    cg.addColorStop(0, 'rgba(255,255,255,0.9)');
    cg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    cc.fillStyle = cg;
    cc.fillRect(0, 0, 128, 128);
    const cloudTex = new THREE.CanvasTexture(cloudC);
    for (let i = 0; i < 16; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: cloudTex,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          fog: false,
        }),
      );
      const a = rnd() * Math.PI * 2;
      const r = 90 + rnd() * 200;
      sp.position.set(Math.cos(a) * r, 42 + rnd() * 46, Math.sin(a) * r);
      const sc = 45 + rnd() * 70;
      sp.scale.set(sc, sc * 0.42, 1);
      sp.userData.drift = 0.6 + rnd() * 1.1;
      this.clouds.push(sp);
      this.scene.add(sp);
    }
  }

  private buildMountains() {
    const rnd = this.rnd;
    const N = 34;
    const geo = new THREE.ConeGeometry(1, 1, 7, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3f5872,
      roughness: 1,
      flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rnd() * 0.12;
      const r = 210 + rnd() * 120;
      const h = 26 + rnd() * 74;
      p.set(Math.cos(a) * r, -2, Math.sin(a) * r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 3);
      s.set(26 + rnd() * 34, h, 26 + rnd() * 34);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      c.setHSL(0.58, 0.16 + rnd() * 0.1, 0.24 + rnd() * 0.12);
      mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);

    // low haze band at the horizon
    const haze = new THREE.Mesh(
      new THREE.CylinderGeometry(300, 300, 26, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x9dc4e6,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    haze.position.y = 4;
    this.scene.add(haze);
  }

  setBuildMode(on: boolean) {
    this.grid.visible = on;
  }

  /** tod: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset */
  setTime(tod: number) {
    const t = ((tod % 1) + 1) % 1;
    const ang = (t - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const azim = Math.cos(ang);
    this.sunDir.set(azim * 0.75, elev, 0.45 * azim + 0.25).normalize();

    const day = THREE.MathUtils.smoothstep(elev, -0.09, 0.3);
    const dusk = Math.exp(-Math.pow(elev * 3.4, 2));
    const night = 1 - day;

    const top = this.tmpC.copy(NIGHT_TOP).lerp(DAY_TOP, day).lerp(DUSK_TOP, dusk * 0.55);
    const hor = this.tmpC2.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, day).lerp(DUSK_HORIZON, dusk * 0.7);

    (this.skyMat.uniforms.uTop.value as THREE.Color).copy(top);
    (this.skyMat.uniforms.uHorizon.value as THREE.Color).copy(hor);
    (this.skyMat.uniforms.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (this.skyMat.uniforms.uSunColor.value as THREE.Color).copy(
      SUN_WARM.clone().lerp(SUN_COOL, day),
    );
    this.skyMat.uniforms.uGlow.value = 0.4 + dusk * 1.4;

    this.sun.position.copy(this.sunDir).multiplyScalar(90);
    this.sun.color.copy(SUN_WARM).lerp(SUN_COOL, day);
    this.sun.intensity = 0.05 + Math.max(0, elev) * 3.1;
    this.sun.visible = elev > -0.12;

    this.hemi.intensity = 0.22 + day * 1.05;
    this.hemi.color.copy(hor).lerp(new THREE.Color('#ffffff'), 0.35);
    this.hemi.groundColor.set('#3d4a33').multiplyScalar(0.4 + day * 0.9);

    (this.scene.fog as THREE.Fog).color.copy(hor);
    this.scene.environmentIntensity = 0.22 + day * 0.6;

    this.sunSprite.position.copy(this.sunDir).multiplyScalar(620);
    const visible = THREE.MathUtils.clamp(elev * 8 + 0.4, 0, 1);
    (this.sunSprite.material as THREE.SpriteMaterial).opacity = visible * 0.95;
    this.sunSprite.scale.setScalar(70 + dusk * 40);

    (this.stars.material as THREE.PointsMaterial).opacity = night * 0.85;
    this.stars.visible = night > 0.05;

    for (const c of this.clouds) {
      const mat = c.material as THREE.SpriteMaterial;
      mat.color.copy(hor).lerp(new THREE.Color('#ffffff'), 0.4 + day * 0.5);
      mat.opacity = 0.18 + day * 0.32;
    }
  }

  update(dt: number, elapsed: number) {
    this.water.position.y = -1.25 + Math.sin(elapsed * 0.5) * 0.025;
    for (const c of this.clouds) {
      c.position.x += (c.userData.drift as number) * dt * 0.6;
      if (c.position.x > 320) c.position.x = -320;
    }
    this.sky.position.set(0, 0, 0);
  }
}
