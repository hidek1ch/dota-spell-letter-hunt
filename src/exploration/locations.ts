import type { LocationDefinition, LocationId } from './types';

/** No combat or story scene is required to explore these two connected locations. */
export const LOCATIONS: Record<LocationId, LocationDefinition> = {
  CastleCourtyard: {
    id: 'CastleCourtyard', title: 'Тренировочный двор', width: 1920, height: 1280,
    spawn: { x: 960, y: 640 },
    spawns: {
      default: { x: 960, y: 640 }, start: { x: 960, y: 640 },
      'armory-return': { x: 960, y: 160 },
    },
    walls: [
      { x: 0, y: 0, width: 896, height: 96 },
      { x: 1024, y: 0, width: 896, height: 96 },
      { x: 0, y: 96, width: 72, height: 1184 },
      { x: 1848, y: 96, width: 72, height: 1184 },
      { x: 72, y: 1208, width: 1776, height: 72 },
    ],
    props: [
      { id: 'old-well', kind: 'well', x: 590, y: 590, width: 160, height: 144, solid: true },
      { id: 'training-dummy', kind: 'dummy', x: 1240, y: 390, width: 64, height: 80, solid: true },
      { id: 'second-training-dummy', kind: 'dummy', x: 1400, y: 390, width: 64, height: 80, solid: true },
      { id: 'courtyard-weapon-rack', kind: 'weaponrack', x: 350, y: 320, width: 240, height: 48, solid: true },
      { id: 'west-bench', kind: 'bench', x: 475, y: 940, width: 176, height: 48, solid: true },
      { id: 'east-bench', kind: 'bench', x: 1260, y: 980, width: 176, height: 48, solid: true },
      { id: 'northwest-column', kind: 'column', x: 240, y: 205, width: 72, height: 72, solid: true },
      { id: 'northeast-column', kind: 'column', x: 1608, y: 205, width: 72, height: 72, solid: true },
      { id: 'southwest-column', kind: 'column', x: 240, y: 1030, width: 72, height: 72, solid: true },
      { id: 'southeast-column', kind: 'column', x: 1608, y: 1030, width: 72, height: 72, solid: true },
      { id: 'supply-chest', kind: 'chest', x: 1525, y: 450, width: 112, height: 72, solid: true },
      { id: 'west-banner', kind: 'banner', x: 835, y: 108, width: 40, height: 80, solid: false },
      { id: 'east-banner', kind: 'banner', x: 1045, y: 108, width: 40, height: 80, solid: false },
    ],
    doors: [
      { id: 'courtyard-armory', x: 904, y: 40, width: 112, height: 80,
        target: 'CastleArmory', targetSpawn: 'entrance', prompt: 'E — Войти в оружейную' },
    ],
    npc: {
      id: 'caretaker', name: 'Смотритель', x: 1130, y: 650, width: 32, height: 32,
      text: 'Оружейная за северной дверью. Не оставляй мечи во дворе.',
    },
  },
  CastleArmory: {
    id: 'CastleArmory', title: 'Оружейная', width: 1280, height: 960,
    spawn: { x: 640, y: 820 },
    spawns: { default: { x: 640, y: 820 }, entrance: { x: 640, y: 820 } },
    walls: [
      { x: 0, y: 0, width: 1280, height: 80 },
      { x: 0, y: 80, width: 64, height: 800 },
      { x: 1216, y: 80, width: 64, height: 800 },
      { x: 0, y: 880, width: 584, height: 80 },
      { x: 696, y: 880, width: 584, height: 80 },
    ],
    props: [
      { id: 'west-weapon-rack', kind: 'weaponrack', x: 130, y: 145, width: 270, height: 48, solid: true },
      { id: 'east-weapon-rack', kind: 'weaponrack', x: 865, y: 145, width: 270, height: 48, solid: true },
      { id: 'west-armor', kind: 'armor', x: 120, y: 365, width: 64, height: 88, solid: true },
      { id: 'south-armor', kind: 'armor', x: 225, y: 610, width: 64, height: 88, solid: true },
      { id: 'smith-workbench', kind: 'table', x: 420, y: 245, width: 300, height: 90, solid: true },
      { id: 'east-workbench', kind: 'table', x: 870, y: 410, width: 250, height: 80, solid: true },
      { id: 'central-bench', kind: 'bench', x: 450, y: 530, width: 250, height: 64, solid: true },
      { id: 'armory-chest', kind: 'chest', x: 995, y: 620, width: 140, height: 80, solid: true },
      { id: 'armory-banner', kind: 'banner', x: 765, y: 92, width: 40, height: 80, solid: false },
    ],
    doors: [
      { id: 'armory-courtyard', x: 584, y: 864, width: 112, height: 72,
        target: 'CastleCourtyard', targetSpawn: 'armory-return', prompt: 'E — Вернуться во двор' },
    ],
  },
};
