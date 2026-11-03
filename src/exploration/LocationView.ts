import Phaser from 'phaser';
import type { LocationDefinition } from './types';

interface PlayerPose { x: number; y: number; facing: number; stateTime: number; moving: boolean }

/** Schematic, strictly top-down locations. Drawing uses the same bounds as collision data. */
export class LocationView {
  public readonly hero: Phaser.GameObjects.Sprite;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private map?: Phaser.Tilemaps.Tilemap;
  private doors: Phaser.GameObjects.Graphics;
  private heroShadow: Phaser.GameObjects.Ellipse;
  private highlighted: string | null = null;
  private npc?: Phaser.GameObjects.Sprite;
  private elapsed = 0;

  constructor(private scene: Phaser.Scene, private def: LocationDefinition) {
    this.drawFloor();
    this.drawWalls();
    this.doors = this.own(scene.add.graphics().setDepth(60));
    this.drawDoors();
    for (const prop of def.props) this.drawProp(prop);
    if (def.npc) {
      const { x, y, id } = def.npc;
      this.own(scene.add.ellipse(x, y + 15, 33, 11, 0x080e12, 0.4).setDepth(1990 + y));
      this.npc = this.own(scene.add.sprite(x, y, 'ally', 0).setScale(2).setOrigin(0.5, 0.62).setDepth(2000 + y));
      this.label(x, y - 49, def.npc.name ?? (id.toLowerCase().includes('armor') ? 'Оружейник' : 'Смотритель'), '#c6bb93', 12).setDepth(3000 + y);
    }
    this.heroShadow = this.own(scene.add.ellipse(def.spawn.x, def.spawn.y + 15, 33, 11, 0x080e12, 0.45).setDepth(1900));
    this.hero = this.own(scene.add.sprite(def.spawn.x, def.spawn.y, 'hero', 0).setScale(2).setOrigin(0.5, 0.62).setDepth(2000 + def.spawn.y));
  }

  update(player: PlayerPose): void {
    const c = Math.cos(player.facing), s = Math.sin(player.facing);
    const direction = Math.abs(c) > Math.abs(s) ? (c > 0 ? 2 : 1) : (s > 0 ? 0 : 3);
    const frame = player.moving ? 2 + Math.floor(player.stateTime * 10) % 4 : Math.floor(player.stateTime * 1.8) % 2;
    this.hero.setPosition(Math.round(player.x), Math.round(player.y)).setFrame(direction * 12 + frame).setDepth(2000 + player.y);
    this.heroShadow.setPosition(Math.round(player.x), Math.round(player.y + 15)).setDepth(1990 + player.y);
    this.elapsed = player.stateTime;
    this.npc?.setFrame(Math.floor(this.elapsed * 1.5) % 2);
  }

  setDoorHighlight(id: string | null): void {
    if (id === this.highlighted) return;
    this.highlighted = id;
    this.drawDoors();
  }

  destroy(): void {
    for (const object of this.objects) if (object.scene) object.destroy();
    this.objects = [];
    this.map?.destroy();
    this.map = undefined;
  }

  private drawFloor(): void {
    const key = 'castle-floor-atlas';
    if (!this.scene.textures.exists(key)) {
      const atlas = this.scene.textures.createCanvas(key, 192, 32)!;
      const context = atlas.getContext();
      context.imageSmoothingEnabled = false;
      for (let i = 0; i < 6; i++) context.drawImage(this.scene.textures.get(`floor${i}`).getSourceImage() as HTMLCanvasElement, i * 32, 0);
      atlas.refresh();
      atlas.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    const columns = Math.ceil(this.def.width / 32), rows = Math.ceil(this.def.height / 32);
    const data = Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => {
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      return n % 13 === 0 ? 4 : n % 4;
    }));
    this.map = this.scene.make.tilemap({ data, tileWidth: 32, tileHeight: 32 });
    const tileset = this.map.addTilesetImage(key, key, 32, 32, 0, 0)!;
    const layer = this.map.createLayer(0, tileset, 0, 0)!;
    layer.setDepth(0);
    if (this.def.id === 'CastleArmory') layer.setTint(0xb9b7a4);
  }

  private drawWalls(): void {
    const g = this.own(this.scene.add.graphics().setDepth(50));
    for (const r of this.def.walls) {
      // Rect top-left and size match the solid geometry; no perspective extrusion.
      g.fillStyle(0x182329, 1); g.fillRect(r.x, r.y, r.width, r.height);
      g.lineStyle(2, 0x67716c, 0.8); g.strokeRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2);
      for (let y = r.y + 5; y < r.y + r.height - 4; y += 24) {
        for (let x = r.x + 4; x < r.x + r.width - 4; x += 40) {
          const w = Math.min(36, r.x + r.width - 4 - x);
          const h = Math.min(20, r.y + r.height - 4 - y);
          g.fillStyle(0x38444a, 1); g.fillRect(x, y, w, h);
          g.fillStyle(0x53605f, 0.7); g.fillRect(x, y, w, Math.min(2, h));
        }
      }
    }
  }

  private drawDoors(): void {
    const g = this.doors;
    g.clear();
    for (const door of this.def.doors) {
      const hot = door.id === this.highlighted;
      g.fillStyle(hot ? 0x695b34 : 0x3f4238, 1);
      g.fillRect(door.x, door.y, door.width, door.height);
      g.lineStyle(hot ? 3 : 2, hot ? 0xf0d48f : 0x9f9870, hot ? 1 : 0.65);
      g.strokeRect(door.x + 2, door.y + 2, door.width - 4, door.height - 4);
      const cx = door.x + door.width / 2, cy = door.y + door.height / 2;
      const north = door.y < this.def.height / 2;
      g.lineStyle(2, hot ? 0xffe8ab : 0xb7ad85, 0.9);
      g.lineBetween(cx, cy + (north ? 10 : -10), cx, cy + (north ? -10 : 10));
      g.lineBetween(cx, cy + (north ? -10 : 10), cx - 6, cy + (north ? -3 : 3));
      g.lineBetween(cx, cy + (north ? -10 : 10), cx + 6, cy + (north ? -3 : 3));
    }
  }

  private drawProp(prop: LocationDefinition['props'][number]): void {
    const { x, y, width: w, height: h, kind, solid } = prop;
    const g = this.own(this.scene.add.graphics().setDepth(2000 + y + h));
    // A complete base footprint makes the obstacle's true occupied area legible.
    g.fillStyle(solid ? 0x1c272c : 0x303736, 1); g.fillRect(x, y, w, h);
    g.lineStyle(1, solid ? 0x6b7064 : 0x4c5750, 0.75); g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    const cx = x + w / 2, cy = y + h / 2;
    const rect = (rx: number, ry: number, rw: number, rh: number, color: number) => {
      g.fillStyle(color, 1); g.fillRect(x + rx * w, y + ry * h, rw * w, rh * h);
    };
    if (kind === 'dummy') {
      rect(0.45, 0.12, 0.1, 0.8, 0x8d7455);
      rect(0.14, 0.34, 0.72, 0.12, 0x907658);
      rect(0.28, 0.27, 0.44, 0.4, 0xb9a279);
      rect(0.37, 0.08, 0.26, 0.18, 0xc2b28d);
      rect(0.43, 0.12, 0.14, 0.04, 0x655943);
      g.lineStyle(2, 0x7f443e, 1); g.strokeCircle(cx, y + h * 0.47, Math.min(w, h) * 0.13);
      g.lineBetween(cx - w * 0.18, y + h * 0.33, cx + w * 0.18, y + h * 0.59);
    } else if (kind === 'weaponrack') {
      rect(0.07, 0.1, 0.86, 0.8, 0x5b4937);
      rect(0.12, 0.14, 0.76, 0.71, 0x263036);
      for (let i = 0; i < 4; i++) {
        const sx = x + w * (0.22 + i * 0.19);
        g.lineStyle(3, 0x9ba7a4, 1); g.lineBetween(sx, y + h * 0.2, sx, y + h * 0.65);
        g.lineStyle(2, 0xc4af7b, 1); g.lineBetween(sx - w * 0.055, y + h * 0.65, sx + w * 0.055, y + h * 0.65);
        g.lineStyle(3, 0x5f4b40, 1); g.lineBetween(sx, y + h * 0.68, sx, y + h * 0.81);
      }
    } else if (kind === 'armor') {
      rect(0.45, 0.08, 0.1, 0.84, 0x705c42);
      rect(0.14, 0.32, 0.72, 0.21, 0x566b76);
      rect(0.28, 0.3, 0.44, 0.4, 0x87999b);
      rect(0.33, 0.72, 0.12, 0.2, 0x70858e);
      rect(0.55, 0.72, 0.12, 0.2, 0x70858e);
      rect(0.35, 0.09, 0.3, 0.19, 0xa7b3ae);
      rect(0.39, 0.16, 0.22, 0.04, 0x18232b);
      rect(0.47, 0.38, 0.06, 0.26, 0xc3bd9a);
    } else if (kind === 'chest') {
      rect(0.07, 0.12, 0.86, 0.78, 0x795d43);
      rect(0.1, 0.15, 0.8, 0.32, 0x9a7950);
      rect(0.2, 0.13, 0.08, 0.75, 0x424d50);
      rect(0.72, 0.13, 0.08, 0.75, 0x424d50);
      rect(0.1, 0.48, 0.8, 0.06, 0x342f2b);
      rect(0.44, 0.43, 0.12, 0.2, 0xc4ae73);
    } else if (kind === 'column') {
      rect(0.08, 0.08, 0.84, 0.84, 0x5c6966);
      rect(0.18, 0.18, 0.64, 0.64, 0x889086);
      rect(0.28, 0.27, 0.44, 0.46, 0x505e5e);
      rect(0.3, 0.28, 0.4, 0.04, 0xa9ad94);
    } else if (kind === 'well') {
      rect(0.05, 0.05, 0.9, 0.9, 0x78817a);
      rect(0.2, 0.2, 0.6, 0.6, 0x1c2b32);
      rect(0.28, 0.28, 0.44, 0.44, 0x34505a);
      rect(0.14, 0.09, 0.72, 0.07, 0xa2a58b);
      g.lineStyle(2, 0x4b5b5a, 1);
      g.lineBetween(cx, y + 2, cx, y + h * 0.2); g.lineBetween(cx, y + h * 0.8, cx, y + h - 2);
      g.lineBetween(x + 2, cy, x + w * 0.2, cy); g.lineBetween(x + w * 0.8, cy, x + w - 2, cy);
    } else if (kind === 'bench' || kind === 'table') {
      rect(0.08, 0.08, 0.84, 0.84, 0x70563f);
      rect(0.1, 0.12, 0.8, 0.18, 0x997752);
      rect(0.1, 0.36, 0.8, 0.18, 0x8d6c4b);
      rect(0.1, 0.6, 0.8, 0.22, 0x866747);
      if (kind === 'table') {
        rect(0.15, 0.22, 0.24, 0.4, 0xaca78c);
        rect(0.59, 0.25, 0.18, 0.35, 0x53636b);
        g.lineStyle(3, 0xb6bdaf, 1); g.lineBetween(x + w * 0.53, y + h * 0.73, x + w * 0.82, y + h * 0.39);
      }
    } else if (kind === 'banner') {
      rect(0.08, 0.07, 0.84, 0.07, 0xb1a277);
      rect(0.15, 0.16, 0.7, 0.72, 0x773f43);
      rect(0.46, 0.3, 0.08, 0.4, 0xd0b87e);
      rect(0.3, 0.43, 0.4, 0.07, 0xd0b87e);
    }
  }

  private label(x: number, y: number, text: string, color: string, size: number): Phaser.GameObjects.Text {
    return this.own(this.scene.add.text(x, y, text, {
      fontFamily: 'Georgia, serif', fontSize: `${size}px`, color,
      stroke: '#142026', strokeThickness: 3,
    }).setOrigin(0.5));
  }

  private own<T extends Phaser.GameObjects.GameObject>(object: T): T { this.objects.push(object); return object; }
}
