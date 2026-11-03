import type { CastleSession, LocationDefinition, Point, Rect } from './types';
import './style.css';

interface CastleCallbacks {
  menu: () => void;
  toggleMap: () => void;
  resume: () => void;
}

/** DOM overlay owned by one exploration scene; all coordinates on the map stay in world space. */
export class CastleHud {
  private readonly root: HTMLElement;
  private readonly map: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly hpFill: HTMLElement;
  private readonly hpValue: HTMLElement;
  private readonly hpBar: HTMLElement;
  private readonly inventory: HTMLElement;
  private readonly inventoryCount: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly message: HTMLElement;
  private readonly status: HTMLElement;
  private readonly pausePanel: HTMLElement;
  private readonly mapButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly pauseMenuButton: HTMLButtonElement;
  private mapOpen = false;
  private paused = false;
  private busy = false;
  private lastInventory = '';
  private lastHealth = '';
  private lastMapSignature = '';
  private previousFocus: HTMLElement | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly def: LocationDefinition, private readonly callbacks: CastleCallbacks) {
    const host = document.getElementById('interface');
    if (!host) throw new Error('CastleHud requires the #interface overlay.');
    this.root = document.createElement('section');
    this.root.className = 'castle-hud';
    this.root.setAttribute('aria-label', 'Исследование замка');
    this.root.innerHTML = `
      <header class="castle-heading">
        <div class="castle-location">
          <span class="castle-kicker">НАСЛЕДИЕ ПЕЧАТИ · ЗАМОК</span>
          <h1 class="castle-location-title"></h1>
          <div class="castle-health" role="progressbar" aria-label="Здоровье" aria-valuemin="0">
            <i class="castle-health-fill"></i>
          </div>
          <div class="castle-vitals"><span>ЗДОРОВЬЕ</span><b class="castle-health-value"></b></div>
          <div class="castle-inventory"><span>СНАРЯЖЕНИЕ <b class="castle-inventory-count">0</b></span><span class="castle-inventory-items">Пусто</span></div>
        </div>
        <nav class="castle-tools" aria-label="Исследование">
          <button class="castle-tool castle-map-toggle" type="button" aria-controls="castle-map" aria-expanded="false"><span aria-hidden="true">⌖</span> Карта <kbd>M</kbd></button>
          <button class="castle-tool castle-menu" type="button">В меню</button>
        </nav>
      </header>
      <div class="castle-transition" role="status" aria-live="polite" hidden>Переход…</div>
      <aside class="castle-map" id="castle-map" aria-label="Карта локации" hidden>
        <div class="castle-map-title"><span>ПЛАН ЛОКАЦИИ</span><small>M · СВЕРНУТЬ</small></div>
        <canvas width="300" height="220" role="img"></canvas>
        <div class="castle-map-legend"><span><i class="castle-key-player"></i>Вы</span><span><i class="castle-key-door"></i>Дверь</span><span><i class="castle-key-npc"></i>Житель</span></div>
      </aside>
      <div class="castle-message" role="status" aria-live="polite" hidden></div>
      <div class="castle-prompt" aria-live="polite" aria-atomic="true" hidden></div>
      <p class="castle-controls">WASD / СТРЕЛКИ — ДВИЖЕНИЕ <span>·</span> E — ВЗАИМОДЕЙСТВИЕ <span>·</span> M — КАРТА <span>·</span> ESC — ПАУЗА</p>
      <div class="castle-pause" hidden>
        <section class="castle-pause-card" role="dialog" aria-modal="true" aria-labelledby="castle-pause-title">
          <span class="castle-kicker">ТИШИНА КАМЕННЫХ СТЕН</span>
          <h2 id="castle-pause-title">Пауза</h2>
          <p>Замок подождёт вашего возвращения.</p>
          <button class="castle-resume" type="button">Продолжить</button>
          <button class="castle-pause-menu" type="button">В меню</button>
        </section>
      </div>`;
    host.replaceChildren(this.root);
    const find = <T extends HTMLElement>(selector: string) => this.root.querySelector<T>(selector)!;
    find('.castle-location-title').textContent = def.title;
    this.map = find('.castle-map');
    this.canvas = find<HTMLCanvasElement>('.castle-map canvas');
    this.canvas.setAttribute('aria-label', `${def.title}: стены, двери, жители и ваше положение`);
    this.context = this.canvas.getContext('2d');
    this.hpFill = find('.castle-health-fill');
    this.hpBar = find('.castle-health');
    this.hpValue = find('.castle-health-value');
    this.inventory = find('.castle-inventory-items');
    this.inventoryCount = find('.castle-inventory-count');
    this.prompt = find('.castle-prompt');
    this.message = find('.castle-message');
    this.status = find('.castle-transition');
    this.pausePanel = find('.castle-pause');
    this.mapButton = find<HTMLButtonElement>('.castle-map-toggle');
    this.menuButton = find<HTMLButtonElement>('.castle-menu');
    this.resumeButton = find<HTMLButtonElement>('.castle-resume');
    this.pauseMenuButton = find<HTMLButtonElement>('.castle-pause-menu');
    this.bind(this.mapButton, () => { if (!this.busy && !this.paused) callbacks.toggleMap(); });
    this.bind(this.menuButton, () => { if (!this.busy) callbacks.menu(); });
    this.bind(this.resumeButton, () => { if (!this.busy) callbacks.resume(); });
    this.bind(this.pauseMenuButton, () => { if (!this.busy) callbacks.menu(); });
  }

  private bind(button: HTMLButtonElement, action: () => void): void {
    const listener = (event: MouseEvent) => { event.stopPropagation(); action(); };
    button.addEventListener('click', listener);
    this.cleanups.push(() => button.removeEventListener('click', listener));
  }

  update(player: Point, session: CastleSession, prompt: string, busy: boolean, camera?: Rect): void {
    if (busy !== this.busy) {
      this.busy = busy;
      this.root.classList.toggle('castle-is-busy', busy);
      this.status.hidden = !busy;
      this.updateButtons();
    }
    const max = Math.max(1, session.maxHealth);
    const health = Math.max(0, Math.min(max, session.health));
    const healthKey = `${health}/${max}`;
    if (healthKey !== this.lastHealth) {
      this.lastHealth = healthKey;
      this.hpValue.textContent = `${Math.ceil(health)} / ${Math.ceil(max)}`;
      this.hpFill.style.width = `${health / max * 100}%`;
      this.hpBar.setAttribute('aria-valuemax', String(max));
      this.hpBar.setAttribute('aria-valuenow', String(health));
    }
    const inventoryKey = JSON.stringify(session.inventory);
    if (inventoryKey !== this.lastInventory) {
      this.lastInventory = inventoryKey;
      this.inventoryCount.textContent = String(session.inventory.length);
      const names = session.inventory.join(' · ');
      this.inventory.textContent = names || 'Пусто';
      this.inventory.title = names || 'Снаряжение отсутствует';
    }
    const text = busy ? '' : prompt;
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
    this.prompt.hidden = !text;
    if (this.mapOpen) {
      // Redraw on actual movement, camera change, or location creation; the map never pauses play.
      const signature = `${Math.round(player.x)},${Math.round(player.y)},${camera ? [camera.x, camera.y, camera.width, camera.height].map(Math.round).join(',') : ''}`;
      if (signature !== this.lastMapSignature) {
        this.lastMapSignature = signature;
        this.drawMap(player, camera);
      }
    }
  }

  setMapOpen(open: boolean): void {
    this.mapOpen = open;
    this.map.hidden = !open;
    this.mapButton.setAttribute('aria-expanded', String(open));
    this.mapButton.classList.toggle('castle-selected', open);
    this.lastMapSignature = '';
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.pausePanel.hidden = !paused;
    this.root.classList.toggle('castle-is-paused', paused);
    this.updateButtons();
    if (paused) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.resumeButton.focus({ preventScroll: true });
    } else {
      if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
      this.previousFocus = null;
    }
  }

  setMessage(text: string | null): void {
    this.message.textContent = text || '';
    this.message.hidden = !text;
  }

  private updateButtons(): void {
    this.mapButton.disabled = this.busy || this.paused;
    this.menuButton.disabled = this.busy || this.paused;
    this.resumeButton.disabled = this.busy;
    this.pauseMenuButton.disabled = this.busy;
  }

  private drawMap(player: Point, camera?: Rect): void {
    const ctx = this.context;
    if (!ctx) return;
    const { width, height } = this.canvas;
    const padding = 12;
    const scale = Math.min((width - padding * 2) / this.def.width, (height - padding * 2) / this.def.height);
    const left = (width - this.def.width * scale) / 2;
    const top = (height - this.def.height * scale) / 2;
    const rect = (shape: Rect, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(left + shape.x * scale, top + shape.y * scale, Math.max(1, shape.width * scale), Math.max(1, shape.height * scale));
    };
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a1317'; ctx.fillRect(0, 0, width, height);
    rect({ x: 0, y: 0, width: this.def.width, height: this.def.height }, '#243035');
    ctx.strokeStyle = '#344247'; ctx.lineWidth = .6;
    for (let x = 128; x < this.def.width; x += 128) {
      ctx.beginPath(); ctx.moveTo(left + x * scale, top); ctx.lineTo(left + x * scale, top + this.def.height * scale); ctx.stroke();
    }
    for (let y = 128; y < this.def.height; y += 128) {
      ctx.beginPath(); ctx.moveTo(left, top + y * scale); ctx.lineTo(left + this.def.width * scale, top + y * scale); ctx.stroke();
    }
    this.def.walls.forEach(wall => rect(wall, '#7a827c'));
    this.def.props.filter(prop => prop.solid).forEach(prop => rect(prop, '#66716c'));
    this.def.doors.forEach(door => {
      rect(door, '#d3b676');
      ctx.strokeStyle = '#f4dca5'; ctx.lineWidth = 1;
      ctx.strokeRect(left + door.x * scale, top + door.y * scale, Math.max(2, door.width * scale), Math.max(2, door.height * scale));
    });
    if (camera) {
      const x = Math.max(0, camera.x), y = Math.max(0, camera.y);
      const w = Math.min(this.def.width - x, camera.width), h = Math.min(this.def.height - y, camera.height);
      ctx.strokeStyle = '#b5c2ba77'; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(left + x * scale, top + y * scale, w * scale, h * scale);
      ctx.setLineDash([]);
    }
    if (this.def.npc) this.marker(ctx, left + this.def.npc.x * scale, top + this.def.npc.y * scale, '#83bdc9', 3);
    this.marker(ctx, left + player.x * scale, top + player.y * scale, '#f2e6bb', 4);
  }

  private marker(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, radius: number): void {
    ctx.fillStyle = '#081014'; ctx.fillRect(Math.round(x) - radius - 1, Math.round(y) - radius - 1, radius * 2 + 3, radius * 2 + 3);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x, y - radius); ctx.lineTo(x + radius, y); ctx.lineTo(x, y + radius); ctx.lineTo(x - radius, y); ctx.closePath(); ctx.fill();
  }

  destroy(): void {
    this.cleanups.forEach(cleanup => cleanup());
    this.cleanups.length = 0;
    this.root.remove();
  }
}
