import type { Difficulty } from './balance';

export type ActorKind = 'hero' | 'ally' | 'demon' | 'hollow' | 'hound';
export type ActorState = 'Idle' | 'Walk' | 'Chase' | 'Telegraph' | 'Attack' | 'Recovery' |
  'Stagger' | 'PhaseTransition' | 'Defeated' | 'Dodge' | 'Hit' | 'Dead';
export type Outcome = 'victory' | 'health' | 'timeout' | 'ally' | null;
export interface CombatInput {
  x: number; y: number; aimX?: number; aimY?: number;
  /** Action booleans are press edges, never a held-button state. One edge per outer update. */
  attack: boolean; dodge: boolean; dragon: boolean; seal: boolean;
}
export interface CombatOptions { difficulty: Difficulty; demo: boolean; seed?: number }
export interface Actor {
  id: string; kind: ActorKind; x: number; y: number; hp: number; maxHp: number;
  radius: number; speed: number; facing: number; state: ActorState; stateTime: number;
  invulnerable: number; attackIndex: number; attackDuration: number; attackWindup: number; attackActive: number;
  dodgeCooldown: number; dragonCooldown: number; sealCooldown: number; damageCooldown: number;
  energy: number; maxEnergy: number; phase: number; stagger: number; staggerCooldown: number;
  attackCooldown: number; barrierCooldown: number;
  hitIds: Set<string>; attackTriggered: boolean; queuedAttack: boolean;
  comboTimer: number; comboNext: number; targetX: number; targetY: number;
  dodgeX: number; dodgeY: number; aiClock: number; attackCount: number;
}
export type EffectKind = 'slash' | 'dragon' | 'seal' | 'telegraph-cone' | 'telegraph-line' |
  'telegraph-circle' | 'impact' | 'wave' | 'barrier' | 'dash' | 'phase';
export interface CombatEffect {
  id: number; kind: EffectKind; x: number; y: number; angle: number; radius: number;
  width: number; length: number; t: number; duration: number; color: number;
  ownerId: string; damage: number; speed: number; hitIds: Set<string>; triggered: boolean;
  arc: number; hostile: boolean; vx: number; vy: number;
}
export interface CombatEvent {
  type: string; x: number; y: number; amount?: number; color?: number; actorId?: string; detail?: string;
}
export interface Telemetry {
  damageDealt: number; damageTaken: number; allyDamage: number; comboSteps: number[];
  dodges: number; avoidedHits: number; dragonCasts: number; sealCasts: number;
  bossAttacks: number[]; phaseChanges: number; enemyKills: number;
  swordInputs: number; acceptedSwordInputs: number;
}
export const EMPTY_INPUT: CombatInput = { x: 0, y: 0, attack: false, dodge: false, dragon: false, seal: false };
