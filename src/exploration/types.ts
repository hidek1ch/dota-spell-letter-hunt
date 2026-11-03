/** Independent exploration data. Coordinates are world pixels in a flat top-down map. */
export type LocationId = 'CastleCourtyard' | 'CastleArmory';

export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }

/** Props use top-left coordinates; their rectangle is also the solid collision footprint. */
export interface LocationProp extends Rect {
  id: string;
  kind: string;
  solid: boolean;
}

export interface LocationDoor extends Rect {
  id: string;
  target: LocationId;
  targetSpawn: string;
  prompt: string;
}

/** NPC coordinates mark the centre. The default solid footprint is 32 by 32 pixels. */
export interface LocationNpc extends Point {
  id: string;
  name?: string;
  text: string;
  width?: number;
  height?: number;
}

export interface LocationDefinition {
  id: LocationId;
  title: string;
  width: number;
  height: number;
  spawn: Point;
  spawns: Record<string, Point>;
  walls: Rect[];
  props: LocationProp[];
  doors: LocationDoor[];
  npc?: LocationNpc;
}

export interface CastleSession {
  health: number;
  maxHealth: number;
  inventory: string[];
  currentLocation: LocationId;
  position: Point;
  visited: LocationId[];
}
