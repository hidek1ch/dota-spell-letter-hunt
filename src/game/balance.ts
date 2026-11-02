/** All gameplay numbers are provisional and deliberately kept together. Seconds/world pixels. */
export const BALANCE = {
  arena: { width: 960, height: 640, minX: 80, maxX: 880, minY: 100, maxY: 560 },
  timer: { canonical: 15 * 60, demo: 2 * 60 + 30, desperationFraction: 0.25 },
  hero: {
    hp: 180, speed: 158, radius: 12, energy: 100, energyRegen: 7,
    hitInvulnerability: 0.72, hitStun: 0.18,
    comboWindow: 0.52, powerInputBuffer: 0.72,
    combo: [
      { windup: 0.12, active: 0.13, recovery: 0.19, reach: 66, arc: 1.5, damage: 29, stagger: 15 },
      { windup: 0.11, active: 0.14, recovery: 0.19, reach: 75, arc: 2.0, damage: 35, stagger: 18 },
      { windup: 0.19, active: 0.16, recovery: 0.28, reach: 86, arc: 2.35, damage: 52, stagger: 36 },
    ],
    dodge: { duration: 0.29, invulnerability: 0.28, cooldown: 0.65, speed: 460 },
    dragon: { damage: 69, speed: 440, radius: 27, duration: 0.82, cooldown: 5.0, cost: 32, stagger: 35 },
    seal: { damage: 98, radius: 112, delay: 0.52, cooldown: 11, cost: 24, stagger: 70 },
  },
  ally: {
    hp: 420, speed: 140, radius: 12, damage: 15, reach: 77, attackCooldown: 1.5,
    maxBossDamageFraction: 0.38, bossHealthFloor: 0.14,
    barrierCooldown: 13, barrierDuration: 2.3, barrierRadius: 116,
    hitInvulnerability: 0.85, dodgeCooldown: 2, dodgeDuration: 0.25, dodgeSpeed: 345,
    evadeDistance: 98, evadeHold: 0.55, dodgeLead: 0.3,
  },
  boss: {
    hp: 6000, radius: 27, speed: 91, chaseTime: 1.0, recovery: 0.83,
    phaseThresholds: [0.66, 0.31], phaseTransition: 1.45,
    staggerThreshold: 110, staggerDuration: 0.88, staggerDecay: 10, staggerCooldown: 6,
    melee: { windup: 0.84, active: 0.22, reach: 134, arc: 2.4, damage: 27 },
    wave: { windup: 0.95, speed: 300, radius: 22, duration: 2.5, damage: 23, spread: 0.28 },
    ground: { windup: 1.03, delay: 0.54, radius: 69, damage: 31, count: 3 },
    rush: { windup: 0.85, duration: 0.48, speed: 620, width: 39, damage: 29 },
    desperationSpeed: 1.16, desperationWindup: 0.84,
  },
  enemies: {
    hollow: { hp: 112, speed: 73, radius: 13, reach: 63, windup: 0.85, damage: 13, cooldown: 1.5 },
    hound: { hp: 88, speed: 105, radius: 11, reach: 58, windup: 0.65, damage: 11, cooldown: 1.2 },
    trainingHeroHealthFloor: 28,
  },
  difficulties: {
    story: { enemyDamage: 0.62, enemyHealth: 0.78, allyDamage: 1.2, telegraph: 1.18 },
    normal: { enemyDamage: 1, enemyHealth: 1, allyDamage: 1, telegraph: 1 },
    hard: { enemyDamage: 1.25, enemyHealth: 1.15, allyDamage: 0.85, telegraph: 0.88 },
  },
} as const;

export type Difficulty = keyof typeof BALANCE.difficulties;
