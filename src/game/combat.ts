import { BALANCE as B } from './balance';
import type { Actor, ActorKind, CombatEffect, CombatEvent, CombatInput, CombatOptions, EffectKind, Outcome, Telemetry } from './model';

const TAU = Math.PI * 2;
const GOLD = 0xe0c37d, RED = 0xf26856, BLUE = 0x91c7d4;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
export const angleDifference = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** A finite sector test, expanded by the target's collision radius. */
export function inSector(source: { x: number; y: number }, target: { x: number; y: number; radius: number }, facing: number, reach: number, arc: number): boolean {
  const d = distance(source, target);
  return d <= reach + target.radius && (d <= target.radius || Math.abs(angleDifference(Math.atan2(target.y - source.y, target.x - source.x), facing)) <= arc / 2 + Math.asin(Math.min(1, target.radius / Math.max(d, 1))));
}

function createActor(id: string, kind: ActorKind, x: number, y: number, hp: number, radius: number, speed: number): Actor {
  return { id, kind, x, y, hp, maxHp: hp, radius, speed, facing: kind === 'demon' ? Math.PI / 2 : -Math.PI / 2,
    state: 'Idle', stateTime: 0, invulnerable: 0, attackIndex: 0, attackDuration: 0,
    attackWindup: 0, attackActive: 0, dodgeCooldown: 0, dragonCooldown: 0, sealCooldown: 0,
    damageCooldown: 0, energy: B.hero.energy, maxEnergy: B.hero.energy, phase: 1, stagger: 0, staggerCooldown: 0,
    attackCooldown: 0, barrierCooldown: 4, hitIds: new Set(), attackTriggered: false,
    queuedAttack: false, comboTimer: 0, comboNext: 0, targetX: x, targetY: y,
    dodgeX: 0, dodgeY: 0, aiClock: 0, attackCount: 0 };
}

/** The complete deterministic game simulation. Rendering, sound and input remain outside it. */
export class CombatWorld {
  readonly player: Actor;
  readonly ally: Actor;
  readonly boss?: Actor;
  readonly enemies: Actor[] = [];
  readonly events: CombatEvent[] = [];
  readonly effects: CombatEffect[] = [];
  readonly telemetry: Telemetry = { damageDealt: 0, damageTaken: 0, allyDamage: 0, comboSteps: [0, 0, 0], dodges: 0, avoidedHits: 0, dragonCasts: 0, sealCasts: 0, bossAttacks: [0, 0, 0, 0], phaseChanges: 0, enemyKills: 0 };
  elapsed = 0;
  timeLeft: number;
  readonly timeLimit: number;
  outcome: Outcome = null;
  consentGranted: boolean;
  private nextEffect = 1;
  private randomState: number;
  private trainingCompleteSent = false;
  private pendingPower: { kind: 'dragon' | 'seal'; remaining: number } | null = null;
  private allyAvoidance: { x: number; y: number; until: number } | null = null;
  private readonly difficulty;

  constructor(readonly mode: 'training' | 'boss', readonly options: CombatOptions = { difficulty: 'normal', demo: false }) {
    this.randomState = options.seed ?? 0xa0e2026;
    this.difficulty = B.difficulties[options.difficulty];
    this.player = createActor('hero', 'hero', 390, 470, B.hero.hp, B.hero.radius, B.hero.speed);
    this.ally = createActor('ally', 'ally', 520, 470, B.ally.hp, B.ally.radius, B.ally.speed);
    this.timeLimit = options.demo ? B.timer.demo : B.timer.canonical;
    this.timeLeft = this.timeLimit;
    this.consentGranted = mode === 'boss';
    if (mode === 'boss') this.boss = createActor('demon', 'demon', 480, 225, Math.round(B.boss.hp * this.difficulty.enemyHealth), B.boss.radius, B.boss.speed);
    else {
      this.enemies.push(createActor('hollow-1', 'hollow', 350, 260, B.enemies.hollow.hp, B.enemies.hollow.radius, B.enemies.hollow.speed));
      this.enemies.push(createActor('hound-1', 'hound', 630, 240, B.enemies.hound.hp, B.enemies.hound.radius, B.enemies.hound.speed));
      this.enemies[1].attackCooldown = 1.2;
    }
  }

  get actors(): Actor[] { return [this.player, this.ally, ...(this.boss ? [this.boss] : []), ...this.enemies]; }
  get ringEnabled(): boolean { return this.consentGranted && this.ally.hp > 0 && !this.outcome; }
  get sealIntegrity(): number { return this.mode === 'boss' ? clamp(this.timeLeft / this.timeLimit, 0, 1) : 1; }
  get desperation(): boolean { return this.mode === 'boss' && this.timeLeft <= this.timeLimit * B.timer.desperationFraction; }
  get trainingComplete(): boolean { return this.mode === 'training' && this.enemies.every(a => a.hp <= 0); }

  /**
   * dt is REAL elapsed seconds in an active playable scene. Do not call during pause/cutscenes.
   * The seal countdown consumes the whole dt; physics is capped at .25s and fixed-substepped
   * to avoid tunnelling and an unbounded catch-up spiral after a long renderer stall.
   * Edge-triggered power input is buffered once per call, including while a sword combo runs.
   */
  update(dt: number, input: CombatInput): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.outcome) return;
    if (this.mode === 'boss') {
      this.elapsed += dt;
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) { this.finish('timeout'); return; }
    }
    if (input.seal && this.ringEnabled && this.player.sealCooldown <= B.hero.powerInputBuffer) this.pendingPower = { kind: 'seal', remaining: B.hero.powerInputBuffer };
    else if (input.dragon && this.player.dragonCooldown <= B.hero.powerInputBuffer) this.pendingPower = { kind: 'dragon', remaining: B.hero.powerInputBuffer };
    let remaining = Math.min(dt, 0.25);
    while (remaining > 0 && !this.outcome) {
      const step = Math.min(remaining, 1 / 120);
      this.tick(step, input);
      remaining -= step;
    }
  }

  private tick(dt: number, input: CombatInput): void {
    if (this.pendingPower) { this.pendingPower.remaining -= dt; if (this.pendingPower.remaining <= 0) this.pendingPower = null; }
    for (const actor of this.actors) {
      actor.stateTime += dt;
      actor.aiClock += dt;
      for (const key of ['invulnerable', 'damageCooldown', 'dodgeCooldown', 'dragonCooldown', 'sealCooldown', 'attackCooldown', 'barrierCooldown', 'comboTimer', 'staggerCooldown'] as const) actor[key] = Math.max(0, actor[key] - dt);
      actor.stagger = Math.max(0, actor.stagger - B.boss.staggerDecay * dt);
    }
    this.updatePlayer(dt, input);
    if (this.boss && this.boss.hp > 0) this.updateBoss(dt);
    for (const enemy of this.enemies) if (enemy.hp > 0) this.updateEnemy(enemy, dt);
    this.updateAlly(dt);
    this.updateEffects(dt);
    this.separateActors();
    if (this.player.hp <= 0) this.finish('health');
    else if (this.mode === 'boss' && this.ally.hp <= 0) this.finish('ally');
    else if (this.boss && this.boss.hp <= 0) this.finish('victory');
    if (this.trainingComplete && !this.trainingCompleteSent) {
      this.trainingCompleteSent = true;
      this.event('training-complete', this.player);
    }
  }

  private updatePlayer(dt: number, input: CombatInput): void {
    const p = this.player;
    p.energy = Math.min(p.maxEnergy, p.energy + B.hero.energyRegen * dt);
    if (p.hp <= 0) return;
    const magnitude = Math.hypot(input.x, input.y);
    const moving = magnitude > 0.12;
    const mx = moving ? input.x / Math.max(1, magnitude) : 0;
    const my = moving ? input.y / Math.max(1, magnitude) : 0;
    const hasAim = input.aimX !== undefined && input.aimY !== undefined && Math.hypot(input.aimX - p.x, input.aimY - p.y) > 5;
    const desiredFacing = hasAim ? Math.atan2(input.aimY! - p.y, input.aimX! - p.x) : moving ? Math.atan2(my, mx) : p.facing;
    if (p.state === 'Dodge') {
      this.move(p, p.dodgeX * B.hero.dodge.speed * dt, p.dodgeY * B.hero.dodge.speed * dt);
      if (p.stateTime >= B.hero.dodge.duration) this.state(p, 'Idle');
      return;
    }
    if (p.state === 'Hit') {
      if (p.stateTime >= B.hero.hitStun) this.state(p, 'Idle');
      return;
    }
    if (input.dodge && p.dodgeCooldown <= 0) {
      p.facing = desiredFacing;
      p.dodgeX = moving ? mx / Math.hypot(mx, my) : Math.cos(p.facing);
      p.dodgeY = moving ? my / Math.hypot(mx, my) : Math.sin(p.facing);
      p.dodgeCooldown = B.hero.dodge.cooldown;
      p.invulnerable = Math.max(p.invulnerable, B.hero.dodge.invulnerability);
      p.queuedAttack = false;
      this.state(p, 'Dodge');
      this.telemetry.dodges++;
      this.effect('dash', { x: p.x, y: p.y, angle: p.facing, duration: B.hero.dodge.duration, radius: 23, color: BLUE, ownerId: p.id });
      this.event('dodge', p);
      return;
    }
    if (p.state === 'Attack') {
      if (input.attack && p.stateTime > 0.06) p.queuedAttack = true;
      const c = B.hero.combo[p.attackIndex];
      if (!p.attackTriggered && p.stateTime >= c.windup) {
        p.attackTriggered = true;
        this.effect('slash', { x: p.x, y: p.y, angle: p.facing, radius: c.reach, arc: c.arc, duration: c.active + 0.1, color: p.attackIndex === 2 ? GOLD : 0xc4d9db, ownerId: p.id });
        this.event('attack', p, undefined, p.attackIndex.toString());
      }
      if (p.stateTime >= c.windup && p.stateTime <= c.windup + c.active) {
        for (const target of this.hostiles()) {
          if (target.hp > 0 && !p.hitIds.has(target.id) && inSector(p, target, p.facing, c.reach, c.arc)) {
            p.hitIds.add(target.id);
            this.damage(target, c.damage, p.id, c.stagger);
          }
        }
      }
      this.move(p, mx * p.speed * 0.22 * dt, my * p.speed * 0.22 * dt);
      if (p.stateTime >= p.attackDuration) {
        p.comboNext = (p.attackIndex + 1) % 3;
        p.comboTimer = B.hero.comboWindow;
        if (this.canCastBufferedPower()) { this.state(p, 'Idle'); this.castBufferedPower(desiredFacing); }
        else if (p.queuedAttack) this.startSword(p.comboNext, desiredFacing);
        else this.state(p, 'Idle');
      }
      return;
    }
    p.facing = desiredFacing;
    if (this.canCastBufferedPower()) this.castBufferedPower(desiredFacing);
    else if (input.attack) {
      this.startSword(p.comboTimer > 0 ? p.comboNext : 0, desiredFacing);
      return;
    }
    this.move(p, mx * p.speed * dt, my * p.speed * dt);
    if (moving && p.state !== 'Walk') this.state(p, 'Walk');
    if (!moving && p.state !== 'Idle') this.state(p, 'Idle');
  }

  private canCastBufferedPower(): boolean {
    if (!this.pendingPower) return false;
    const p = this.player;
    return this.pendingPower.kind === 'seal'
      ? this.ringEnabled && p.sealCooldown <= 0 && p.energy >= B.hero.seal.cost
      : p.dragonCooldown <= 0 && p.energy >= B.hero.dragon.cost;
  }

  private castBufferedPower(facing: number): void {
    const p = this.player;
    if (!this.pendingPower || !this.canCastBufferedPower()) return;
    p.facing = facing;
    if (this.pendingPower.kind === 'seal') {
      p.energy -= B.hero.seal.cost;
      p.sealCooldown = B.hero.seal.cooldown;
      const target = this.closestHostile(p);
      const x = target?.x ?? p.x + Math.cos(p.facing) * 95;
      const y = target?.y ?? p.y + Math.sin(p.facing) * 95;
      this.effect('seal', { x, y, radius: B.hero.seal.radius, duration: B.hero.seal.delay + 0.38, damage: B.hero.seal.damage, ownerId: p.id, color: GOLD });
      this.ally.invulnerable = Math.max(this.ally.invulnerable, 0.6);
      this.telemetry.sealCasts++;
      this.event('seal', p);
    } else {
      p.energy -= B.hero.dragon.cost;
      p.dragonCooldown = B.hero.dragon.cooldown;
      this.effect('dragon', { x: p.x + Math.cos(p.facing) * 22, y: p.y + Math.sin(p.facing) * 22, angle: p.facing, radius: B.hero.dragon.radius, duration: B.hero.dragon.duration, damage: B.hero.dragon.damage, speed: B.hero.dragon.speed, ownerId: p.id, color: RED });
      this.telemetry.dragonCasts++;
      this.event('dragon', p);
    }
    this.pendingPower = null;
  }

  private startSword(index: number, facing: number): void {
    const p = this.player, c = B.hero.combo[index];
    this.state(p, 'Attack');
    p.facing = facing;
    p.attackIndex = index;
    p.attackWindup = c.windup;
    p.attackActive = c.active;
    p.attackDuration = c.windup + c.active + c.recovery;
    p.hitIds.clear();
    p.attackTriggered = false;
    p.queuedAttack = false;
    this.telemetry.comboSteps[index]++;
  }

  private updateEnemy(enemy: Actor, dt: number): void {
    const c = B.enemies[enemy.kind === 'hound' ? 'hound' : 'hollow'];
    if (enemy.state === 'Hit' || enemy.state === 'Stagger') {
      if (enemy.stateTime >= 0.3) this.state(enemy, 'Chase');
      return;
    }
    if (enemy.state === 'Telegraph') {
      if (enemy.stateTime >= enemy.attackWindup) {
        this.state(enemy, 'Attack');
        enemy.hitIds.clear();
        this.effect('slash', { x: enemy.x, y: enemy.y, angle: enemy.facing, radius: c.reach, arc: 1.5, duration: 0.22, color: RED, ownerId: enemy.id });
      }
      return;
    }
    if (enemy.state === 'Attack') {
      if (!enemy.hitIds.has(this.player.id) && inSector(enemy, this.player, enemy.facing, c.reach, 1.5)) {
        enemy.hitIds.add(this.player.id);
        this.damage(this.player, c.damage * this.difficulty.enemyDamage, enemy.id);
      }
      if (enemy.stateTime >= 0.2) { enemy.attackCooldown = c.cooldown; this.state(enemy, 'Recovery'); }
      return;
    }
    if (enemy.state === 'Recovery') {
      if (enemy.stateTime >= 0.52) this.state(enemy, 'Chase');
      return;
    }
    enemy.facing = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
    if (distance(enemy, this.player) <= c.reach - 7 && enemy.attackCooldown <= 0) {
      this.state(enemy, 'Telegraph');
      enemy.attackWindup = c.windup * this.difficulty.telegraph;
      this.effect('telegraph-cone', { x: enemy.x, y: enemy.y, angle: enemy.facing, radius: c.reach, arc: 1.5, duration: enemy.attackWindup, color: RED, ownerId: enemy.id });
    } else if (distance(enemy, this.player) > 43) {
      if (enemy.state !== 'Chase') this.state(enemy, 'Chase');
      this.move(enemy, Math.cos(enemy.facing) * enemy.speed * dt, Math.sin(enemy.facing) * enemy.speed * dt);
    } else if (enemy.state !== 'Idle') this.state(enemy, 'Idle');
  }

  private updateBoss(dt: number): void {
    const b = this.boss!;
    const wantedPhase = b.hp / b.maxHp <= B.boss.phaseThresholds[1] ? 3 : b.hp / b.maxHp <= B.boss.phaseThresholds[0] ? 2 : 1;
    if (wantedPhase > b.phase && b.state !== 'PhaseTransition') {
      b.phase = wantedPhase;
      b.stagger = 0;
      this.state(b, 'PhaseTransition');
      this.effects.splice(0, this.effects.length, ...this.effects.filter(e => !e.hostile && !e.kind.startsWith('telegraph')));
      this.effect('phase', { x: b.x, y: b.y, radius: 150, duration: B.boss.phaseTransition, ownerId: b.id, color: RED });
      this.telemetry.phaseChanges++;
      this.event('phase', b, wantedPhase);
      return;
    }
    if (b.state === 'PhaseTransition') {
      if (b.stateTime >= B.boss.phaseTransition) { b.attackCooldown = 0.45; this.state(b, 'Chase'); }
      return;
    }
    if (b.state === 'Stagger') {
      if (b.stateTime >= B.boss.staggerDuration) { b.attackCooldown = 0.4; this.state(b, 'Chase'); }
      return;
    }
    if (b.state === 'Telegraph') {
      if (b.stateTime >= b.attackWindup) this.performBossAttack();
      return;
    }
    if (b.state === 'Attack') {
      if (b.attackIndex === 0) {
        for (const target of [this.player, this.ally]) if (!b.hitIds.has(target.id) && inSector(b, target, b.facing, B.boss.melee.reach, B.boss.melee.arc)) {
          b.hitIds.add(target.id);
          this.damage(target, B.boss.melee.damage * this.difficulty.enemyDamage * (b.phase === 3 ? 1.12 : 1), b.id);
        }
      }
      if (b.attackIndex === 3) {
        this.move(b, Math.cos(b.facing) * B.boss.rush.speed * dt, Math.sin(b.facing) * B.boss.rush.speed * dt);
        for (const target of [this.player, this.ally]) if (!b.hitIds.has(target.id) && distance(b, target) < b.radius + target.radius + B.boss.rush.width / 2) {
          b.hitIds.add(target.id);
          this.damage(target, B.boss.rush.damage * this.difficulty.enemyDamage, b.id);
        }
      }
      if (b.stateTime >= b.attackActive) this.state(b, 'Recovery');
      return;
    }
    if (b.state === 'Recovery') {
      if (b.stateTime >= B.boss.recovery / (1 + (b.phase - 1) * 0.12)) {
        b.attackCooldown = b.phase >= 3 ? 0.32 : 0.6;
        this.state(b, 'Chase');
      }
      return;
    }
    const target = b.attackCount % 5 === 4 && this.ally.hp > 0 ? this.ally : this.player;
    b.facing = Math.atan2(target.y - b.y, target.x - b.x);
    if (b.state !== 'Chase') this.state(b, 'Chase');
    if (distance(b, target) > 103) {
      const speed = b.speed * (1 + (b.phase - 1) * 0.14) * (this.desperation ? B.boss.desperationSpeed : 1);
      this.move(b, Math.cos(b.facing) * speed * dt, Math.sin(b.facing) * speed * dt);
    }
    if (b.attackCooldown <= 0 && b.stateTime >= B.boss.chaseTime / (1 + (b.phase - 1) * 0.15)) this.prepareBossAttack(target);
  }

  private prepareBossAttack(target: Actor): void {
    const b = this.boss!;
    // Every phase keeps all four readable patterns. Later phases add extra projectiles/ground zones.
    b.attackIndex = b.attackCount % 4;
    b.attackCount++;
    b.targetX = target.x;
    b.targetY = target.y;
    b.facing = Math.atan2(target.y - b.y, target.x - b.x);
    const base = [B.boss.melee.windup, B.boss.wave.windup, B.boss.ground.windup, B.boss.rush.windup][b.attackIndex];
    b.attackWindup = base * this.difficulty.telegraph * (this.desperation ? B.boss.desperationWindup : 1);
    this.state(b, 'Telegraph');
    const common = { x: b.x, y: b.y, angle: b.facing, duration: b.attackWindup, ownerId: b.id, color: RED };
    if (b.attackIndex === 0) this.effect('telegraph-cone', { ...common, radius: B.boss.melee.reach, arc: B.boss.melee.arc });
    else if (b.attackIndex === 1) {
      const count = b.phase === 1 ? 1 : b.phase === 2 ? 3 : 5;
      for (let i = 0; i < count; i++) this.effect('telegraph-line', { ...common, angle: b.facing + (i - (count - 1) / 2) * B.boss.wave.spread, width: B.boss.wave.radius * 2, length: 500 });
    }
    else if (b.attackIndex === 2) {
      const points = this.groundPoints();
      for (const point of points) this.effect('telegraph-circle', { ...common, x: point.x, y: point.y, radius: B.boss.ground.radius, duration: b.attackWindup + B.boss.ground.delay });
    } else this.effect('telegraph-line', { ...common, width: B.boss.rush.width * 2, length: B.boss.rush.speed * B.boss.rush.duration });
    this.event('boss-telegraph', b, b.attackIndex);
  }

  private groundPoints(): { x: number; y: number }[] {
    const b = this.boss!;
    const points = [{ x: b.targetX, y: b.targetY }];
    const count = B.boss.ground.count + (b.phase - 1);
    // A stable fan around the locked position leaves generous safe routes.
    for (let i = 1; i < count; i++) {
      const angle = (i / (count - 1)) * TAU + b.attackCount * 0.7;
      points.push({ x: clamp(b.targetX + Math.cos(angle) * 155, B.arena.minX + 35, B.arena.maxX - 35), y: clamp(b.targetY + Math.sin(angle) * 140, B.arena.minY + 35, B.arena.maxY - 35) });
    }
    return points;
  }

  private performBossAttack(): void {
    const b = this.boss!;
    b.hitIds.clear();
    this.state(b, 'Attack');
    this.telemetry.bossAttacks[b.attackIndex]++;
    b.attackActive = 0.3;
    const common = { x: b.x, y: b.y, angle: b.facing, ownerId: b.id, color: RED, hostile: true };
    if (b.attackIndex === 0) {
      b.attackActive = B.boss.melee.active;
      this.effect('slash', { ...common, radius: B.boss.melee.reach, arc: B.boss.melee.arc, duration: b.attackActive + 0.12 });
    } else if (b.attackIndex === 1) {
      const count = b.phase === 1 ? 1 : b.phase === 2 ? 3 : 5;
      for (let i = 0; i < count; i++) {
        const angle = b.facing + (i - (count - 1) / 2) * B.boss.wave.spread;
        this.effect('wave', { ...common, angle, radius: B.boss.wave.radius, duration: B.boss.wave.duration, speed: B.boss.wave.speed, damage: B.boss.wave.damage * this.difficulty.enemyDamage });
      }
    } else if (b.attackIndex === 2) {
      for (const point of this.groundPoints()) this.effect('impact', { ...common, x: point.x, y: point.y, radius: B.boss.ground.radius, duration: B.boss.ground.delay + 0.32, damage: B.boss.ground.damage * this.difficulty.enemyDamage });
    } else {
      b.attackActive = B.boss.rush.duration;
      this.effect('dash', { ...common, radius: 35, length: B.boss.rush.speed * B.boss.rush.duration, duration: b.attackActive });
    }
    this.event('boss-attack', b, b.attackIndex);
  }

  private updateAlly(dt: number): void {
    const a = this.ally;
    if (a.hp <= 0) return;
    if (this.mode === 'training') {
      a.facing = Math.atan2(this.player.y - a.y, this.player.x - a.x);
      if (distance(a, this.player) > 150) {
        if (a.state !== 'Walk') this.state(a, 'Walk');
        this.move(a, Math.cos(a.facing) * a.speed * dt, Math.sin(a.facing) * a.speed * dt);
      } else if (a.state !== 'Idle') this.state(a, 'Idle');
      return;
    }
    const b = this.boss;
    if (!b || b.hp <= 0) return;
    if (a.state === 'Dodge') {
      this.move(a, a.dodgeX * B.ally.dodgeSpeed * dt, a.dodgeY * B.ally.dodgeSpeed * dt);
      if (a.stateTime >= B.ally.dodgeDuration) this.state(a, 'Idle');
      return;
    }
    if (a.state === 'Hit') { if (a.stateTime >= 0.2) this.state(a, 'Idle'); return; }
    // React only to visible warnings, select an escape INSIDE the walls, and retain that
    // safe position through the impact. A premature roll followed by immediately running
    // back into the same red zone made the former guardian needlessly fragile.
    const warnings = this.effects.filter(e => e.ownerId === b.id && e.kind.startsWith('telegraph'));
    const danger = warnings.find(e => this.effectContains(e, a));
    if (danger) {
      const planned = this.allyAvoidance && { ...a, x: this.allyAvoidance.x, y: this.allyAvoidance.y };
      if (!planned || warnings.some(e => this.effectContains(e, planned))) this.allyAvoidance = this.allyEscapeTarget(a, danger, warnings);
      this.allyAvoidance!.until = Math.max(this.allyAvoidance!.until, a.aiClock + danger.duration - danger.t + B.ally.evadeHold);
    }
    if (this.allyAvoidance && a.aiClock < this.allyAvoidance.until) {
      const target = this.allyAvoidance;
      const angle = Math.atan2(target.y - a.y, target.x - a.x);
      a.facing = Math.atan2(b.y - a.y, b.x - a.x);
      if (danger && danger.duration - danger.t <= B.ally.dodgeLead && a.dodgeCooldown <= 0) {
        a.dodgeX = Math.cos(angle); a.dodgeY = Math.sin(angle);
        a.invulnerable = B.ally.dodgeDuration;
        a.dodgeCooldown = B.ally.dodgeCooldown;
        this.state(a, 'Dodge');
        this.effect('dash', { x: a.x, y: a.y, angle, duration: B.ally.dodgeDuration, radius: 18, ownerId: a.id, color: GOLD });
      } else if (distance(a, target) > 8) {
        if (a.state !== 'Walk') this.state(a, 'Walk');
        const step = Math.min(a.speed * dt, distance(a, target));
        this.move(a, Math.cos(angle) * step, Math.sin(angle) * step);
      } else if (a.state !== 'Idle') this.state(a, 'Idle');
      return;
    }
    this.allyAvoidance = null;
    if (a.state === 'Attack') {
      if (a.stateTime >= 0.14 && !a.attackTriggered) {
        a.attackTriggered = true;
        this.effect('slash', { x: a.x, y: a.y, angle: a.facing, radius: B.ally.reach, arc: 1.7, duration: 0.2, ownerId: a.id, color: GOLD });
        if (inSector(a, b, a.facing, B.ally.reach, 1.7)) this.damage(b, B.ally.damage * this.difficulty.allyDamage, a.id, 8);
      }
      if (a.stateTime >= 0.42) { a.attackCooldown = B.ally.attackCooldown; this.state(a, 'Idle'); }
      return;
    }
    if (a.barrierCooldown <= 0 && distance(a, this.player) < 245) {
      a.barrierCooldown = B.ally.barrierCooldown;
      this.effect('barrier', { x: this.player.x, y: this.player.y, radius: B.ally.barrierRadius, duration: B.ally.barrierDuration, ownerId: a.id, color: GOLD });
      this.event('barrier', a);
    }
    const toBoss = Math.atan2(b.y - a.y, b.x - a.x);
    a.facing = toBoss;
    if (distance(a, b) < B.ally.reach - 6 && a.attackCooldown <= 0 && b.state !== 'PhaseTransition') {
      a.attackTriggered = false; a.attackIndex = a.attackCount++ % 3;
      a.attackWindup = 0.14; a.attackActive = 0.14; a.attackDuration = 0.42;
      this.state(a, 'Attack');
      return;
    }
    const orbitAngle = Math.atan2(this.player.y - b.y, this.player.x - b.x) + 1.05;
    const target = { x: clamp(b.x + Math.cos(orbitAngle) * 62, 100, 860), y: clamp(b.y + Math.sin(orbitAngle) * 62, 120, 540) };
    if (distance(a, target) > 16) {
      if (a.state !== 'Walk') this.state(a, 'Walk');
      const angle = Math.atan2(target.y - a.y, target.x - a.x);
      this.move(a, Math.cos(angle) * a.speed * dt, Math.sin(angle) * a.speed * dt);
    } else if (a.state !== 'Idle') this.state(a, 'Idle');
  }

  private allyEscapeTarget(a: Actor, danger: CombatEffect, warnings: CombatEffect[]): { x: number; y: number; until: number } {
    const side = -(a.x - danger.x) * Math.sin(danger.angle) + (a.y - danger.y) * Math.cos(danger.angle);
    const preferred = danger.kind === 'telegraph-line' ? danger.angle + (side >= 0 ? 1 : -1) * Math.PI / 2 : Math.atan2(a.y - danger.y, a.x - danger.x);
    let best = { x: a.x, y: a.y, until: 0 }, bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const angle = preferred + i * TAU / 16;
      const x = clamp(a.x + Math.cos(angle) * B.ally.evadeDistance, B.arena.minX + 20, B.arena.maxX - 20);
      const y = clamp(a.y + Math.sin(angle) * B.ally.evadeDistance, B.arena.minY + 20, B.arena.maxY - 20);
      const candidate = { ...a, x, y };
      const threats = warnings.filter(e => this.effectContains(e, candidate)).length;
      const score = -threats * 1000 + distance(a, candidate) * 0.5 + Math.cos(angle - preferred) * 30;
      if (score > bestScore) { bestScore = score; best = { x, y, until: 0 }; }
    }
    return best;
  }

  private updateEffects(dt: number): void {
    for (const e of this.effects) {
      e.t += dt;
      if (e.kind === 'dragon' || e.kind === 'wave') {
        e.x += Math.cos(e.angle) * e.speed * dt;
        e.y += Math.sin(e.angle) * e.speed * dt;
        const targets = e.hostile ? [this.player, this.ally] : this.hostiles();
        for (const target of targets) if (target.hp > 0 && !e.hitIds.has(target.id) && distance(e, target) < e.radius + target.radius) {
          e.hitIds.add(target.id);
          this.damage(target, e.damage, e.ownerId, e.hostile ? 0 : B.hero.dragon.stagger);
        }
      } else if (e.kind === 'seal' && e.t >= B.hero.seal.delay && !e.triggered) {
        e.triggered = true;
        if (this.ringEnabled) {
          for (const target of this.hostiles()) if (target.hp > 0 && distance(e, target) <= e.radius + target.radius) this.damage(target, e.damage, this.player.id, B.hero.seal.stagger);
          this.event('seal-impact', e);
        }
      } else if (e.kind === 'impact' && e.t >= B.boss.ground.delay && !e.triggered) {
        e.triggered = true;
        for (const target of [this.player, this.ally]) if (target.hp > 0 && distance(e, target) <= e.radius + target.radius) this.damage(target, e.damage, e.ownerId);
        this.event('ground-impact', e);
      } else if (e.kind === 'barrier') {
        // The field remains tied to a living consenting guardian, never a self-powered ring.
        if (!this.ringEnabled) e.t = e.duration;
        else { e.x += (this.player.x - e.x) * dt * 5; e.y += (this.player.y - e.y) * dt * 5; }
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) if (this.effects[i].t >= this.effects[i].duration) this.effects.splice(i, 1);
  }

  private effectContains(e: CombatEffect, target: Actor): boolean {
    if (e.kind === 'telegraph-circle') return distance(e, target) < e.radius + target.radius;
    if (e.kind === 'telegraph-cone') return inSector(e, target, e.angle, e.radius, e.arc);
    if (e.kind === 'telegraph-line') {
      const dx = target.x - e.x, dy = target.y - e.y;
      const along = dx * Math.cos(e.angle) + dy * Math.sin(e.angle);
      const side = Math.abs(-dx * Math.sin(e.angle) + dy * Math.cos(e.angle));
      return along > 0 && along < e.length && side < e.width / 2 + target.radius;
    }
    return false;
  }

  /** Public for scripted hazards and deterministic regression tests; all damage uses the same rules. */
  damage(target: Actor, rawAmount: number, sourceId: string, stagger = 0): boolean {
    if (this.outcome || target.hp <= 0 || rawAmount <= 0) return false;
    if (target.invulnerable > 0 || (target.kind === 'demon' && target.state === 'PhaseTransition')) {
      if (target === this.player) this.telemetry.avoidedHits++;
      return false;
    }
    let amount = rawAmount;
    if (target === this.boss && sourceId === this.ally.id) {
      const cap = target.maxHp * B.ally.maxBossDamageFraction - this.telemetry.allyDamage;
      const floor = target.hp - target.maxHp * B.ally.bossHealthFloor;
      amount = Math.max(0, Math.min(amount, cap, floor));
      if (amount <= 0) return false;
    }
    if (target === this.player || target === this.ally) {
      const protectedByAlly = this.ringEnabled && this.effects.some(e => e.kind === 'barrier' && e.t < e.duration && distance(e, target) <= e.radius);
      if (protectedByAlly) amount *= 0.28;
      if (this.mode === 'training' && target === this.player) amount = Math.min(amount, Math.max(0, target.hp - B.enemies.trainingHeroHealthFloor));
    }
    amount = Math.min(target.hp, Math.max(0, Math.round(amount)));
    if (amount === 0) return false;
    target.hp -= amount;
    if (sourceId === this.player.id) this.telemetry.damageDealt += amount;
    if (sourceId === this.ally.id) this.telemetry.allyDamage += amount;
    if (target === this.player) this.telemetry.damageTaken += amount;
    this.event('hit', target, amount, sourceId);
    if (target.hp <= 0) {
      this.state(target, target.kind === 'demon' ? 'Defeated' : 'Dead');
      this.event('defeated', target);
      if (target.kind === 'hollow' || target.kind === 'hound') this.telemetry.enemyKills++;
      return true;
    }
    if (target.kind === 'demon') {
      target.stagger += stagger;
      target.damageCooldown = 0.14; // Visual armour reaction; damage is NOT globally gated.
      if (target.stagger >= B.boss.staggerThreshold && target.state !== 'Stagger' && target.staggerCooldown <= 0) {
        target.stagger = 0;
        target.staggerCooldown = B.boss.staggerCooldown;
        this.state(target, 'Stagger');
        this.effects.splice(0, this.effects.length, ...this.effects.filter(e => !e.kind.startsWith('telegraph') || e.ownerId !== target.id));
        this.event('stagger', target);
      }
    } else {
      target.invulnerable = target.kind === 'hero' ? B.hero.hitInvulnerability : target.kind === 'ally' ? B.ally.hitInvulnerability : 0.14;
      this.state(target, 'Hit');
      if (target.kind === 'hero') target.queuedAttack = false;
    }
    return true;
  }

  private finish(outcome: Exclude<Outcome, null>): void {
    if (this.outcome) return;
    this.outcome = outcome;
    if (outcome !== 'victory') this.consentGranted = false;
    this.event('outcome', this.player, undefined, outcome);
  }

  private hostiles(): Actor[] { return this.boss ? [this.boss] : this.enemies; }
  private closestHostile(from: Actor): Actor | undefined { return this.hostiles().filter(a => a.hp > 0).sort((a, b) => distance(a, from) - distance(b, from))[0]; }
  private state(actor: Actor, state: Actor['state']): void { actor.state = state; actor.stateTime = 0; }
  private move(actor: Actor, x: number, y: number): void { actor.x = clamp(actor.x + x, B.arena.minX, B.arena.maxX); actor.y = clamp(actor.y + y, B.arena.minY, B.arena.maxY); }
  private separateActors(): void {
    const actors = this.actors.filter(a => a.hp > 0);
    for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) {
      const a = actors[i], b = actors[j];
      // The allied knight never blocks player navigation.
      if ((a === this.player && b === this.ally) || (a === this.ally && b === this.player)) continue;
      if (a.state === 'Dodge' || b.state === 'Dodge') continue;
      const dist = distance(a, b), required = a.radius + b.radius;
      if (dist < required && dist > 0.001) {
        const overlap = (required - dist) / 2, nx = (b.x - a.x) / dist, ny = (b.y - a.y) / dist;
        this.move(a, -nx * overlap, -ny * overlap); this.move(b, nx * overlap, ny * overlap);
      }
    }
  }
  private effect(kind: EffectKind, data: Partial<CombatEffect>): CombatEffect {
    const effect: CombatEffect = { id: this.nextEffect++, kind, x: 0, y: 0, angle: 0, radius: 20, width: 35, length: 100, t: 0, duration: 0.4, color: RED, ownerId: '', damage: 0, speed: 0, hitIds: new Set(), triggered: false, arc: 1.5, hostile: false, vx: 0, vy: 0, ...data };
    this.effects.push(effect);
    return effect;
  }
  private event(type: string, pos: { x: number; y: number; id?: string | number }, amount?: number, detail?: string): void { this.events.push({ type, x: pos.x, y: pos.y, actorId: typeof pos.id === 'string' ? pos.id : undefined, amount, detail }); }
  random(): number { this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0; return this.randomState / 4294967296; }

  serialize(): Record<string, unknown> {
    return { mode: this.mode, outcome: this.outcome, elapsed: Number(this.elapsed.toFixed(2)), timeLeft: Number(this.timeLeft.toFixed(2)), timeLimit: this.timeLimit, ringEnabled: this.ringEnabled, sealIntegrity: this.sealIntegrity,
      player: this.actorSnapshot(this.player), ally: this.actorSnapshot(this.ally), boss: this.boss ? this.actorSnapshot(this.boss) : null,
      enemies: this.enemies.map(a => this.actorSnapshot(a)), trainingComplete: this.trainingComplete, telemetry: { ...this.telemetry } };
  }
  private actorSnapshot(a: Actor): Record<string, unknown> { return { id: a.id, kind: a.kind, x: Math.round(a.x), y: Math.round(a.y), hp: a.hp, maxHp: a.maxHp, energy: Math.round(a.energy), state: a.state, phase: a.phase, facing: a.facing, attackIndex: a.attackIndex, invulnerable: a.invulnerable }; }
}
