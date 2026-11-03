import Phaser from 'phaser';
import { generateArt } from '../art/generate';
import { Input } from '../systems/Input';
import { audio } from '../systems/Audio';
import { LOCATIONS } from './locations';
import { movePlayer, canOccupy } from './movement';
import { castleSession, castleTransitions } from './TransitionManager';
import { LocationView } from './LocationView';
import { CastleHud } from './CastleHud';
import type { LocationDefinition, LocationDoor, LocationId, Point, Rect } from './types';

const SPEED = 190;
const RADIUS = 12;
const INTERACTION_DISTANCE = 72;
const FADE_MS = 280;

/** Distance to a doorway's actual rectangle, including its walkable threshold. */
function distanceToRect(position: Point, rect: Rect): number {
  return Math.hypot(Math.max(rect.x - position.x, 0, position.x - rect.x - rect.width),
    Math.max(rect.y - position.y, 0, position.y - rect.y - rect.height));
}

/** Reusable scene lifecycle. Each region has its own map, camera and display list. */
export class CastleLocationScene extends Phaser.Scene {
  private readonly def: LocationDefinition;
  private view!: LocationView;
  private controls!: Input;
  private hud!: CastleHud;
  private player = { x: 0, y: 0, facing: Math.PI / 2, stateTime: 0, moving: false };
  private spawnName = 'default';
  private active = false;
  private mapOpen = false;
  private paused = false;
  private messageTime = 0;
  private footstepDistance = 0;
  private nearestDoor: LocationDoor | null = null;
  private nearNpc = false;
  private prompt = '';
  private visibilityHandler = () => { if (document.hidden && this.active && !castleTransitions.busy) this.setPaused(true); };

  constructor(id: LocationId) {
    super(id);
    this.def = LOCATIONS[id];
  }

  init(data: { spawn?: string } = {}) {
    this.spawnName = data.spawn && this.def.spawns[data.spawn] ? data.spawn : 'default';
    this.active = false; this.paused = false; this.mapOpen = false; this.messageTime = 0;
    this.nearestDoor = null; this.nearNpc = false; this.prompt = ''; this.footstepDistance = 0;
  }

  create() {
    generateArt(this);
    const spawn = this.def.spawns[this.spawnName];
    if (!canOccupy(spawn, this.def, RADIUS)) throw new Error(`Blocked spawn: ${this.def.id}/${this.spawnName}`);
    this.player = { ...spawn, facing: this.def.id === 'CastleArmory' ? -Math.PI / 2 : Math.PI / 2, stateTime: 0, moving: false };
    castleSession.currentLocation = this.def.id;
    castleSession.position = { ...spawn };
    if (!castleSession.visited.includes(this.def.id)) castleSession.visited.push(this.def.id);
    this.view = new LocationView(this, this.def);
    this.view.update(this.player);
    this.controls = new Input(this, { mode: 'exploration' });
    this.controls.enabled = false;
    this.hud = new CastleHud(this.def, {
      menu: () => this.returnToMenu(),
      toggleMap: () => this.toggleMap(),
      resume: () => this.setPaused(false),
    });
    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.def.width, this.def.height);
    camera.roundPixels = true;
    camera.startFollow(this.view.hero, true, 0.12, 0.12);
    camera.centerOn(spawn.x, spawn.y);
    camera.resetFX();
    this.game.canvas.setAttribute('aria-label', this.def.title + ' — исследование замка');
    this.refreshInteraction(); this.refreshHud(true);
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, () => {
      castleTransitions.complete(); this.active = true; this.controls.enabled = true;
      this.refreshInteraction(); this.refreshHud(false);
    });
    camera.fadeIn(FADE_MS, 0, 0, 0);
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.active = false;
      this.controls.destroy(); this.hud.destroy(); this.view.destroy();
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    });
    if (new URLSearchParams(location.search).get('test') === '1') this.installTestHarness();
  }

  private refreshInteraction() {
    this.nearestDoor = [...this.def.doors]
      .filter(door => distanceToRect(this.player, door) <= INTERACTION_DISTANCE)
      .sort((a, b) => distanceToRect(this.player, a) - distanceToRect(this.player, b))[0] ?? null;
    this.nearNpc = !!this.def.npc && Math.hypot(this.player.x - this.def.npc.x, this.player.y - this.def.npc.y) <= 76;
    this.prompt = this.nearestDoor?.prompt ?? (this.nearNpc ? 'E — Поговорить со смотрителем' : '');
    this.view.setDoorHighlight(this.nearestDoor?.id ?? null);
  }

  private refreshHud(busy = castleTransitions.busy || !this.active) {
    const camera = this.cameras.main;
    this.hud.update(this.player, castleSession, this.prompt, busy, {
      x: camera.scrollX, y: camera.scrollY, width: camera.width, height: camera.height,
    });
  }

  private toggleMap() {
    if (!this.active || castleTransitions.busy) return;
    this.mapOpen = !this.mapOpen;
    this.hud.setMapOpen(this.mapOpen); this.refreshHud();
  }

  private setPaused(value: boolean) {
    if (!this.active || castleTransitions.busy) return;
    this.paused = value;
    this.controls.enabled = !value;
    this.controls.clear();
    this.hud.setPaused(value);
  }

  private returnToMenu() {
    if (!this.active || castleTransitions.busy) return;
    this.controls.enabled = false;
    this.scene.start('Game');
  }

  private interact() {
    if (!this.active || castleTransitions.busy) return;
    if (this.nearestDoor) {
      const door = this.nearestDoor;
      if (!castleTransitions.request(door.target, door.targetSpawn)) return;
      this.active = false; this.controls.enabled = false; this.player.moving = false;
      this.view.update(this.player); this.refreshHud(true);
      audio.play('click');
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        const next = castleTransitions.consume();
        if (next) this.scene.start(next.scene, { spawn: next.spawn });
      });
      this.cameras.main.fadeOut(FADE_MS, 0, 0, 0);
    } else if (this.nearNpc && this.def.npc) {
      this.hud.setMessage(`${this.def.npc.name ?? 'Смотритель'}: ${this.def.npc.text}`);
      this.messageTime = 5;
    }
  }

  update(_time: number, delta: number) {
    if (!this.controls) return;
    if (this.controls.consumePause() && this.active) this.setPaused(!this.paused);
    if (!this.active || this.paused || castleTransitions.busy) return;
    const dt = Math.min(Math.max(0, delta / 1000), 0.1);
    if (this.controls.consumeMap()) this.toggleMap();
    const input = this.controls.sample();
    const next = movePlayer(this.player, input, dt, this.def, RADIUS, SPEED);
    const distance = Math.hypot(next.x - this.player.x, next.y - this.player.y);
    this.player.x = next.x; this.player.y = next.y;
    this.player.moving = distance > 0.001;
    if (Math.hypot(input.x, input.y) > 0.12) this.player.facing = Math.atan2(input.y, input.x);
    this.player.stateTime += dt;
    castleSession.position = { x: next.x, y: next.y };
    this.view.update(this.player);
    this.footstepDistance += distance;
    if (this.footstepDistance >= 36) { this.footstepDistance = 0; audio.play('step'); }
    if (this.messageTime > 0) {
      this.messageTime -= dt;
      if (this.messageTime <= 0) this.hud.setMessage(null);
    }
    this.refreshInteraction();
    if (this.controls.consumeInteract()) this.interact();
    this.refreshHud();
  }

  /** Opt-in fixture for browser integration tests; absent from the normal game. */
  private installTestHarness() {
    const scene = this;
    (window as unknown as { __castle: unknown }).__castle = {
      snapshot: () => ({
        location: scene.def.id, title: scene.def.title,
        player: { ...scene.player },
        health: castleSession.health, maxHealth: castleSession.maxHealth,
        inventory: [...castleSession.inventory], visited: [...castleSession.visited],
        active: scene.active, paused: scene.paused, mapOpen: scene.mapOpen,
        busy: castleTransitions.busy || !scene.active, pending: castleTransitions.pending,
        prompt: scene.prompt, width: scene.def.width, height: scene.def.height,
        camera: { x: scene.cameras.main.scrollX, y: scene.cameras.main.scrollY, width: scene.cameras.main.width, height: scene.cameras.main.height },
        fade: { running: scene.cameras.main.fadeEffect.isRunning, progress: scene.cameras.main.fadeEffect.progress, out: scene.cameras.main.fadeEffect.direction },
        doors: scene.def.doors, props: scene.def.props, walls: scene.def.walls, npc: scene.def.npc ?? null,
        scenes: scene.scene.manager.getScenes(true).map(item => item.scene.key),
      }),
      session: () => castleSession,
      advance: (seconds: number) => {
        for (let t = 0; t < seconds; t += 1 / 60) {
          scene.update(performance.now(), 1000 / 60);
          scene.cameras.main.preRender();
        }
      },
    };
  }
}

export class CourtyardScene extends CastleLocationScene {
  constructor() { super('CastleCourtyard'); }
}
export class ArmoryScene extends CastleLocationScene {
  constructor() { super('CastleArmory'); }
}
