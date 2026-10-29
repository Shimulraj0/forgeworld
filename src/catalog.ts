/**
 * Catalog: the full 2,595-asset NVIDIA SimReady library, indexed locally.
 * Display names, categories and fabrication costs are derived deterministically
 * so every asset in the library is craftable and placeable.
 */

export type Mat = 'wood' | 'stone' | 'metal' | 'polymer' | 'glass' | 'data';
export type Comp = 'plank' | 'plate' | 'sheet' | 'frame' | 'gear' | 'circuit';
export type ItemId = Mat | Comp;
export type Cost = Partial<Record<ItemId, number>>;

export const RAW: Mat[] = ['wood', 'stone', 'metal', 'polymer', 'glass', 'data'];
export const COMPS: Comp[] = ['plank', 'plate', 'sheet', 'frame', 'gear', 'circuit'];

export type ItemInfo = { label: string; icon: string; color: string; short: string };

export const ITEM: Record<ItemId, ItemInfo> = {
  wood: { label: 'Wood', icon: '🪵', color: '#a97442', short: 'Wood' },
  stone: { label: 'Stone', icon: '🪨', color: '#8d97a5', short: 'Stone' },
  metal: { label: 'Metal', icon: '🔩', color: '#9fb3c8', short: 'Metal' },
  polymer: { label: 'Polymer', icon: '🧴', color: '#5eead4', short: 'Polymer' },
  glass: { label: 'Glass', icon: '🔹', color: '#7dd3fc', short: 'Glass' },
  data: { label: 'Data', icon: '💠', color: '#c4b5fd', short: 'Data' },
  plank: { label: 'Plank', icon: '🟫', color: '#b98046', short: 'Plank' },
  plate: { label: 'Metal Plate', icon: '⬜', color: '#b8c6d6', short: 'Plate' },
  sheet: { label: 'Polymer Sheet', icon: '🟦', color: '#5eead4', short: 'Sheet' },
  frame: { label: 'Frame', icon: '🪟', color: '#d2b48c', short: 'Frame' },
  gear: { label: 'Gear', icon: '⚙️', color: '#c9a227', short: 'Gear' },
  circuit: { label: 'Circuit', icon: '🔌', color: '#f472b6', short: 'Circuit' },
};

export type Category =
  | 'Storage'
  | 'Industrial'
  | 'Furniture'
  | 'Office'
  | 'Kitchen'
  | 'Tools'
  | 'Medical'
  | 'Vehicle'
  | 'Nature'
  | 'Prop';

export const CATEGORIES: Category[] = [
  'Storage',
  'Industrial',
  'Furniture',
  'Office',
  'Kitchen',
  'Tools',
  'Medical',
  'Vehicle',
  'Nature',
  'Prop',
];

export const CATEGORY_COLOR: Record<Category, string> = {
  Storage: '#e8b06a',
  Industrial: '#ff8f5e',
  Furniture: '#a3e635',
  Office: '#7dd3fc',
  Kitchen: '#f472b6',
  Tools: '#c4b5fd',
  Medical: '#5eead4',
  Vehicle: '#fbbf24',
  Nature: '#4ade80',
  Prop: '#94a3b8',
};

const RULES: [RegExp, Category][] = [
  [/^(crate|box|pallet|drum|barrel|bin|bucket|container|basket|case_)/, 'Storage'],
  [/^(robot|conveyor|pump|machine_|generator|compressor|valve|pipe|motor|equipment_|electricalSystem|coolingSystem|airSystem|power|pipeline)/, 'Industrial'],
  [/^(furniture_|chair|desk|table_|cabinet|shelf|sofa|lamp_|lighting_|bed_|counter|stool|bench)/, 'Furniture'],
  [/^(computer|monitor|TV|sign_|phone|keyboard|mouse|server|printer)/, 'Office'],
  [/^(appliance|dishware|food_|facilityEquipment_beverage|kitchen|beverage)/, 'Kitchen'],
  [/^(tool|handTool|tools_|cleaning_|paint_|consumable_|equipment_bench)/, 'Tools'],
  [/^(medical|hospital|Xray|surgical|instrument_|IV_pole|anesthesia|bandage|blood_|catheter|clinic|dental|light_surgical)/, 'Medical'],
  [/^(bodyPart|carFrame|engine|brakeSystem|engineComponent|construction_|wheel|tire|truck|forklift|battery)/, 'Vehicle'],
  [/^(plant|tree|food_produce|garden|outdoor)/, 'Nature'],
];

export function categoryOf(id: string): Category {
  for (const [re, cat] of RULES) if (re.test(id)) return cat;
  return 'Prop';
}

const CODE = /^[a-z]\d{1,2}$/;
const ACRONYM = new Set(['tv', 'iv', 'ct', 'led', 'uvc', 'usb', 'ac', 'dc']);

export function prettyName(id: string): string {
  return id
    .split('_')
    .filter(Boolean)
    .map((tok) => {
      if (CODE.test(tok)) return tok.toUpperCase();
      if (ACRONYM.has(tok)) return tok.toUpperCase();
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    })
    .join(' ')
    .replace(/\bA(\d{2})\b/g, 'A$1');
}

export type RawAsset = {
  id: string;
  b: number;
  t: number;
  j: number;
  d: number;
  min: [number, number, number];
  max: [number, number, number];
};

export type AssetInfo = RawAsset & {
  name: string;
  cat: Category;
  tier: number;
  cost: Cost;
  local: boolean;
  thumb: string;
  glb: string;
};

export const HF_BASE = 'https://huggingface.co/datasets/codepawl/simready-glb/resolve/main';
const BASE = import.meta.env.BASE_URL;

export function tierOf(bytes: number): number {
  if (bytes < 300_000) return 1;
  if (bytes < 1_200_000) return 2;
  if (bytes < 4_000_000) return 3;
  return 4;
}

/** Fabrication cost, derived from category + asset weight. */
export function costFor(cat: Category, tier: number): Cost {
  switch (cat) {
    case 'Storage':
      return { plank: tier, plate: Math.max(1, tier - 1) };
    case 'Industrial':
      return { plate: tier, frame: tier, ...(tier >= 2 ? { circuit: 1 } : {}) };
    case 'Furniture':
      return { plank: tier, sheet: tier };
    case 'Office':
      return { plate: tier, circuit: 1, glass: tier };
    case 'Kitchen':
      return { sheet: tier, plate: tier, glass: 1 };
    case 'Tools':
      return { plate: tier, plank: 1 };
    case 'Medical':
      return { plate: tier, glass: tier, circuit: 1 };
    case 'Vehicle':
      return { plate: tier * 2, gear: tier, sheet: 1 };
    case 'Nature':
      return { wood: tier * 2, polymer: 1 };
    default:
      return { plank: tier, sheet: 1 };
  }
}

let catalogCache: AssetInfo[] | null = null;
let byId: Map<string, AssetInfo> | null = null;

export async function loadCatalog(): Promise<AssetInfo[]> {
  if (catalogCache) return catalogCache;
  const [raw, local] = await Promise.all([
    fetch(`${BASE}data/catalog.json`).then((r) => {
      if (!r.ok) throw new Error(`catalog ${r.status}`);
      return r.json() as Promise<RawAsset[]>;
    }),
    fetch(`${BASE}data/local-assets.json`)
      .then((r) => (r.ok ? (r.json() as Promise<string[]>) : []))
      .catch(() => [] as string[]),
  ]);
  const localSet = new Set(local);
  catalogCache = raw.map((a) => {
    const tier = tierOf(a.b);
    const cat = categoryOf(a.id);
    const isLocal = localSet.has(a.id);
    return {
      ...a,
      name: prettyName(a.id),
      cat,
      tier,
      cost: costFor(cat, tier),
      local: isLocal,
      thumb: isLocal ? `${BASE}assets/thumbs/${a.id}.webp` : `${HF_BASE}/thumbs/${a.id}.webp`,
      glb: isLocal ? `${BASE}assets/glb/${a.id}.glb` : `${HF_BASE}/glb/${a.id}.glb`,
    };
  });
  byId = new Map(catalogCache.map((a) => [a.id, a]));
  return catalogCache;
}

export function getAsset(id: string): AssetInfo | undefined {
  return byId?.get(id);
}

export function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}
