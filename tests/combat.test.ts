import assert from 'node:assert/strict';
import test from 'node:test';
import { BALANCE as B } from '../src/game/balance';
import { CombatWorld, inSector } from '../src/game/combat';
import { EMPTY_INPUT, type CombatInput } from '../src/game/model';

const input = (patch: Partial<CombatInput> = {}): CombatInput => ({ ...EMPTY_INPUT, ...patch });
function run(world: CombatWorld, seconds: number, commands: Partial<CombatInput> = {}): void {
  for (let t = 0; t < seconds; t += 1 / 120) world.update(Math.min(1 / 120, seconds - t), input(commands));
}
const bossWorld = (demo = false) => new CombatWorld('boss', { difficulty: 'normal', demo });

test('real and demo timers are independent of lore and do not run in training', () => {
  const canonical = bossWorld(), demo = bossWorld(true), training = new CombatWorld('training', { difficulty: 'normal', demo: true });
  assert.equal(canonical.timeLeft, 900);
  assert.equal(demo.timeLeft, 150);
  run(canonical, 1); run(demo, 1); run(training, 1);
  assert.ok(Math.abs(canonical.timeLeft - 899) < 0.001);
  assert.ok(Math.abs(demo.timeLeft - 149) < 0.001);
  assert.equal(training.timeLeft, 150);
  // Pause is the absence of update, not elapsed wall-clock time.
  const paused = canonical.serialize();
  assert.deepEqual(canonical.serialize(), paused);
});

test('normalized diagonal movement has no speed advantage and respects arena boundaries', () => {
  const a = new CombatWorld('training'), b = new CombatWorld('training');
  a.enemies.forEach(e => { e.hp = 0; }); b.enemies.forEach(e => { e.hp = 0; });
  const start = { x: a.player.x, y: a.player.y };
  run(a, 0.3, { x: 1 }); run(b, 0.3, { x: 1, y: -1 });
  assert.ok(Math.abs(Math.hypot(a.player.x - start.x, a.player.y - start.y) - Math.hypot(b.player.x - start.x, b.player.y - start.y)) < 0.01);
  run(a, 8, { x: 1 });
  assert.equal(a.player.x, B.arena.maxX);
});

test('three sword hitboxes only hit during active frames, once per target, in the facing sector', () => {
  const world = new CombatWorld('training');
  const [target, behind] = world.enemies;
  target.x = world.player.x; target.y = world.player.y - 52; target.attackCooldown = 99;
  behind.x = world.player.x; behind.y = world.player.y + 52; behind.attackCooldown = 99;
  world.player.facing = -Math.PI / 2;
  world.update(1 / 120, input({ attack: true }));
  run(world, 0.09);
  assert.equal(target.hp, target.maxHp, 'windup must not apply damage');
  run(world, 0.2);
  assert.equal(target.hp, target.maxHp - B.hero.combo[0].damage);
  assert.equal(behind.hp, behind.maxHp, 'the rear of the attack is safe');
  run(world, 0.17);
  world.update(1 / 120, input({ attack: true }));
  run(world, 0.4);
  world.update(1 / 120, input({ attack: true }));
  run(world, 0.68);
  assert.deepEqual(world.telemetry.comboSteps, [1, 1, 1]);
  assert.equal(world.telemetry.enemyKills, 1);
  assert.ok(world.telemetry.damageDealt >= 112);
});

test('combo chain expires without continued input', () => {
  const world = new CombatWorld('training');
  world.enemies.forEach(e => { e.hp = 0; });
  world.update(1 / 60, input({ attack: true }));
  run(world, 1.1);
  world.update(1 / 60, input({ attack: true }));
  assert.deepEqual(world.telemetry.comboSteps, [2, 0, 0]);
});

test('one press creates exactly one strike even when the outer frame has many physics substeps', () => {
  for (const delta of [0.05, 0.25]) {
    const world = new CombatWorld('training');
    world.enemies.forEach(e => { e.hp = 0; });
    world.update(delta, input({ attack: true }));
    run(world, 2);
    assert.deepEqual(world.telemetry.comboSteps, [1, 0, 0], `single ${delta}s input must not autofire`);
    assert.equal(world.events.filter(e => e.type === 'attack').length, 1);
    assert.equal(world.telemetry.swordInputs, 1);
    assert.equal(world.telemetry.acceptedSwordInputs, 1);
  }
});

test('three distinct timed presses advance the combo once each and never create a fourth strike', () => {
  const world = new CombatWorld('training');
  world.enemies.forEach(e => { e.hp = 0; });
  for (let press = 0; press < 3; press++) {
    world.update(0.05, input({ attack: true }));
    run(world, 0.39);
  }
  run(world, 2);
  assert.deepEqual(world.telemetry.comboSteps, [1, 1, 1]);
  assert.deepEqual(world.events.filter(e => e.type === 'attack').map(e => e.detail), ['0', '1', '2']);
  assert.equal(world.telemetry.swordInputs, 3);
  assert.equal(world.telemetry.acceptedSwordInputs, 3);
});

test('an early distinct press queues at most one next strike and accepted inputs never become ghost attacks', () => {
  const world = new CombatWorld('training');
  world.enemies.forEach(e => { e.hp = 0; });
  world.update(1 / 120, input({ attack: true }));
  world.update(1 / 120, input({ attack: true })); // Valid second press, still in first windup.
  world.update(0.25, input({ attack: true })); // The one-slot next-strike buffer is already full.
  run(world, 2);
  assert.deepEqual(world.telemetry.comboSteps, [1, 1, 0]);
  assert.equal(world.telemetry.swordInputs, 3);
  assert.equal(world.telemetry.acceptedSwordInputs, 2);
  assert.equal(world.telemetry.comboSteps.reduce((sum, n) => sum + n, 0), world.telemetry.acceptedSwordInputs);
});

test('a single power-key edge during a separately queued sword combo casts at the recovery boundary', () => {
  for (const power of ['dragon', 'seal'] as const) {
    const world = bossWorld();
    world.boss!.attackCooldown = 99;
    world.update(1 / 120, input({ attack: true }));
    run(world, 0.1);
    assert.equal(world.player.state, 'Attack');
    world.update(1 / 120, input({ attack: true, [power]: true }));
    run(world, 0.5);
    assert.equal(world.telemetry[power === 'dragon' ? 'dragonCasts' : 'sealCasts'], 1, `${power} edge must survive the attack lock`);
    assert.ok(world.telemetry.comboSteps[1] > 0, 'the distinct buffered sword press resumes the next combo step');
    run(world, 1);
    assert.deepEqual(world.telemetry.comboSteps, [1, 1, 0], 'a power cast must not manufacture another sword press');
  }
});

test('large renderer deltas consume real countdown seconds while safely limiting physics catch-up', () => {
  const world = bossWorld();
  world.update(17.5, input());
  assert.equal(world.elapsed, 17.5);
  assert.equal(world.timeLeft, 882.5);
  assert.ok(world.player.aiClock <= 0.251, 'physics catch-up remains bounded');
  world.timeLeft = 0.1;
  world.update(0.2, input());
  assert.equal(world.timeLeft, 0);
  assert.equal(world.outcome, 'timeout');
});

test('sector geometry excludes off-axis and out-of-range targets', () => {
  assert.equal(inSector({ x: 0, y: 0 }, { x: 40, y: 0, radius: 5 }, 0, 50, 1), true);
  assert.equal(inSector({ x: 0, y: 0 }, { x: -40, y: 0, radius: 5 }, 0, 50, 1), false);
  assert.equal(inSector({ x: 0, y: 0 }, { x: 70, y: 0, radius: 5 }, 0, 50, 1), false);
});

test('dodge invulnerability and post-hit immunity actually reject damage', () => {
  const world = bossWorld();
  world.update(1 / 120, input({ dodge: true, x: 1 }));
  assert.equal(world.player.state, 'Dodge');
  assert.equal(world.damage(world.player, 30, 'demon'), false);
  assert.equal(world.player.hp, B.hero.hp);
  run(world, 0.31);
  assert.equal(world.damage(world.player, 30, 'demon'), true);
  assert.equal(world.damage(world.player, 30, 'demon'), false);
  assert.equal(world.player.hp, B.hero.hp - 30);
});

test('dragon projectile consumes energy, collides and cannot repeatedly damage a target', () => {
  const world = bossWorld();
  world.boss!.x = world.player.x; world.boss!.y = world.player.y - 110;
  world.boss!.attackCooldown = 99;
  world.update(1 / 120, input({ dragon: true }));
  assert.equal(world.telemetry.dragonCasts, 1);
  assert.ok(world.player.energy < world.player.maxEnergy);
  run(world, 0.65);
  assert.equal(world.telemetry.damageDealt, B.hero.dragon.damage);
  world.update(1 / 120, input({ dragon: true }));
  assert.equal(world.telemetry.dragonCasts, 1, 'cooldown must prevent recast');
});

test('ring attack is a delayed area strike and disappears when the living link fails', () => {
  const world = bossWorld();
  world.boss!.attackCooldown = 99;
  world.update(1 / 120, input({ seal: true }));
  assert.equal(world.telemetry.sealCasts, 1);
  assert.equal(world.telemetry.damageDealt, 0);
  run(world, 0.55);
  assert.equal(world.telemetry.damageDealt, B.hero.seal.damage);
  const failed = bossWorld();
  failed.boss!.attackCooldown = 99;
  failed.update(1 / 120, input({ seal: true }));
  failed.ally.hp = 0;
  run(failed, 0.6);
  assert.equal(failed.ringEnabled, false);
  assert.equal(failed.outcome, 'ally');
  assert.equal(failed.telemetry.damageDealt, 0);
});

test('boss phases are HP-driven; time separately increases aggression', () => {
  const world = bossWorld();
  const b = world.boss!;
  world.damage(b, b.maxHp * 0.4, world.player.id);
  world.update(1 / 120, input());
  assert.equal(b.phase, 2);
  assert.equal(b.state, 'PhaseTransition');
  assert.equal(world.telemetry.phaseChanges, 1);
  assert.ok(world.timeLeft > 898);
  world.timeLeft = 10;
  assert.equal(world.desperation, true);
  assert.equal(b.phase, 2);
});

test('all four boss attacks have visible warnings before execution', () => {
  const world = bossWorld();
  world.player.maxHp = world.player.hp = 99999;
  world.ally.maxHp = world.ally.hp = 99999;
  run(world, 24);
  assert.ok(world.telemetry.bossAttacks.every(count => count > 0), JSON.stringify(world.telemetry.bossAttacks));
  const telegraphs = world.events.filter(e => e.type === 'boss-telegraph');
  const attacks = world.events.filter(e => e.type === 'boss-attack');
  assert.ok(telegraphs.length >= attacks.length);
  assert.ok(world.telemetry.damageTaken > 0, 'an idle hero must be hit');
});

test('every projectile lane in later boss phases has its own warning', () => {
  for (const phase of [2, 3]) {
    const world = bossWorld();
    const b = world.boss!;
    b.phase = phase; b.hp = b.maxHp * (phase === 2 ? 0.5 : 0.2);
    for (let i = 0; i < 120 * 8 && !(b.state === 'Telegraph' && b.attackIndex === 1); i++) world.update(1 / 120, input());
    assert.equal(b.state, 'Telegraph');
    assert.equal(b.attackIndex, 1);
    const lanes = world.effects.filter(e => e.kind === 'telegraph-line' && e.ownerId === b.id);
    assert.equal(lanes.length, phase === 2 ? 3 : 5);
    assert.equal(new Set(lanes.map(e => e.angle)).size, lanes.length);
  }
});

test('guardian attacks and casts barriers but cannot win without the player', () => {
  const world = bossWorld();
  world.player.maxHp = world.player.hp = 99999;
  world.ally.maxHp = world.ally.hp = 99999;
  run(world, 70);
  assert.ok(world.telemetry.allyDamage > 0);
  assert.ok(world.events.some(e => e.type === 'barrier'));
  assert.ok(world.boss!.hp > 0);
  for (let i = 0; i < 1000; i++) world.damage(world.boss!, 100, world.ally.id);
  assert.ok(world.boss!.hp >= world.boss!.maxHp * B.ally.bossHealthFloor);
});

test('guardian escapes a ground warning at the arena wall and stays out through impact', () => {
  const world = bossWorld();
  const a = world.ally, b = world.boss!, p = world.player;
  a.x = 842; a.y = 120; p.x = 820; p.y = 135; b.x = 700; b.y = 225;
  b.attackCount = 2; b.state = 'Chase'; b.stateTime = 2;
  // The genuine next boss pattern locks ground hazards over both knights near the NE wall.
  // The idle player takes the hit; the autonomous guardian must pick an inward safe route.
  run(world, 2);
  assert.equal(world.telemetry.bossAttacks[2], 1);
  assert.ok(p.hp < p.maxHp, 'the real ground attack must execute');
  assert.equal(a.hp, a.maxHp, 'the guardian must neither roll into the wall nor run back too early');
  assert.ok(a.x >= B.arena.minX && a.x <= B.arena.maxX && a.y >= B.arena.minY && a.y <= B.arena.maxY);
});

test('victory, health loss, timeout and severed guardian link are distinct reachable outcomes', () => {
  const victory = bossWorld();
  victory.damage(victory.boss!, 100000, victory.player.id);
  victory.update(1 / 120, input());
  assert.equal(victory.outcome, 'victory');
  const health = bossWorld();
  health.damage(health.player, 100000, 'demon');
  health.update(1 / 120, input());
  assert.equal(health.outcome, 'health');
  const timeout = bossWorld(true);
  timeout.timeLeft = 0.005;
  timeout.update(1 / 60, input());
  assert.equal(timeout.outcome, 'timeout');
  assert.equal(timeout.ringEnabled, false);
  const ally = bossWorld();
  ally.damage(ally.ally, 100000, 'demon');
  ally.update(1 / 120, input());
  assert.equal(ally.outcome, 'ally');
});

test('training is safely completable, with real enemy kills and no instant-death trap', () => {
  const world = new CombatWorld('training');
  world.damage(world.player, 10000, 'hollow-1');
  assert.equal(world.player.hp, B.enemies.trainingHeroHealthFloor);
  for (const enemy of world.enemies) world.damage(enemy, 999, world.player.id);
  world.update(1 / 60, input());
  assert.equal(world.trainingComplete, true);
  assert.equal(world.telemetry.enemyKills, 2);
  assert.equal(world.outcome, null);
  assert.ok(world.events.some(e => e.type === 'training-complete'));
});

test('normal boss is beatable through movement, combo, correctly timed dodge and both powers', () => {
  const world = bossWorld(true);
  // A simple honest controller uses only the same input as a human. No modified HP or damage calls.
  for (let frame = 0; frame < 120 * B.timer.demo && !world.outcome; frame++) {
    const p = world.player, b = world.boss!;
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.max(1, Math.hypot(dx, dy));
    const telegraph = b.state === 'Telegraph';
    let x = d > 67 ? dx / d : 0, y = d > 67 ? dy / d : 0;
    if (telegraph) {
      x = -dy / d; y = dx / d;
      if (p.x + x * 125 < 95 || p.x + x * 125 > 865 || p.y + y * 125 < 120 || p.y + y * 125 > 540) { x = -x; y = -y; }
    }
    world.update(1 / 120, input({ x, y, aimX: b.x, aimY: b.y, attack: !telegraph && d < 100 && frame % 24 === 0,
      dodge: telegraph && b.stateTime > b.attackWindup - 0.19, dragon: !telegraph, seal: !telegraph }));
  }
  assert.equal(world.outcome, 'victory', JSON.stringify(world.serialize()));
  assert.equal(world.telemetry.phaseChanges, 2);
  assert.ok(world.telemetry.comboSteps.every(n => n > 0));
  assert.ok(world.telemetry.bossAttacks.every(n => n > 0));
  assert.ok(world.telemetry.damageTaken > 0);
  assert.ok(world.telemetry.dragonCasts > 0 && world.telemetry.sealCasts > 0);
  assert.ok(world.telemetry.damageDealt > world.boss!.maxHp * 0.7);
});
