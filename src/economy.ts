import type { Comp, Cost, ItemId, Mat } from './catalog';
import { COMPS, ITEM } from './catalog';

export type Inventory = Record<ItemId, number>;

export function emptyInventory(): Inventory {
  return {
    wood: 0,
    stone: 0,
    metal: 0,
    polymer: 0,
    glass: 0,
    data: 0,
    plank: 0,
    plate: 0,
    sheet: 0,
    frame: 0,
    gear: 0,
    circuit: 0,
  };
}

/** One-step conversion recipes: raw stock -> components. */
export const REFINE: Record<Comp, Cost> = {
  plank: { wood: 2 },
  plate: { metal: 2 },
  sheet: { polymer: 2 },
  frame: { plank: 2, plate: 1 },
  gear: { plate: 2, stone: 1 },
  circuit: { plate: 1, glass: 1, data: 1 },
};

export const REFINE_ORDER: Comp[] = ['plank', 'plate', 'sheet', 'frame', 'gear', 'circuit'];

export function addCost(inv: Inventory, cost: Cost, sign = 1) {
  for (const [k, v] of Object.entries(cost) as [ItemId, number][]) {
    inv[k] = Math.max(0, (inv[k] ?? 0) + v * sign);
  }
}

export function canPay(inv: Inventory, cost: Cost): boolean {
  for (const [k, v] of Object.entries(cost) as [ItemId, number][]) {
    if ((inv[k] ?? 0) < v) return false;
  }
  return true;
}

export function totalCost(cost: Cost): number {
  return Object.values(cost).reduce((a, b) => a + (b ?? 0), 0);
}

/**
 * Expands a cost into raw materials, following the refinement tree.
 * Used to explain "1 plank = 2 wood" in the UI and to plan auto-crafting.
 */
export function expandToRaw(cost: Cost, depth = 0): Cost {
  const out: Cost = {};
  for (const [k, v] of Object.entries(cost) as [ItemId, number][]) {
    if (v <= 0) continue;
    const recipe = REFINE[k as Comp];
    if (!recipe || depth > 3) {
      out[k] = (out[k] ?? 0) + v;
      continue;
    }
    const sub = expandToRaw(recipe, depth + 1);
    for (const [sk, sv] of Object.entries(sub) as [ItemId, number][]) {
      out[sk] = (out[sk] ?? 0) + sv * v;
    }
  }
  return out;
}

function consume(inv: Inventory, item: ItemId, n: number, depth: number): boolean {
  const have = inv[item] ?? 0;
  if (have >= n) {
    inv[item] = have - n;
    return true;
  }
  const recipe = REFINE[item as Comp];
  if (!recipe || depth > 4) return false;
  const missing = n - have;
  inv[item] = 0;
  for (let i = 0; i < missing; i++) {
    for (const [k, v] of Object.entries(recipe) as [ItemId, number][]) {
      if (!consume(inv, k, v, depth + 1)) return false;
    }
  }
  return true;
}

/**
 * Attempts to spend a cost, auto-crafting any missing components from raw stock.
 * Returns the resulting inventory or null when even the raws aren't there.
 */
export function trySpend(inv: Inventory, cost: Cost): Inventory | null {
  const next: Inventory = { ...inv };
  for (const [k, v] of Object.entries(cost) as [ItemId, number][]) {
    if (!consume(next, k, v, 0)) return null;
  }
  return next;
}

/** How many units of an item can we make right now? */
export function affordableCount(inv: Inventory, item: ItemId): number {
  const recipe = REFINE[item as Comp];
  if (!recipe) return inv[item] ?? 0;
  let max = 0;
  const probe = (n: number) => {
    const copy: Inventory = { ...inv };
    for (const [k, v] of Object.entries(recipe) as [ItemId, number][]) {
      if (!consume(copy, k, v * n, 0)) return false;
    }
    return true;
  };
  while (max < 99 && probe(max + 1)) max++;
  return max;
}

export function describeCost(cost: Cost): string {
  return (Object.entries(cost) as [ItemId, number][])
    .map(([k, v]) => `${v} ${ITEM[k].short}`)
    .join(' + ');
}

export function costList(cost: Cost): [ItemId, number][] {
  return (Object.entries(cost) as [ItemId, number][]).filter(([, v]) => v > 0);
}

export function isRaw(id: ItemId): id is Mat {
  return (['wood', 'stone', 'metal', 'polymer', 'glass', 'data'] as string[]).includes(id);
}

export function isComponent(id: ItemId): id is Comp {
  return (COMPS as string[]).includes(id);
}
