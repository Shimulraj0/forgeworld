import type { Game } from './game';
import type { Cost } from './catalog';

export type Goal = {
  id: string;
  label: string;
  reward: Cost;
  progress: (g: Game) => [number, number];
};

export const GOALS: Goal[] = [
  {
    id: 'tree',
    label: 'Chop a silverleaf tree',
    reward: { data: 2 },
    progress: (g) => [g.stats.harvested.tree ?? 0, 1],
  },
  {
    id: 'rock',
    label: 'Mine a stone outcrop',
    reward: { data: 2 },
    progress: (g) => [g.stats.harvested.rock ?? 0, 1],
  },
  {
    id: 'plank',
    label: 'Refine your first plank',
    reward: { wood: 4 },
    progress: (g) => [g.stats.refined, 1],
  },
  {
    id: 'refine4',
    label: 'Refine 4 components',
    reward: { metal: 4 },
    progress: (g) => [g.stats.refined, 4],
  },
  {
    id: 'craft1',
    label: 'Fabricate your first asset',
    reward: { polymer: 4 },
    progress: (g) => [g.stats.crafted, 1],
  },
  {
    id: 'place3',
    label: 'Place 3 props in the world',
    reward: { glass: 3 },
    progress: (g) => [g.stats.placedTotal, 3],
  },
  {
    id: 'unlock5',
    label: 'Unlock 5 SimReady assets',
    reward: { data: 4 },
    progress: (g) => [g.stats.unlocked, 5],
  },
  {
    id: 'storage',
    label: 'Warehouse corner: 5 storage props',
    reward: { data: 6 },
    progress: (g) => [g.stats.placedCat.Storage ?? 0, 5],
  },
  {
    id: 'machine',
    label: 'Power the workshop: place a machine',
    reward: { data: 5 },
    progress: (g) => [g.stats.placedCat.Industrial ?? 0, 1],
  },
  {
    id: 'world25',
    label: 'Build a world: 25 props placed',
    reward: { data: 10 },
    progress: (g) => [g.stats.placedTotal, 25],
  },
  {
    id: 'craft10',
    label: 'Fabricate 10 assets',
    reward: { data: 8 },
    progress: (g) => [g.stats.crafted, 10],
  },
  {
    id: 'place20',
    label: 'Place 20 props in the world',
    reward: { glass: 8 },
    progress: (g) => [g.stats.placedTotal, 20],
  },
  {
    id: 'unlock15',
    label: 'Unlock 15 SimReady assets',
    reward: { data: 12 },
    progress: (g) => [g.stats.unlocked, 15],
  },
  {
    id: 'harvest50',
    label: 'Harvest 50 resources total',
    reward: { wood: 10, stone: 10 },
    progress: (g) => [Object.values(g.stats.harvested).reduce((a, b) => a + b, 0), 50],
  },
  {
    id: 'refine10',
    label: 'Refine 10 components',
    reward: { plank: 2, plate: 2 },
    progress: (g) => [g.stats.refined, 10],
  },
  {
    id: 'master',
    label: 'Master forger: craft + place 50 items',
    reward: { data: 20 },
    progress: (g) => [g.stats.placedTotal + g.stats.crafted, 50],
  },
];
