import Phaser from 'phaser';
import type { Actor, CombatEffect } from '../game/model';
import type { CombatWorld } from '../game/combat';

type Stage = 'menu' | 'training' | 'boss' | 'dawn';
interface Spark { x: number; y: number; vx: number; vy: number; t: number; life: number; color: number; size: number }
interface ActorView { sprite: Phaser.GameObjects.Sprite; previousHp: number; flash: number }

/** Original tile-built sanctuary, animated sprite actors, and layered combat VFX. */
export class WorldView {
  public effectGraphics!: Phaser.GameObjects.Graphics;
  private ground!: Phaser.GameObjects.Graphics;
  private shadows!: Phaser.GameObjects.Graphics;
  private health!: Phaser.GameObjects.Graphics;
  private atmosphere!: Phaser.GameObjects.Graphics;
  private cracks!: Phaser.GameObjects.Graphics;
  private torchLight!: Phaser.GameObjects.Graphics;
  private seal?: Phaser.GameObjects.Image;
  private gateBars?: Phaser.GameObjects.Graphics;
  private gateLight?: Phaser.GameObjects.Graphics;
  private gateRune?: Phaser.GameObjects.Image;
  private gatePrompt?: Phaser.GameObjects.Text;
  private trainingGateOpen = false;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private views = new Map<string, ActorView>();
  private map?: Phaser.Tilemaps.Tilemap;
  private sparks: Spark[] = [];
  private pulses: { x: number; y: number; color: number; radius: number; t: number }[] = [];
  private candles: { x: number; y: number; seed: number }[] = [];
  private stage: Stage = 'menu';
  private clock = 0;
  private seed = 20261102;

  constructor(private scene: Phaser.Scene) {}

  build(stage: Stage): void {
    this.destroy();
    this.stage = stage;
    this.clock = 0;
    this.seed = 20261102;
    this.createAtlas();
    const data = Array.from({ length: 20 }, (_, y) => Array.from({ length: 30 }, (_, x) => {
      if (y < 2 || y > 17 || x < 2 || x > 27) return 4 + ((x + y) % 2);
      return this.random() > 0.86 ? 3 : Math.floor(this.random() * 3);
    }));
    this.map = this.scene.make.tilemap({ data, tileWidth: 32, tileHeight: 32 });
    const tileset = this.map.addTilesetImage('sanctuary-floor', 'sanctuary-floor', 32, 32, 0, 0)!;
    const layer = this.map.createLayer(0, tileset, 0, 0)!;
    layer.setDepth(0);
    if (stage === 'dawn') layer.setTint(0xffe4bb);
    this.own(layer);

    const structure = this.graphics(3);
    // Thick stone boundaries are drawn as a flat top-down plan, never isometric walls.
    structure.fillStyle(stage === 'dawn' ? 0x343a35 : 0x151e25, 1);
    structure.fillRect(0, 0, 960, 65);
    structure.fillRect(0, 589, 960, 51);
    structure.fillRect(0, 0, 52, 640);
    structure.fillRect(908, 0, 52, 640);
    for (let x = 0; x < 960; x += 48) {
      const offset = Math.floor(x / 48) % 2 ? 8 : 0;
      structure.fillStyle(0x263039, 1);
      structure.fillRect(x + 1, 13 + offset, 45, 22);
      structure.fillStyle(stage === 'dawn' ? 0x566052 : 0x37434b, 0.7);
      structure.fillRect(x + 2, 13 + offset, 43, 2);
      structure.fillStyle(0x0c141b, 0.75);
      structure.fillRect(x + 1, 36 + offset, 45, 3);
      structure.fillRect(x + 7, 607, 44, 22);
      structure.fillStyle(0x4a4c43, 0.4);
      structure.fillRect(x + 8, 607, 43, 2);
    }
    for (let y = 62; y < 590; y += 32) {
      structure.fillStyle(0x2c353b, 1);
      structure.fillRect(12, y + 1, 33, 28);
      structure.fillRect(916, y + 1, 33, 28);
      structure.fillStyle(0x45515a, 0.4);
      structure.fillRect(13, y + 1, 31, 2);
      structure.fillRect(916, y + 1, 31, 2);
    }

    const centerX = stage === 'menu' ? 687 : 480;
    const centerY = stage === 'menu' ? 325 : 316;
    if (stage !== 'dawn') {
      const foundation = this.graphics(1);
      foundation.fillStyle(0x121c21, 0.44);
      foundation.fillCircle(centerX, centerY, stage === 'training' ? 132 : 224);
      foundation.lineStyle(3, 0x665c42, 0.42);
      foundation.strokeCircle(centerX, centerY, stage === 'training' ? 133 : 225);
      foundation.lineStyle(1, 0x1b252b, 1);
      for (let i = 0; i < 24; i++) {
        const angle = i * Math.PI / 12;
        const radius = stage === 'training' ? 133 : 224;
        foundation.lineBetween(centerX + Math.cos(angle) * (radius - 17), centerY + Math.sin(angle) * (radius - 17), centerX + Math.cos(angle) * (radius + 6), centerY + Math.sin(angle) * (radius + 6));
      }
      this.seal = this.image(centerX, centerY, 'sigil', 2).setScale(stage === 'training' ? 0.93 : 1.7).setAlpha(stage === 'training' ? 0.43 : 0.72);
    }

    // Fallen masonry stays at the borders so attacks and dodge paths stay readable.
    for (let i = 0; i < 23; i++) {
      const left = i % 2 === 0;
      const x = left ? 54 + this.random() * 34 : 868 + this.random() * 33;
      const y = 105 + this.random() * 452;
      this.image(x, y, 'rubble', 5).setFlipX(!left).setAlpha(0.85);
    }
    for (const x of [57, 904]) {
      for (const y of [117, 300, 492]) {
        this.image(x + 5, y + 13, 'pillar', 4).setTint(0x222c31).setAlpha(0.7).setScale(1.2, 0.65);
        this.image(x, y, 'pillar', y + 1000);
      }
    }
    this.image(480, 65, 'arch', 1500).setOrigin(0.5, 0.5);
    const gate = this.graphics(6);
    this.gateBars = gate;
    gate.fillStyle(0x080f16, 0.87);
    gate.fillRect(434, 16, 92, 48);
    for (let x = 438; x <= 522; x += 12) {
      gate.lineStyle(2, 0x3e4648, 0.65); gate.lineBetween(x, 19, x, 63);
      gate.lineStyle(1, 0x869083, 0.3); gate.lineBetween(x - 1, 20, x - 1, 62);
    }
    for (const x of [179, 780]) {
      this.image(x, 62, 'banner', 1500).setTint(stage === 'dawn' ? 0xc8b68a : 0x8097a0);
      this.image(x + (x < 480 ? -53 : 53), 82, 'chain', 1510);
    }
    for (const [x, y] of [[118, 137], [843, 137], [117, 488], [844, 488], [294, 80], [666, 80]]) {
      this.image(x, y + 3, 'brazier', y + 1300);
      this.candles.push({ x, y: y - 8, seed: this.random() * 20 });
    }
    const details = this.graphics(7);
    for (let i = 0; i < 190; i++) {
      const x = 75 + this.random() * 810;
      const y = 84 + this.random() * 490;
      const outside = Math.hypot(x - 480, y - 320) > 230;
      details.fillStyle(outside ? 0x6b6653 : 0x717568, 0.15 + this.random() * 0.13);
      details.fillRect(Math.floor(x), Math.floor(y), this.random() > 0.65 ? 3 : 1, 1);
      if (outside && i % 8 === 0) {
        details.lineStyle(1, 0x0d161b, 0.8);
        details.lineBetween(x, y, x + 7, y - 3);
        details.lineBetween(x + 7, y - 3, x + 13, y);
      }
    }
    // Broken stone aisle gives spatial orientation at the entrance.
    for (let y = 520; y <= 577; y += 19) {
      details.fillStyle(0x080e14, 0.45); details.fillRect(397, y, 167, 2);
      details.fillStyle(0x56605a, 0.24); details.fillRect(398, y + 2, 166, 1);
    }
    if (stage === 'training') {
      this.gateRune = this.image(480, 94, 'sigil', 8).setScale(0.19).setAlpha(0.3);
      this.gateLight = this.graphics(1801);
      this.gatePrompt = this.scene.add.text(480, 200, 'К АРКЕ ↑', {
        fontFamily: 'Georgia, serif', fontSize: '13px', color: '#e4d29b',
        stroke: '#131c22', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(4100).setVisible(false);
      this.own(this.gatePrompt);
    }
    this.cracks = this.graphics(9);
    this.torchLight = this.graphics(1798);
    this.shadows = this.graphics(1799);
    this.ground = this.graphics(1800);
    this.effectGraphics = this.graphics(4000);
    this.health = this.graphics(5000);
    this.atmosphere = this.graphics(5800);
    this.createVignette(stage);
    if (stage === 'dawn') this.drawDawn();
    this.setTrainingGate(false);
  }

  render(world: CombatWorld, dt: number): void {
    this.setSealDamage(1 - world.sealIntegrity);
    if (this.stage === 'training') this.setTrainingGate(world.trainingComplete);
    this.renderActors(world.actors, dt);
    this.ground.clear();
    this.effectGraphics.clear();
    for (const effect of world.effects) this.drawEffect(effect, world.actors);
    this.drawPulses();
  }

  renderActors(actors: Actor[], dt: number): void {
    this.clock += Math.min(dt, 0.1);
    this.ground.clear();
    this.effectGraphics.clear();
    this.shadows.clear();
    this.health.clear();
    const ids = new Set(actors.map(actor => actor.id));
    for (const [id, view] of this.views) {
      if (!ids.has(id)) { view.sprite.destroy(); this.views.delete(id); }
    }
    for (const actor of actors) {
      let view = this.views.get(actor.id);
      if (!view) {
        const sprite = this.scene.add.sprite(actor.x, actor.y, actor.kind, 0).setOrigin(0.5, 0.62);
        // A shared 2x grid keeps every original sprite pixel equally sized.
        sprite.setScale(2);
        view = { sprite, previousHp: actor.hp, flash: 0 };
        this.views.set(actor.id, view);
      }
      if (actor.hp < view.previousHp) {
        view.flash = 0.13;
        this.particles(actor.x, actor.y - 10, actor.kind === 'demon' ? 0xff8d65 : 0xe1c5a1, actor.kind === 'demon' ? 13 : 8);
      }
      view.previousHp = actor.hp;
      view.flash = Math.max(0, view.flash - dt);
      const sprite = view.sprite;
      const dead = actor.hp <= 0 || actor.state === 'Dead' || actor.state === 'Defeated';
      sprite.setVisible(!(actor.kind === 'demon' && actor.hp <= 0));
      sprite.setPosition(Math.round(actor.x), Math.round(actor.y));
      sprite.setDepth(2000 + actor.y);
      sprite.setFrame(this.actorFrame(actor));
      sprite.setAlpha(dead ? 0.55 : actor.state === 'Dodge' ? 0.64 : actor.invulnerable > 0 && Math.sin(this.clock * 40) > 0.4 ? 0.72 : 1);
      if (view.flash > 0) sprite.setTintFill(0xf5e8c7);
      else if (actor.state === 'PhaseTransition') sprite.setTintFill(Math.sin(this.clock * 18) > 0 ? 0xe78570 : 0x411e2c);
      else if (this.stage === 'dawn') sprite.setTint(0xf2d9aa);
      else sprite.clearTint();
      this.shadows.fillStyle(0x05090d, dead ? 0.3 : 0.52);
      this.shadows.fillEllipse(actor.x, actor.y + (actor.kind === 'demon' ? 17 : 12), actor.radius * 2.8, actor.radius * 0.95);
      if (actor.kind === 'hero' && !dead) {
        this.shadows.lineStyle(1, 0x94c3c8, 0.38);
        this.shadows.strokeEllipse(actor.x, actor.y + 12, 27, 11);
        const d = 31;
        this.shadows.fillStyle(0x9fc8ca, 0.55);
        this.shadows.fillRect(Math.round(actor.x + Math.cos(actor.facing) * d) - 1, Math.round(actor.y + Math.sin(actor.facing) * d) - 1, 3, 3);
      }
      if ((actor.kind === 'hollow' || actor.kind === 'hound') && !dead && actor.hp < actor.maxHp) {
        const width = 37;
        this.health.fillStyle(0x080d11, 0.95); this.health.fillRect(actor.x - width / 2 - 1, actor.y - 39, width + 2, 5);
        this.health.fillStyle(0xb57663, 1); this.health.fillRect(actor.x - width / 2, actor.y - 38, width * actor.hp / actor.maxHp, 3);
      }
      if (actor.state === 'Dodge' && !dead && Math.floor(this.clock * 40) % 2 === 0) this.particles(actor.x, actor.y + 8, actor.kind === 'ally' ? 0xc8b77e : 0x7fabb3, 1);
    }
    this.drawAtmosphere(dt);
    this.flickerLights();
    this.drawTrainingGate();
    this.drawPulses();
  }

  /** The opened arch marks the same x430..530 / y<=155 doorway used by gameplay. */
  setTrainingGate(open: boolean): void {
    if (this.stage !== 'training') return;
    const justOpened = open && !this.trainingGateOpen;
    this.trainingGateOpen = open;
    this.gateBars?.setVisible(!open);
    this.gateRune?.setAlpha(open ? 1 : 0.3);
    this.gatePrompt?.setVisible(open);
    if (justOpened) {
      this.particles(480, 122, 0xe5c579, 28);
      this.ringPulse(480, 127, 0xe5c579, 54);
    }
    this.drawTrainingGate();
  }

  private drawTrainingGate(): void {
    const g = this.gateLight;
    if (!g) return;
    g.clear();
    if (!this.trainingGateOpen) return;
    const pulse = 0.65 + Math.sin(this.clock * 2.8) * 0.2;
    // Warm light spills through the actual doorway; no extra floor obstacles.
    g.fillStyle(0xd3b66b, 0.05 * pulse);
    g.fillTriangle(450, 93, 418, 155, 480, 155);
    g.fillTriangle(510, 93, 480, 155, 542, 155);
    g.fillStyle(0xe6cb84, 0.08 * pulse);
    g.fillRect(434, 104, 92, 50);
    // Inlaid threshold corners make the entry zone visible at the walkable Y.
    g.lineStyle(2, 0xe6cb84, pulse);
    g.lineBetween(431, 139, 431, 155); g.lineBetween(431, 155, 451, 155);
    g.lineBetween(529, 139, 529, 155); g.lineBetween(529, 155, 509, 155);
    g.lineStyle(1, 0xb39d69, pulse * 0.6);
    g.lineBetween(445, 128, 445, 145); g.lineBetween(515, 128, 515, 145);
    // A restrained animated trail leads north rather than to the wall itself.
    for (let i = 0; i < 5; i++) {
      const y = 151 + i * 18;
      const alpha = (0.28 + Math.sin(this.clock * 3.5 + i * 0.8) * 0.17) * (1 - i * 0.12);
      g.fillStyle(0xe4d092, alpha);
      g.fillRect(478, y, 4, 2);
      if (i === 0) {
        g.fillRect(475, y + 3, 3, 2); g.fillRect(482, y + 3, 3, 2);
      }
    }
    for (let i = 0; i < 7; i++) {
      const phase = (this.clock * 0.18 + i / 7) % 1;
      g.fillStyle(0xe8d39b, Math.sin(phase * Math.PI) * 0.65);
      g.fillRect(Math.round(447 + (i * 17 % 62)), Math.round(151 - phase * 50), 2, 2);
    }
    this.gateRune?.setAlpha(0.7 + pulse * 0.3);
    this.gatePrompt?.setAlpha(0.8 + pulse * 0.2);
  }

  particles(x: number, y: number, color: number, count = 12): void {
    for (let i = 0; i < count; i++) {
      const angle = this.random() * Math.PI * 2;
      const speed = 18 + this.random() * 125;
      this.sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 20, t: 0, life: 0.25 + this.random() * 0.55, color, size: this.random() > 0.7 ? 3 : 2 });
    }
    if (this.sparks.length > 550) this.sparks.splice(0, this.sparks.length - 550);
  }

  ringPulse(x: number, y: number, color: number, radius: number): void {
    this.pulses.push({ x, y, color, radius, t: 0 });
    this.particles(x, y, color, 20);
  }

  /** fraction is DAMAGE: 0 = intact, 1 = destroyed. */
  setSealDamage(fraction: number): void {
    if (!this.cracks) return;
    const damage = Phaser.Math.Clamp(fraction, 0, 1);
    this.cracks.clear();
    if (this.stage === 'training' || this.stage === 'dawn') return;
    this.seal?.setAlpha((0.7 - damage * 0.25) + Math.sin(this.clock * (2 + damage * 7)) * damage * 0.13);
    const cx = this.stage === 'menu' ? 687 : 480, cy = this.stage === 'menu' ? 325 : 316;
    const count = Math.floor(damage * 17);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996 + 0.3;
      const start = 45 + i % 3 * 23, end = 145 + i % 4 * 19;
      const x = cx + Math.cos(angle) * start, y = cy + Math.sin(angle) * start;
      const mx = cx + Math.cos(angle + 0.06) * ((start + end) / 2), my = cy + Math.sin(angle + 0.06) * ((start + end) / 2);
      this.cracks.lineStyle(3, 0x0c141b, 0.9); this.cracks.lineBetween(x, y, mx, my); this.cracks.lineBetween(mx, my, cx + Math.cos(angle - 0.03) * end, cy + Math.sin(angle - 0.03) * end);
      this.cracks.lineStyle(1, damage > 0.75 ? 0xb66c5c : 0xa78c54, 0.55); this.cracks.lineBetween(x - 1, y - 1, mx - 1, my - 1);
    }
  }

  destroy(): void {
    for (const view of this.views.values()) view.sprite.destroy();
    this.views.clear();
    this.objects.forEach(object => { if (object.scene) object.destroy(); });
    this.objects = [];
    this.map?.destroy();
    this.map = undefined;
    this.seal = undefined;
    this.gateBars = undefined;
    this.gateLight = undefined;
    this.gateRune = undefined;
    this.gatePrompt = undefined;
    this.trainingGateOpen = false;
    this.sparks = [];
    this.pulses = [];
    this.candles = [];
  }

  private actorFrame(actor: Actor): number {
    const c = Math.cos(actor.facing), s = Math.sin(actor.facing);
    const direction = Math.abs(c) > Math.abs(s) ? c > 0 ? 2 : 1 : s > 0 ? 0 : 3;
    let frame = 0;
    switch (actor.state) {
      case 'Walk': case 'Chase': frame = 2 + Math.floor(actor.stateTime * (actor.kind === 'hound' ? 13 : 10)) % 4; break;
      case 'Telegraph': frame = 6 + (actor.attackIndex % 3); break;
      case 'Attack': {
        const progress = actor.attackDuration > 0 ? actor.stateTime / actor.attackDuration : actor.stateTime * 5;
        frame = 6 + Math.min(2, Math.floor(progress * 3));
        // Combo finish has a visibly different body/weapon pose immediately.
        if (actor.kind === 'hero' && actor.attackIndex === 1) frame = 8 - Math.min(2, Math.floor(progress * 3));
        if (actor.kind === 'hero' && actor.attackIndex === 2) frame = actor.stateTime < actor.attackWindup ? 6 : 8;
        break;
      }
      case 'Recovery': frame = 8; break;
      case 'Dodge': frame = 9; break;
      case 'Hit': case 'Stagger': frame = 10; break;
      case 'Dead': case 'Defeated': frame = 11; break;
      case 'PhaseTransition': frame = 6 + Math.floor(actor.stateTime * 8) % 3; break;
      default: frame = Math.floor(this.clock * 1.9) % 2;
    }
    if (actor.hp <= 0) frame = 11;
    return direction * 12 + frame;
  }

  private drawEffect(e: CombatEffect, actors: Actor[]): void {
    const progress = Phaser.Math.Clamp(e.t / e.duration, 0, 1);
    const g = e.kind.startsWith('telegraph') || ['seal', 'impact', 'barrier', 'phase'].includes(e.kind) ? this.ground : this.effectGraphics;
    const alpha = 1 - progress;
    if (e.kind === 'telegraph-cone') {
      this.sector(g, e.x, e.y, e.angle, e.radius, e.arc, 0xc74946, 0.1 + progress * 0.18);
      g.lineStyle(2, 0xf18e71, 0.55 + progress * 0.4);
      g.beginPath(); g.arc(e.x, e.y, e.radius * (0.35 + progress * 0.65), e.angle - e.arc / 2, e.angle + e.arc / 2); g.strokePath();
    } else if (e.kind === 'telegraph-line') {
      const dx = Math.cos(e.angle), dy = Math.sin(e.angle), nx = -dy * e.width / 2, ny = dx * e.width / 2;
      const points = [{ x: e.x + nx, y: e.y + ny }, { x: e.x + dx * e.length + nx, y: e.y + dy * e.length + ny }, { x: e.x + dx * e.length - nx, y: e.y + dy * e.length - ny }, { x: e.x - nx, y: e.y - ny }];
      g.fillStyle(0x9d363c, 0.12 + progress * 0.16); g.fillPoints(points, true);
      g.lineStyle(1, 0xfa917b, 0.62); g.strokePoints(points, true);
      g.lineStyle(2, 0xf0aa82, 0.65); g.lineBetween(e.x, e.y, e.x + dx * e.length * progress, e.y + dy * e.length * progress);
      for (let along = 44; along < e.length; along += 52) {
        const x = e.x + dx * along, y = e.y + dy * along;
        g.lineStyle(1, 0xffb292, 0.35 + progress * 0.4);
        g.lineBetween(x - dx * 9 - dy * 7, y - dy * 9 + dx * 7, x, y);
        g.lineBetween(x - dx * 9 + dy * 7, y - dy * 9 - dx * 7, x, y);
      }
    } else if (e.kind === 'telegraph-circle') {
      g.fillStyle(0xa43540, 0.08 + progress * 0.14); g.fillCircle(e.x, e.y, e.radius);
      g.lineStyle(2, 0xf48e73, 0.8); g.strokeCircle(e.x, e.y, e.radius);
      g.lineStyle(1, 0xe56960, 0.5); g.strokeCircle(e.x, e.y, e.radius * progress);
      g.lineBetween(e.x - 9, e.y, e.x + 9, e.y); g.lineBetween(e.x, e.y - 9, e.x, e.y + 9);
    } else if (e.kind === 'slash') {
      const owner = actors.find(actor => actor.id === e.ownerId);
      const x = owner?.x ?? e.x, y = owner?.y ?? e.y;
      const start = e.angle - e.arc / 2 + progress * e.arc * 0.3;
      const end = start + e.arc * (0.7 - progress * 0.3);
      this.sector(g, x, y, (start + end) / 2, e.radius, end - start, e.color, alpha * 0.12);
      g.lineStyle(7 * alpha + 1, e.color, alpha * 0.75); g.beginPath(); g.arc(x, y, e.radius * 0.81, start, end); g.strokePath();
      g.lineStyle(2, 0xfff5d7, alpha * 0.92); g.beginPath(); g.arc(x, y, e.radius * 0.85, start + 0.08, end); g.strokePath();
      const tip = e.angle - e.arc / 2 + progress * e.arc;
      g.lineStyle(1, e.color, alpha * 0.8); g.lineBetween(x + Math.cos(tip) * 24, y + Math.sin(tip) * 24, x + Math.cos(tip) * e.radius, y + Math.sin(tip) * e.radius);
    } else if (e.kind === 'dragon' || e.kind === 'wave') {
      const dx = Math.cos(e.angle), dy = Math.sin(e.angle), size = e.radius;
      g.fillStyle(e.color, 0.14); g.fillCircle(e.x, e.y, size * 1.35);
      const points = [
        { x: e.x + dx * size, y: e.y + dy * size },
        { x: e.x - dy * size * 0.65, y: e.y + dx * size * 0.65 },
        { x: e.x - dx * size * 1.7, y: e.y - dy * size * 1.7 },
        { x: e.x + dy * size * 0.65, y: e.y - dx * size * 0.65 },
      ];
      g.fillStyle(e.color, 0.62); g.fillPoints(points, true);
      g.lineStyle(2, 0xffd5ab, 0.9); g.lineBetween(e.x - dx * size * 0.5, e.y - dy * size * 0.5, e.x + dx * size * 0.65, e.y + dy * size * 0.65);
      g.fillStyle(0xffe4b8, 0.8); g.fillRect(Math.round(e.x) - 2, Math.round(e.y) - 2, 4, 4);
      if (Math.floor(this.clock * 60) % 2 === 0) this.particles(e.x - dx * size, e.y - dy * size, e.color, 1);
    } else if (e.kind === 'seal') {
      const activated = e.triggered;
      const radius = e.radius * (activated ? 1 + progress * 0.1 : 0.9);
      g.fillStyle(e.color, activated ? 0.22 * alpha : 0.07); g.fillCircle(e.x, e.y, radius);
      g.lineStyle(activated ? 4 : 2, e.color, activated ? alpha : 0.7); g.strokeCircle(e.x, e.y, radius);
      g.lineStyle(1, 0xdce3ba, 0.8 * alpha); g.strokeCircle(e.x, e.y, radius - 9);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4 + this.clock * 0.4;
        const x = e.x + Math.cos(angle) * radius * 0.72, y = e.y + Math.sin(angle) * radius * 0.72;
        g.lineBetween(x - 4, y - 5, x, y + 5); g.lineBetween(x, y + 5, x + 4, y - 5);
      }
      if (activated) {
        g.lineStyle(3, 0xffecc1, alpha); g.lineBetween(e.x - radius * 0.7, e.y - radius * 0.7, e.x + radius * 0.7, e.y + radius * 0.7);
        g.lineBetween(e.x + radius * 0.7, e.y - radius * 0.7, e.x - radius * 0.7, e.y + radius * 0.7);
      }
    } else if (e.kind === 'impact') {
      g.lineStyle(e.triggered ? 4 : 1, e.color, e.triggered ? alpha : 0.5); g.strokeCircle(e.x, e.y, e.radius * (e.triggered ? 0.7 + progress * 0.4 : 1));
      g.fillStyle(e.color, e.triggered ? alpha * 0.32 : 0.06); g.fillCircle(e.x, e.y, e.radius);
      if (e.triggered) for (let i = 0; i < 7; i++) {
        const angle = i * Math.PI * 2 / 7;
        const reach = e.radius * (0.4 + (i % 3) * 0.18);
        g.lineStyle(2, 0xffbe85, alpha); g.lineBetween(e.x, e.y, e.x + Math.cos(angle) * reach, e.y + Math.sin(angle) * reach);
      }
    } else if (e.kind === 'barrier') {
      const radius = e.radius + Math.sin(this.clock * 5) * 2;
      g.lineStyle(2, e.color, 0.45 * Math.min(1, alpha * 4)); g.strokeCircle(e.x, e.y, radius);
      g.fillStyle(e.color, 0.035); g.fillCircle(e.x, e.y, radius);
      for (let i = 0; i < 10; i++) {
        const angle = i * Math.PI / 5 + this.clock * 0.2;
        const x = e.x + Math.cos(angle) * radius, y = e.y + Math.sin(angle) * radius;
        g.fillStyle(0xe9dcac, 0.65); g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
      }
    } else if (e.kind === 'dash') {
      const owner = actors.find(actor => actor.id === e.ownerId);
      const x = owner?.x ?? e.x, y = owner?.y ?? e.y;
      g.lineStyle(2, e.color, alpha * 0.4);
      for (let i = -1; i <= 1; i++) g.lineBetween(e.x - Math.sin(e.angle) * i * 10, e.y + Math.cos(e.angle) * i * 10, x - Math.sin(e.angle) * i * 10, y + Math.cos(e.angle) * i * 10);
    } else if (e.kind === 'phase') {
      g.lineStyle(3, e.color, alpha * 0.8); g.strokeCircle(e.x, e.y, e.radius * progress);
      g.lineStyle(1, 0xf6a274, alpha * 0.6); g.strokeCircle(e.x, e.y, e.radius * progress * 0.83);
      g.fillStyle(e.color, 0.08 * Math.sin(progress * Math.PI)); g.fillCircle(e.x, e.y, e.radius * progress);
    }
  }

  private drawPulses(): void {
    for (const pulse of this.pulses) {
      const progress = pulse.t / 0.8;
      this.effectGraphics.lineStyle(3 * (1 - progress) + 1, pulse.color, (1 - progress) * 0.8);
      this.effectGraphics.strokeCircle(pulse.x, pulse.y, pulse.radius * progress);
    }
  }

  private drawAtmosphere(dt: number): void {
    const g = this.atmosphere;
    g.clear();
    this.pulses.forEach(pulse => pulse.t += dt);
    this.pulses = this.pulses.filter(pulse => pulse.t < 0.8);
    for (const spark of this.sparks) {
      spark.t += dt;
      spark.x += spark.vx * dt; spark.y += spark.vy * dt;
      spark.vy += 48 * dt;
      g.fillStyle(spark.color, Math.max(0, 1 - spark.t / spark.life));
      g.fillRect(Math.round(spark.x), Math.round(spark.y), spark.size, spark.size);
    }
    this.sparks = this.sparks.filter(spark => spark.t < spark.life);
    for (let i = 0; i < 57; i++) {
      const x = ((i * 137.17 + this.clock * (3 + i % 4)) % 980) - 10;
      const y = ((i * 83.31 - this.clock * (3 + i % 3)) % 660 + 660) % 660 - 10;
      g.fillStyle(this.stage === 'dawn' ? 0xd8bf86 : 0xa8a18a, 0.09 + (Math.sin(this.clock * 0.7 + i) + 1) * 0.07);
      g.fillRect(Math.floor(x), Math.floor(y), i % 4 ? 1 : 2, 1);
    }
  }

  private flickerLights(): void {
    const g = this.torchLight;
    g.clear();
    for (const candle of this.candles) {
      const flicker = 0.75 + Math.sin(this.clock * 8 + candle.seed) * 0.15 + Math.sin(this.clock * 15 + candle.seed) * 0.1;
      g.fillStyle(0xe59c52, 0.018 * flicker); g.fillCircle(candle.x, candle.y, 70);
      g.fillStyle(0xe59c52, 0.025 * flicker); g.fillCircle(candle.x, candle.y, 44);
      g.fillStyle(0xf5b366, 0.06 * flicker); g.fillCircle(candle.x, candle.y, 19);
      g.fillStyle(0xffdf95, 0.85); g.fillRect(candle.x - 1, candle.y - Math.round(3 * flicker), 3, 4);
      if (Math.floor(this.clock * 12 + candle.seed) % 25 === 0) this.particles(candle.x, candle.y - 5, 0xc99562, 1);
    }
  }

  private sector(g: Phaser.GameObjects.Graphics, x: number, y: number, angle: number, radius: number, arc: number, color: number, alpha: number): void {
    const points = [{ x, y }];
    for (let i = 0; i <= 24; i++) {
      const a = angle - arc / 2 + arc * i / 24;
      points.push({ x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius });
    }
    g.fillStyle(color, alpha); g.fillPoints(points, true);
  }

  private createAtlas(): void {
    if (this.scene.textures.exists('sanctuary-floor')) return;
    const texture = this.scene.textures.createCanvas('sanctuary-floor', 192, 32)!;
    const context = texture.getContext();
    context.imageSmoothingEnabled = false;
    for (let i = 0; i < 6; i++) context.drawImage(this.scene.textures.get(`floor${i}`).getSourceImage() as HTMLCanvasElement, i * 32, 0);
    texture.refresh();
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }

  private createVignette(stage: Stage): void {
    const key = `sanctuary-light-${stage}`;
    if (!this.scene.textures.exists(key)) {
      const texture = this.scene.textures.createCanvas(key, 960, 640)!;
      const ctx = texture.getContext();
      const centerX = stage === 'menu' ? 680 : 480;
      const gradient = ctx.createRadialGradient(centerX, 320, 140, centerX, 320, 600);
      gradient.addColorStop(0, 'rgba(3,8,14,0)');
      gradient.addColorStop(0.65, 'rgba(3,8,14,0.15)');
      gradient.addColorStop(1, stage === 'dawn' ? 'rgba(17,22,26,0.62)' : 'rgba(2,7,13,0.86)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 960, 640);
      if (stage === 'menu') {
        const shade = ctx.createLinearGradient(0, 0, 960, 0);
        shade.addColorStop(0, 'rgba(4,10,17,0.94)'); shade.addColorStop(0.42, 'rgba(4,10,17,0.72)'); shade.addColorStop(0.74, 'rgba(4,10,17,0)');
        ctx.fillStyle = shade; ctx.fillRect(0, 0, 960, 640);
      }
      texture.refresh();
    }
    this.image(480, 320, key, 5700);
  }

  private drawDawn(): void {
    const g = this.graphics(10);
    // Top-down shafts of dawn over the same ruined stones, with no camera perspective.
    for (let i = 0; i < 9; i++) {
      g.fillStyle(0xe6bf79, 0.045 + (i % 3) * 0.012);
      g.fillTriangle(470 + i * 3, -50, 70 + i * 80, 640, 120 + i * 80, 640);
    }
    g.fillStyle(0xddb979, 0.11); g.fillRect(55, 68, 850, 519);
    this.candles = [];
  }

  private image(x: number, y: number, key: string, depth: number): Phaser.GameObjects.Image {
    const image = this.scene.add.image(x, y, key).setDepth(depth);
    this.own(image);
    return image;
  }
  private graphics(depth: number): Phaser.GameObjects.Graphics {
    const graphics = this.scene.add.graphics().setDepth(depth);
    this.own(graphics);
    return graphics;
  }
  private own(object: Phaser.GameObjects.GameObject): void { this.objects.push(object); }
  private random(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
}
