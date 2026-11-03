import type Phaser from 'phaser';

export interface GameInput {
  x: number;
  y: number;
  aimX?: number;
  aimY?: number;
  attack: boolean;
  dodge: boolean;
  dragon: boolean;
  seal: boolean;
}

export interface InputOptions { mode?: 'combat' | 'exploration' }

type Action = 'dodge' | 'dragon' | 'seal' | 'interact' | 'map' | 'pause';

/** Keyboard, cursor aim, and real multi-touch controls share the same input state. */
export class Input {
  private scene: Phaser.Scene;
  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private attackQueue = 0;
  private heldAttack = false;
  private attackPointers = new Set<number>();
  private mouseAim?: { x: number; y: number };
  private stick = { x: 0, y: 0 };
  private stickPointer: number | null = null;
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private listeners: (() => void)[] = [];
  private active = true;

  constructor(scene: Phaser.Scene, options: InputOptions = {}) {
    this.scene = scene;
    // Scene restarts should not leave old touch controls on screen.
    document.getElementById('touch-controls')?.remove();
    this.root = document.createElement('div');
    this.root.id = 'touch-controls';
    this.root.dataset.mode = options.mode ?? 'combat';
    this.root.setAttribute('aria-label', 'Сенсорное управление');
    this.root.innerHTML = `
      <div class="touch-stick" aria-label="Движение"><span class="touch-stick-cross">✥</span><i></i></div>
      <div class="touch-actions">
        <button class="touch-button touch-dragon" data-action="dragon" aria-label="Драконья волна">♨<small>ДРАКОН</small></button>
        <button class="touch-button touch-seal" data-action="seal" aria-label="Совместная атака печати">✧<small>ПЕЧАТЬ</small></button>
        <button class="touch-button touch-dodge" data-action="dodge" aria-label="Уклонение">»<small>РЫВОК</small></button>
        <button class="touch-button touch-attack" data-action="attack" aria-label="Удар мечом">†<small>УДАР</small></button>
      </div>
      <button class="touch-interact" data-action="interact" aria-label="Взаимодействовать">◇ <span>Войти / далее</span></button>
      <button class="touch-map" data-action="map" aria-label="Карта">M<small>КАРТА</small></button>
      <button class="touch-pause" data-action="pause" aria-label="Пауза">II</button>`;
    if (options.mode === 'exploration') {
      this.root.querySelector('.touch-interact')!.innerHTML = 'E<span>Взаимодействовать</span>';
    }
    this.style = document.createElement('style');
    this.style.textContent = `
      #touch-controls{display:none;position:fixed;inset:0;z-index:20;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none}
      #touch-controls[hidden]{display:none!important}
      #touch-controls button{font-family:Georgia,serif;touch-action:none;-webkit-tap-highlight-color:transparent;cursor:pointer;outline:none}
      #touch-controls .touch-stick{position:absolute;left:max(24px,env(safe-area-inset-left));bottom:max(24px,env(safe-area-inset-bottom));width:116px;height:116px;border-radius:50%;border:1px solid #9987668c;background:radial-gradient(circle,#252a2dc9,#131b21a1);pointer-events:auto;box-shadow:0 0 0 5px #0a101352,inset 0 0 20px #050a0c80}
      #touch-controls .touch-stick-cross{position:absolute;inset:0;display:grid;place-items:center;color:#c3b28a59;font:58px Georgia}
      #touch-controls .touch-stick i{position:absolute;left:35px;top:35px;width:44px;height:44px;border:1px solid #b6a584ab;border-radius:50%;background:#495357ba;box-shadow:0 2px 10px #0009;will-change:transform;pointer-events:none}
      #touch-controls .touch-actions{position:absolute;right:max(20px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));width:164px;height:164px;pointer-events:none}
      #touch-controls .touch-button{position:absolute;width:66px;height:66px;border-radius:50%;border:1px solid #a08c668c;background:#161d22d9;color:#ded4ba;pointer-events:auto;font-size:31px;box-shadow:inset 0 0 15px #0009,0 2px 10px #0008;line-height:1}
      #touch-controls .touch-button small{display:block;font:8px system-ui,sans-serif;letter-spacing:1px;margin-top:3px}
      #touch-controls .touch-button:active,#touch-controls .touch-button.active{background:#555045e8;border-color:#ffe4a2}
      #touch-controls .touch-dragon{left:0;top:0;color:#ee936f;border-color:#af5e4d}
      #touch-controls .touch-seal{right:0;top:12px;color:#bce0de;border-color:#9d9565}
      #touch-controls .touch-dodge{left:0;bottom:5px}
      #touch-controls .touch-attack{right:0;bottom:0;width:77px;height:77px;font-size:40px}
      #touch-controls .touch-interact{position:absolute;left:50%;transform:translateX(-50%);bottom:max(20px,env(safe-area-inset-bottom));border:1px solid #a4966d94;background:#171e23dc;color:#d2c8a9;padding:10px 14px;pointer-events:auto;font-size:22px}
      #touch-controls .touch-interact span{font:10px system-ui,sans-serif;letter-spacing:1px;vertical-align:middle}
      #touch-controls .touch-map{display:none;position:absolute;border:1px solid #9d976b99;background:#171e23dc;color:#d8c99f;pointer-events:auto;width:62px;height:58px;font-size:23px}
      #touch-controls .touch-map small{display:block;font:9px system-ui,sans-serif;letter-spacing:1px;margin-top:3px}
      #touch-controls .touch-map:active,#touch-controls .touch-map.active,#touch-controls .touch-interact:active,#touch-controls .touch-interact.active{background:#555045e8;border-color:#ffe4a2}
      #touch-controls .touch-pause{position:absolute;right:max(16px,env(safe-area-inset-right));top:max(16px,env(safe-area-inset-top));border:1px solid #a4966d80;background:#10181dbb;color:#ddd1ac;width:38px;height:38px;font-size:20px;pointer-events:auto}
      @media(pointer:coarse),(max-width:900px){#touch-controls{display:block}}
      @media(max-height:450px){#touch-controls .touch-stick{width:94px;height:94px;left:max(18px,env(safe-area-inset-left));bottom:18px}#touch-controls .touch-stick i{left:24px;top:24px}#touch-controls .touch-actions{transform:scale(.82);transform-origin:bottom right;bottom:14px}#touch-controls .touch-interact{bottom:14px;padding:6px 10px}}
      @media(orientation:portrait){#touch-controls .touch-stick{left:18px;bottom:max(24px,env(safe-area-inset-bottom))}#touch-controls .touch-actions{right:12px;transform:scale(.85);transform-origin:bottom right}#touch-controls .touch-interact{bottom:170px}}
      #touch-controls[data-mode="exploration"] .touch-actions{display:none}
      #touch-controls[data-mode="exploration"] .touch-interact{left:auto;right:max(24px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));transform:none;width:116px;min-height:82px;padding:10px 6px;border-radius:14px;font-size:32px}
      #touch-controls[data-mode="exploration"] .touch-interact span{display:block;margin-top:5px;font:10px system-ui,sans-serif;letter-spacing:.1px}
      #touch-controls[data-mode="exploration"] .touch-map{display:block;right:max(50px,env(safe-area-inset-right));bottom:max(124px,calc(env(safe-area-inset-bottom) + 100px));border-radius:9px}
    `;
    document.head.append(this.style);
    document.body.append(this.root);

    this.listen(window, 'keydown', (raw) => {
      const event = raw as KeyboardEvent;
      if (event.code === 'Escape') {
        if (!event.repeat) this.pressed.add('pause');
        return;
      }
      if (!this.active || this.isTextEntry(event.target)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      // Moving with keys returns facing to the keyboard unless the player is
      // deliberately holding the mouse attack; moving the cursor aims again.
      if (!this.heldAttack && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        this.mouseAim = undefined;
      }
      if (!this.keys.has(event.code)) {
        if (event.code === 'KeyJ' && !event.repeat) this.attackQueue++;
        const action = this.keyAction(event.code);
        // A held interaction must not activate again after a scene transition,
        // when this fresh Input has not yet seen the original keydown.
        if (action && !event.repeat) this.pressed.add(action);
      }
      this.keys.add(event.code);
    });
    this.listen(window, 'keyup', (raw) => this.keys.delete((raw as KeyboardEvent).code));
    this.listen(window, 'blur', () => this.clear());
    this.listen(document, 'visibilitychange', () => { if (document.hidden) this.clear(); });

    const canvas = scene.game.canvas;
    this.listen(canvas, 'pointermove', (raw) => {
      const event = raw as PointerEvent;
      if (event.pointerType === 'mouse' && this.active) this.mouseAim = { x: event.clientX, y: event.clientY };
    });
    this.listen(canvas, 'pointerdown', (raw) => {
      const event = raw as PointerEvent;
      if (!this.active || event.pointerType !== 'mouse' || event.button !== 0) return;
      event.preventDefault();
      this.mouseAim = { x: event.clientX, y: event.clientY };
      if (!this.heldAttack) this.attackQueue++;
      this.heldAttack = true;
    });
    this.listen(window, 'pointerup', (raw) => {
      const event = raw as PointerEvent;
      if (event.pointerType === 'mouse' && event.button === 0) this.heldAttack = false;
    });
    this.listen(window, 'pointercancel', (raw) => {
      if ((raw as PointerEvent).pointerType === 'mouse') this.heldAttack = false;
    });
    this.listen(canvas, 'contextmenu', (event) => event.preventDefault());

    const stick = this.root.querySelector<HTMLElement>('.touch-stick')!;
    const knob = stick.querySelector<HTMLElement>('i')!;
    const moveStick = (event: PointerEvent) => {
      const bounds = stick.getBoundingClientRect();
      const max = bounds.width * 0.32;
      let x = event.clientX - (bounds.left + bounds.width / 2);
      let y = event.clientY - (bounds.top + bounds.height / 2);
      const length = Math.hypot(x, y);
      if (length > max) { x *= max / length; y *= max / length; }
      this.stick = { x: x / max, y: y / max };
      this.mouseAim = undefined;
      knob.style.transform = `translate(${x}px,${y}px)`;
    };
    this.listen(stick, 'pointerdown', (raw) => {
      const event = raw as PointerEvent;
      if (!this.active || this.stickPointer !== null) return;
      event.preventDefault();
      this.stickPointer = event.pointerId;
      stick.setPointerCapture(event.pointerId);
      moveStick(event);
    });
    this.listen(stick, 'pointermove', (raw) => {
      const event = raw as PointerEvent;
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      moveStick(event);
    });
    const releaseStick = (raw: Event) => {
      if ((raw as PointerEvent).pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.stick = { x: 0, y: 0 };
      knob.style.transform = '';
    };
    this.listen(stick, 'pointerup', releaseStick);
    this.listen(stick, 'pointercancel', releaseStick);
    this.listen(stick, 'lostpointercapture', releaseStick);

    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      this.listen(button, 'pointerdown', (raw) => {
        const event = raw as PointerEvent;
        if (!this.active) return;
        event.preventDefault();
        event.stopPropagation();
        this.mouseAim = undefined;
        button.setPointerCapture(event.pointerId);
        button.classList.add('active');
        const action = button.dataset.action!;
        if (action === 'attack') {
          if (!this.attackPointers.has(event.pointerId)) {
            this.attackPointers.add(event.pointerId);
            this.attackQueue++;
          }
        }
        else this.pressed.add(action as Action);
      });
      const release = (event: Event) => {
        event.preventDefault();
        button.classList.remove('active');
        if (button.dataset.action === 'attack') this.attackPointers.delete((event as PointerEvent).pointerId);
      };
      this.listen(button, 'pointerup', release);
      this.listen(button, 'pointercancel', release);
      this.listen(button, 'lostpointercapture', release);
    }
  }

  get enabled(): boolean { return this.active; }
  set enabled(value: boolean) {
    this.active = value;
    this.root.hidden = !value;
    if (!value) this.clear();
  }

  sample(): GameInput {
    if (!this.active) return { x: 0, y: 0, attack: false, dodge: false, dragon: false, seal: false };
    const has = (...keys: string[]) => keys.some((key) => this.keys.has(key));
    let x = Number(has('KeyD', 'ArrowRight')) - Number(has('KeyA', 'ArrowLeft')) + this.stick.x;
    let y = Number(has('KeyS', 'ArrowDown')) - Number(has('KeyW', 'ArrowUp')) + this.stick.y;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    if (Math.hypot(x, y) < 0.12) { x = 0; y = 0; }
    const input: GameInput = {
      x, y,
      attack: this.consumeAttack(),
      dodge: this.consume('dodge'),
      dragon: this.consume('dragon'),
      seal: this.consume('seal'),
    };
    if (this.mouseAim) {
      const canvas = this.scene.game.canvas;
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const point = this.scene.cameras.main.getWorldPoint(
          (this.mouseAim.x - rect.left) * this.scene.scale.width / rect.width,
          (this.mouseAim.y - rect.top) * this.scene.scale.height / rect.height,
        );
        input.aimX = point.x;
        input.aimY = point.y;
      }
    }
    return input;
  }

  consumeInteract(): boolean { return this.consume('interact'); }
  consumeMap(): boolean { return this.consume('map'); }
  consumePause(): boolean { return this.consume('pause'); }

  clear(): void {
    this.keys.clear();
    this.pressed.clear();
    this.attackQueue = 0;
    this.heldAttack = false;
    this.attackPointers.clear();
    this.mouseAim = undefined;
    this.stick = { x: 0, y: 0 };
    this.stickPointer = null;
    this.root.querySelector<HTMLElement>('.touch-stick i')?.style.removeProperty('transform');
    this.root.querySelectorAll('.active').forEach((button) => button.classList.remove('active'));
  }

  destroy(): void {
    this.clear();
    this.listeners.forEach((remove) => remove());
    this.listeners.length = 0;
    this.root.remove();
    this.style.remove();
  }

  private consume(action: Action): boolean {
    const result = this.pressed.has(action);
    this.pressed.delete(action);
    return result;
  }

  /** One press is one pulse; rapid clicks are retained until separately sampled. */
  private consumeAttack(): boolean {
    if (this.attackQueue <= 0) return false;
    this.attackQueue--;
    return true;
  }

  private keyAction(code: string): Action | null {
    if (code === 'Space') return 'dodge';
    if (code === 'KeyK' || code === 'KeyQ') return 'dragon';
    if (code === 'KeyL' || code === 'KeyR') return 'seal';
    if (code === 'KeyE' || code === 'Enter') return 'interact';
    if (code === 'KeyM') return 'map';
    return null;
  }

  private isTextEntry(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
  }

  private listen(target: EventTarget, event: string, listener: (event: Event) => void): void {
    target.addEventListener(event, listener, { passive: false });
    this.listeners.push(() => target.removeEventListener(event, listener));
  }
}

export default Input;
