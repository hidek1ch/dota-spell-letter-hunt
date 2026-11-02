import Phaser from 'phaser';
import { generateArt } from '../art/generate';
import { CombatWorld } from '../game/combat';
import { BALANCE, type Difficulty } from '../game/balance';
import type { Actor, Outcome } from '../game/model';
import { Input } from '../systems/Input';
import { audio } from '../systems/Audio';
import { WorldView } from './WorldView';

type Mode = 'menu' | 'training' | 'intro' | 'boss' | 'ending' | 'epilogue' | 'result';
interface Preferences { difficulty: Difficulty; demo: boolean; muted: boolean; volume: number }
const DIRECTION = (actor: Actor, x: number, y: number) => { actor.facing = Math.atan2(y - actor.y, x - actor.x); };
const lerp = (a: number, b: number, f: number) => a + (b - a) * Phaser.Math.Clamp(f, 0, 1);
const difficultyLabel = { story: 'ИСТОРИЯ', normal: 'РЫЦАРЬ', hard: 'ПЕПЕЛ' } as const;
const clock = (value: number) => `${Math.floor(Math.max(0, value) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, value) % 60).toString().padStart(2, '0')}`;

export class GameScene extends Phaser.Scene {
  private view!: WorldView;
  private controls!: Input;
  private ui!: HTMLElement;
  private cine!: Phaser.GameObjects.Graphics;
  private world!: CombatWorld;
  private mode: Mode = 'menu';
  private paused = false;
  private prefs: Preferences = { difficulty: 'normal', demo: false, muted: false, volume: 0.45 };
  private cinemaTime = 0;
  private cinemaActors: Actor[] = [];
  private ending: Exclude<Outcome, null> = 'victory';
  private captionIndex = -1;
  private pulseIndex = -1;
  private souls: Phaser.GameObjects.Image[] = [];
  private pendant?: Phaser.GameObjects.Image;
  private notificationTime = 0;
  private hudClock = 0;
  private moved = 0;
  private stepDistance = 0;
  private epilogueTime = 0;
  private gateReadyFor = 0;
  private visibleHandler = () => { if (document.hidden && ['training', 'boss', 'epilogue'].includes(this.mode) && !this.paused) this.togglePause(); };

  constructor() { super('Game'); }

  create() {
    generateArt(this);
    this.ui = document.getElementById('interface')!;
    try {
      const stored = JSON.parse(localStorage.getItem('seal-preferences') || '{}');
      if (['story', 'normal', 'hard'].includes(stored.difficulty)) this.prefs.difficulty = stored.difficulty;
      if (typeof stored.demo === 'boolean') this.prefs.demo = stored.demo;
      if (typeof stored.muted === 'boolean') this.prefs.muted = stored.muted;
      if (Number.isFinite(stored.volume)) this.prefs.volume = Phaser.Math.Clamp(stored.volume, 0, 1);
    } catch { /* Storage may be unavailable in private mode. */ }
    audio.setMuted(this.prefs.muted);
    audio.setVolume(this.prefs.volume);
    this.view = new WorldView(this);
    this.controls = new Input(this);
    this.cine = this.add.graphics().setDepth(7000);
    document.addEventListener('visibilitychange', this.visibleHandler);
    this.scale.on('resize', () => this.resizeShell());
    this.events.once('shutdown', () => { this.controls.destroy(); this.view.destroy(); document.removeEventListener('visibilitychange', this.visibleHandler); });
    this.showMenu();
    this.resizeShell();
    // Opt-in development harness. No test shortcuts are active in a normal game.
    if (new URLSearchParams(location.search).get('test') === '1') {
      (window as unknown as { __seal: unknown }).__seal = {
        snapshot: () => ({ ...this.world.serialize(), combatMode: this.world.mode, mode: this.mode, paused: this.paused, difficulty: this.prefs.difficulty, demo: this.prefs.demo, gateOpen: this.mode === 'training' && this.world.trainingComplete, cinemaActors: this.cinemaActors.map(actor => ({ kind: actor.kind, x: actor.x, y: actor.y, state: actor.state })) }),
        world: () => this.world,
        beginBoss: () => this.startBoss(),
        startTraining: () => this.startTraining(),
        advance: (seconds: number) => {
          for (let t = 0; t < seconds; t += 1 / 60) this.update(performance.now(), 1000 / 60);
        },
        setOutcome: (outcome: 'health' | 'timeout' | 'ally') => {
          if (outcome === 'timeout') this.world.timeLeft = 0.001;
          else if (outcome === 'health') this.world.player.hp = 0;
          else this.world.ally.hp = 0;
        },
      };
    }
  }

  private resizeShell() { this.game.canvas.setAttribute('aria-label', 'Наследие печати — игровая арена'); }
  private savePrefs() {
    try { localStorage.setItem('seal-preferences', JSON.stringify(this.prefs)); } catch { /* No storage required. */ }
    audio.setMuted(this.prefs.muted); audio.setVolume(this.prefs.volume);
  }
  private click(id: string, action: () => void) {
    this.ui.querySelector<HTMLButtonElement>(`#${id}`)?.addEventListener('click', () => {
      void audio.unlock(); audio.play('click'); action();
    });
  }
  private cleanCinematic() {
    this.cine.clear(); this.souls.forEach(soul => soul.destroy()); this.souls = [];
    this.pendant?.destroy(); this.pendant = undefined;
    this.cameras.main.resetFX();
  }
  private buttonTools() {
    return `<div class="top-tools"><button class="icon-button" id="sound" aria-label="Переключить звук" title="Звук">${this.prefs.muted ? '♪ ×' : '♪'}</button><button class="icon-button" id="fullscreen" aria-label="Полный экран" title="Полный экран">⛶</button><button class="icon-button" id="pause" aria-label="Пауза" title="Пауза · Esc">II</button></div>`;
  }
  private bindTools() {
    this.click('sound', () => {
      this.prefs.muted = !this.prefs.muted; this.savePrefs();
      const button = this.ui.querySelector('#sound'); if (button) button.textContent = this.prefs.muted ? '♪ ×' : '♪';
    });
    this.click('fullscreen', () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => this.notify('На этом устройстве используйте полноэкранный режим браузера.'));
      else this.notify('Добавьте игру на экран «Домой» для полноэкранного режима.');
    });
    this.click('pause', () => this.togglePause());
  }

  private showMenu() {
    this.mode = 'menu'; this.paused = false; this.controls.enabled = false;
    this.cleanCinematic(); this.view.build('menu');
    this.world = new CombatWorld('boss', this.prefs);
    const demon = { ...this.world.boss!, x: 715, y: 333, facing: Math.PI / 2, state: 'Idle' as const };
    const hero = { ...this.world.player, x: 668, y: 440, facing: -Math.PI / 2, state: 'Idle' as const };
    const ally = { ...this.world.ally, x: 759, y: 433, facing: -Math.PI / 2, state: 'Idle' as const };
    this.cinemaActors = [demon, hero, ally];
    this.ui.innerHTML = `<section class="screen" aria-label="Главное меню">
      <div class="brand-line"><div class="brand"><span class="brand-mark">⟐</span><span class="eyebrow">АОЕ · ИСТОРИИ ПЕПЛА</span></div><span class="eyebrow quiet">ИГРАБЕЛЬНЫЙ ПРОЛОГ / 01</span></div>
      <div class="menu-main"><div class="eyebrow">ДВА РОДА. ОДНА ПОСЛЕДНЯЯ КЛЯТВА.</div><h1>НАСЛЕДИЕ<br><span>ПЕЧАТИ</span></h1><div class="rule"></div>
      <p class="lede">Нас учили ненавидеть друг друга.<br>Теперь лишь доверие удержит тьму.</p>
      <div class="menu-actions"><button id="start" class="button primary">Начать путь <span>→</span></button><button id="controls" class="button ghost">Управление</button><button id="boss-start" class="button ghost">Сразу к печати →</button></div>
      <div class="menu-options"><label>Защита печати<select id="timer"><option value="canonical" ${!this.prefs.demo ? 'selected' : ''}>15:00 · бой с демоном</option><option value="demo" ${this.prefs.demo ? 'selected' : ''}>2:30 · бой с демоном · демо</option></select></label><label>Испытание<select id="difficulty"><option value="story" ${this.prefs.difficulty === 'story' ? 'selected' : ''}>История · мягче</option><option value="normal" ${this.prefs.difficulty === 'normal' ? 'selected' : ''}>Рыцарь · обычное</option><option value="hard" ${this.prefs.difficulty === 'hard' ? 'selected' : ''}>Пепел · сложнее</option></select></label></div><p class="menu-stage-note">Два врага во дворе — обучение. Выбранный таймер и кольцо включатся после входа в печать.</p></div>
      <aside class="chapter-card"><div class="eyebrow">СЕРДЦЕ СВЯТИЛИЩА</div><h3>То, что заперто,<br>помнит наши имена.</h3><p>Пройдите через руины.<br>Откройте кольцо хранителя.<br>Разорвите Кровавый Завет.</p><div class="eyebrow">⟡ ОДИНОЧНАЯ ИСТОРИЯ</div></aside>
      <footer class="menu-footer"><p>TOP-DOWN ACTION · DARK FANTASY<br>ОРИГИНАЛЬНЫЙ 2D-ПРОТОТИП</p><div class="top-tools"><button class="icon-button" id="sound" aria-label="Переключить звук">${this.prefs.muted ? '♪ ×' : '♪'}</button><button class="icon-button" id="settings" aria-label="Громкость">⚙</button><button class="icon-button" id="fullscreen" aria-label="Полный экран">⛶</button></div><p>МЕЧ СВЯЗЫВАЕТ СУДЬБЫ.<br>ВЫБОР РАЗРЫВАЕТ ЦЕПИ.</p></footer>
    </section><div class="portrait-warning">Поверните телефон горизонтально.<br>Так лучше видны арена и сенсорное управление.</div>`;
    this.click('start', () => this.startTraining());
    this.click('boss-start', () => this.beginCinema('intro'));
    this.click('controls', () => this.showControls());
    this.click('settings', () => this.showSettings());
    this.bindTools();
    this.ui.querySelector<HTMLSelectElement>('#timer')!.onchange = (event) => {
      this.prefs.demo = (event.target as HTMLSelectElement).value === 'demo'; this.savePrefs();
    };
    this.ui.querySelector<HTMLSelectElement>('#difficulty')!.onchange = (event) => {
      this.prefs.difficulty = (event.target as HTMLSelectElement).value as Difficulty; this.savePrefs();
    };
  }

  private modal(html: string) {
    this.ui.querySelector('.modal-wrap')?.remove();
    const root = document.createElement('div'); root.className = 'modal-wrap';
    root.innerHTML = `<section class="modal" role="dialog" aria-modal="true">${html}</section>`;
    this.ui.append(root);
    return root;
  }
  private showControls() {
    const previous = this.ui.querySelector('.modal-wrap');
    const root = this.modal(`<div class="eyebrow">ЗНАНИЕ — ПЕРВАЯ ЗАЩИТА</div><h2>Искусство боя</h2><div class="control-grid">
    <div>Движение<kbd>WASD / ↑↓←→</kbd></div><div>Меч · один удар за нажатие<kbd>J / ЛКМ</kbd></div>
    <div>Рывок · неуязвимость<kbd>Пробел</kbd></div><div>Драконья волна<kbd>Q / K</kbd></div>
    <div>Совместная печать<kbd>L / R</kbd></div><div>Взаимодействие<kbd>E / Enter</kbd></div>
    <div>Пауза<kbd>Esc</kbd></div><div>Направление удара<kbd>Курсор / движение</kbd></div></div>
    <p>Одно нажатие ЛКМ, J или сенсорной кнопки — один удар. Три последовательных нажатия дают комбо 1 → 2 → 3; после паузы комбо начинается заново. Удержание не повторяет удары. Уйдите от красного телеграфа или пройдите сквозь удар рывком. Драконья сила расходует восстанавливающийся ресурс. Кольцо откроется в сцене после арки с согласия живого хранителя. Во дворе оно ещё заблокировано. Таймер начинает отсчёт только в бою с демоном.</p>
    <p>На телефоне: стик слева, меч и три приёма справа; ◇ — взаимодействие. Играйте горизонтально. Направление атаки задаёт стик.</p><button id="close-controls" class="button primary">Понятно</button>`);
    this.click('close-controls', () => { root.remove(); if (previous) this.ui.append(previous); });
  }
  private showSettings() {
    const root = this.modal(`<div class="eyebrow">НАСТРОЙКИ</div><h2>Голос святилища</h2><label class="setting-row">Громкость<input id="volume" type="range" min="0" max="1" step="0.05" value="${this.prefs.volume}" /></label><p>Все звуки синтезируются в игре. Для включения звука браузеру требуется ваше нажатие.</p><div class="menu-actions"><button id="toggle-mute" class="button ghost">${this.prefs.muted ? 'Включить звук' : 'Выключить звук'}</button><button id="close-settings" class="button primary">Готово</button></div>`);
    this.ui.querySelector<HTMLInputElement>('#volume')!.oninput = (event) => { this.prefs.volume = Number((event.target as HTMLInputElement).value); this.savePrefs(); };
    this.click('toggle-mute', () => { this.prefs.muted = !this.prefs.muted; this.savePrefs(); this.ui.querySelector('#toggle-mute')!.textContent = this.prefs.muted ? 'Включить звук' : 'Выключить звук'; });
    this.click('close-settings', () => root.remove());
  }

  private startTraining() {
    this.cleanCinematic(); this.mode = 'training'; this.paused = false; this.moved = 0; this.gateReadyFor = 0;
    this.world = new CombatWorld('training', this.prefs); this.view.build('training');
    this.controls.enabled = true; this.renderHud();
    this.notify('Этап 1/2: обучение. После двух врагов — арка, кольцо и бой с демоном.', 5);
  }
  private startBoss() {
    this.cleanCinematic(); this.mode = 'boss'; this.paused = false;
    this.world = new CombatWorld('boss', this.prefs); this.view.build('boss');
    this.controls.enabled = true; this.renderHud();
    this.notify('Хранитель открыл кольцо. Вы — проводник, а не новый хранитель.');
  }
  private renderHud() {
    const training = this.mode === 'training';
    this.ui.innerHTML = `<section class="hud" aria-label="Состояние боя"><div class="hud-top">
      <div class="player-panel"><div class="player-title">⟐ Безымянный <small>НАСЛЕДНИК ЗАВЕТА</small></div><div class="bar"><i id="hero-hp"></i></div><div class="vitals"><span id="hero-value"></span><span>ЖИЗНЬ</span></div><div class="bar energy"><i id="energy"></i></div><div class="bar ally"><i id="ally-hp"></i></div><div id="link" class="link"></div></div>
      <div class="time-panel" id="time-panel"><small>${training ? 'ЭТАП 1/2 · ОБУЧЕНИЕ' : this.prefs.demo ? 'ЭТАП 2/2 · ДЕМО' : 'ЭТАП 2/2 · ЗАЩИТА ПЕЧАТИ'}</small><b id="timer-value">${clock(this.world.timeLeft)}</b><small id="seal-status">${training ? 'СТАРТ ОТСЧЁТА — У ДЕМОНА' : 'ЦЕЛОСТНОСТЬ 100%'}</small><span class="difficulty-label">${difficultyLabel[this.prefs.difficulty]}</span></div>${this.buttonTools()}</div>
      ${!training ? '<div class="boss-panel"><div class="boss-name">МОРВЕЙН · ЗАКЛЮЧЁННЫЙ</div><div class="bar"><i id="boss-hp"></i></div><div class="boss-phase" id="boss-phase"></div></div>' : ''}
      <div class="objective" id="objective"><strong id="objective-title"></strong><p id="objective-text"></p>${training ? '<div class="training-badges"><span id="lesson-move">ДВИЖЕНИЕ</span><span id="lesson-sword">МЕЧ</span><span id="lesson-dodge">РЫВОК</span><span id="lesson-magic">ДРАКОН</span></div>' : ''}</div>
      <div class="bottom-hint">WASD ДВИЖЕНИЕ · J МЕЧ · SPACE РЫВОК · Q ДРАКОН · L ПЕЧАТЬ · ESC ПАУЗА</div>
      <div class="actionbar"><div class="ability" title="Одно нажатие — один удар"><em>†</em><small>J · МЕЧ</small></div><div class="ability"><em>»</em><small>SPACE</small><div class="cool" id="dodge-cool"></div></div><div class="ability"><em style="color:#df987b">♨</em><small>Q · ДРАКОН</small><div class="cool" id="dragon-cool"></div></div><div class="ability" id="seal-ability"><em style="color:#d9c18a">✧</em><small>L · ПЕЧАТЬ</small><div class="cool" id="seal-cool"></div></div></div>
      <div class="notification" id="notification"></div></section>`;
    this.bindTools(); this.updateHud();
  }
  private setText(id: string, value: string) { const el = this.ui.querySelector<HTMLElement>(`#${id}`); if (el && el.textContent !== value) el.textContent = value; }
  private setBar(id: string, value: number) { const el = this.ui.querySelector<HTMLElement>(`#${id}`); if (el) el.style.width = `${Phaser.Math.Clamp(value * 100, 0, 100)}%`; }
  private updateHud() {
    const p = this.world.player, a = this.world.ally;
    this.setBar('hero-hp', p.hp / p.maxHp); this.setBar('energy', p.energy / p.maxEnergy); this.setBar('ally-hp', a.hp / a.maxHp);
    this.setText('hero-value', `${Math.ceil(p.hp)} / ${p.maxHp}`);
    this.setText('link', this.world.ringEnabled ? '⟡ ХРАНИТЕЛЬ ЖИВ · СВЯЗЬ ОТКРЫТА' : '◇ ПЕЧАТЬ ОТКРОЕТСЯ ПОСЛЕ АРКИ');
    for (const [id, cooldown, locked] of [['dodge', p.dodgeCooldown, false], ['dragon', p.dragonCooldown, p.energy < BALANCE.hero.dragon.cost], ['seal', p.sealCooldown, !this.world.ringEnabled || p.energy < BALANCE.hero.seal.cost]] as const) {
      const el = this.ui.querySelector<HTMLElement>(`#${id}-cool`);
      if (el) { el.style.display = cooldown > 0 || locked ? 'grid' : 'none'; el.textContent = cooldown > 0 ? cooldown.toFixed(1) : id === 'seal' && !this.world.ringEnabled ? 'АРКА' : locked ? '◇' : ''; }
    }
    if (this.mode === 'training') {
      const t = this.world.telemetry;
      const alive = this.world.enemies.filter(enemy => enemy.hp > 0).length;
      const ready = alive === 0;
      this.setText('objective-title', ready ? 'Арка открыта · идите по золотому следу ↑' : `Обучение · противников осталось: ${alive}/2`);
      this.setText('objective-text', ready ? 'Пройдите между колоннами на севере — переход сработает сам. Рядом также доступны Enter / E / ◇.' : 'ЛКМ / J — один удар. Три нажатия — комбо. Space — рывок, Q — дракон. Кольцо и отсчёт включатся после арки.');
      for (const [id, done] of [['move', this.moved > 70], ['sword', t.comboSteps.some(count => count > 0)], ['dodge', t.dodges > 0], ['magic', t.dragonCasts > 0]] as const) this.ui.querySelector(`#lesson-${id}`)?.classList.toggle('done', done);
    } else if (this.mode === 'boss') {
      const boss = this.world.boss!;
      this.setBar('boss-hp', boss.hp / boss.maxHp);
      this.setText('boss-phase', ['I · ЧЁРНАЯ СТАЛЬ', 'II · КРОВАВАЯ ПАМЯТЬ', 'III · ПОСЛЕДНЯЯ ЯРОСТЬ'][Math.max(0, boss.phase - 1)] || 'ПЕЧАТЬ ДРОЖИТ');
      this.setText('timer-value', clock(this.world.timeLeft));
      this.setText('seal-status', `ЦЕЛОСТНОСТЬ ${Math.ceil(this.world.sealIntegrity * 100)}%`);
      this.ui.querySelector('#time-panel')?.classList.toggle('danger', this.world.timeLeft < 30);
      this.setText('objective-title', boss.state === 'PhaseTransition' ? 'Демон сбрасывает старую броню' : 'Разорвите Завет');
      this.setText('objective-text', boss.state === 'PhaseTransition' ? 'Отступите от вспышки. Его следующая атака станет быстрее.' : 'Уклоняйтесь от телеграфов. Восстановление босса — ваше окно для комбо. L — совместный удар печати.');
    }
  }
  private notify(text: string, duration = 4) {
    this.notificationTime = duration; this.setText('notification', text);
    this.ui.querySelector('#notification')?.classList.add('show');
  }
  private togglePause() {
    if (!['training', 'boss', 'epilogue'].includes(this.mode)) return;
    if (this.paused) { this.paused = false; this.ui.querySelector('.modal-wrap')?.remove(); this.controls.enabled = true; this.controls.clear(); return; }
    this.paused = true; this.controls.enabled = false;
    this.modal(`<div class="eyebrow">ВРЕМЯ ОСТАНОВЛЕНО</div><h2>Тишина между ударами</h2><p>Таймер печати, враги и ваши способности на паузе.</p><div class="menu-actions"><button id="resume" class="button primary">Продолжить</button><button id="help" class="button ghost">Управление</button><button id="restart" class="button ghost">Заново</button><button id="menu" class="button ghost">В меню</button></div><label class="setting-row">Громкость<input id="pause-volume" type="range" min="0" max="1" step="0.05" value="${this.prefs.volume}" /></label>`);
    this.click('resume', () => this.togglePause()); this.click('help', () => this.showControls());
    this.click('restart', () => this.mode === 'training' ? this.startTraining() : this.startBoss()); this.click('menu', () => this.showMenu());
    this.ui.querySelector<HTMLInputElement>('#pause-volume')!.oninput = (event) => { this.prefs.volume = Number((event.target as HTMLInputElement).value); this.savePrefs(); };
  }

  private beginCinema(type: 'intro' | 'ending', outcome?: Exclude<Outcome, null>) {
    this.mode = type; this.paused = false; this.controls.enabled = false; this.controls.clear();
    this.cleanCinematic(); this.cinemaTime = 0; this.captionIndex = -1; this.pulseIndex = -1;
    if (outcome) this.ending = outcome;
    this.view.build('boss');
    if (type === 'intro') {
      const copy = new CombatWorld('boss', this.prefs);
      this.cinemaActors = [copy.player, copy.ally, copy.boss!];
      this.cinemaActors[0].x = 400; this.cinemaActors[0].y = 535;
      this.cinemaActors[1].x = 550; this.cinemaActors[1].y = 535;
      this.cinemaActors[2].x = 480; this.cinemaActors[2].y = 200;
    } else {
      this.cinemaActors = this.world.actors.map(actor => ({ ...actor, hitIds: new Set<string>(), invulnerable: 0, stateTime: 0, state: 'Idle' as const }));
      const [hero, ally, demon] = this.cinematicKnights();
      hero.x = 405; hero.y = 390; ally.x = 555; ally.y = 380; demon.x = 480; demon.y = 240;
      hero.facing = -Math.PI / 2; ally.facing = -Math.PI / 2; demon.facing = Math.PI / 2;
    }
    this.ui.innerHTML = `<section class="cinema" aria-label="Кат-сцена"><div class="letterbox top"><span class="cinema-tag">${type === 'intro' ? 'СЕРДЦЕ ПЕЧАТИ · ДОБРОВОЛЬНОЕ СОГЛАСИЕ' : this.ending === 'victory' ? 'КОНЕЦ КРОВАВОГО ЗАВЕТА' : 'НЕКАНОНИЧЕСКОЕ ПОРАЖЕНИЕ'}</span><button id="skip" class="button ghost">Пропустить →</button></div><div class="letterbox bottom"><div class="scene-caption"><span class="speaker" id="speaker"></span><span id="caption"></span></div></div></section>`;
    this.click('skip', () => this.finishCinema());
  }
  private cinematicKnights() { return ['hero', 'ally', 'demon'].map(kind => this.cinemaActors.find(actor => actor.kind === kind)!) as [Actor, Actor, Actor]; }
  private caption(index: number, speaker: string, text: string) {
    if (this.captionIndex === index) return; this.captionIndex = index;
    this.setText('speaker', speaker); this.setText('caption', text);
  }
  private onceAt(index: number, action: () => void) { if (this.pulseIndex < index) { this.pulseIndex = index; action(); } }
  private line(x1: number, y1: number, x2: number, y2: number, color: number, width = 2, alpha = 0.8) {
    this.cine.lineStyle(width, color, alpha); this.cine.lineBetween(x1, y1, x2, y2);
  }
  private tickCinema(dt: number) {
    this.cinemaTime += dt; const t = this.cinemaTime;
    this.cine.clear();
    const [hero, ally, demon] = this.cinematicKnights();
    this.cinemaActors.forEach(actor => { actor.stateTime += dt; });
    if (this.mode === 'intro') {
      hero.y = lerp(535, 385, t / 2.8); ally.y = lerp(535, 370, t / 2.8);
      hero.facing = ally.facing = -Math.PI / 2;
      hero.state = ally.state = t < 2.8 ? 'Walk' : 'Idle';
      if (t < 3) this.caption(0, 'ХРАНИТЕЛЬ', 'Я прошёл обряд. Но это сражение мы разделим.');
      else if (t < 6.3) {
        this.caption(1, 'ХРАНИТЕЛЬ', 'Я добровольно открываю тебе кольцо. Ты проводник, не хранитель.');
        ally.state = 'Attack'; ally.attackIndex = 1; ally.facing = Math.PI;
        this.line(ally.x - 15, ally.y - 8, hero.x + 12, hero.y - 8, 0xe3cc87, 3);
        this.onceAt(0, () => { audio.play('seal'); this.view.ringPulse(480, 340, 0xd9ca84, 180); });
      } else {
        this.caption(2, 'РЕЗОНАНС ПЕРВОРОДНОЙ СИЛЫ', 'Две половины отзываются. Печать удержит нас пятнадцать минут.');
        this.line(hero.x, hero.y - 7, 480, 320, 0xd37457, 4);
        this.line(ally.x, ally.y - 7, 480, 320, 0xd4c184, 4);
        this.cine.lineStyle(2, 0xe4c37b, .55 + Math.sin(t * 7) * .2).strokeCircle(480, 320, 110 + Math.sin(t * 3) * 5);
        this.onceAt(1, () => { audio.play('dragon'); this.view.particles(480, 320, 0xeacb83, 70); this.cameras.main.shake(150, .002); });
      }
      if (t > 10.5) this.finishCinema();
    } else if (this.ending === 'victory') this.victoryCinema(t, hero, ally, demon);
    else if (this.ending === 'timeout') this.timeoutCinema(t, hero, ally, demon);
    else this.healthCinema(t, hero, ally, demon);
    this.view.renderActors(this.cinemaActors, dt);
  }

  private victoryCinema(t: number, hero: Actor, ally: Actor, demon: Actor) {
    if (t < 3) {
      this.caption(0, 'ПОСЛЕДНИЙ СОВМЕСТНЫЙ УДАР', 'Впервые за века тьма отступает.');
      hero.state = ally.state = 'Attack'; hero.attackIndex = 2; ally.attackIndex = 1;
      demon.state = 'Defeated'; demon.hp = Math.max(0.001, demon.maxHp * (1 - t / 2.8));
      this.line(hero.x, hero.y, demon.x, demon.y, 0xe9c992, 3, 1 - t / 3);
      this.line(ally.x, ally.y, demon.x, demon.y, 0x8fcacb, 3, 1 - t / 3);
      this.onceAt(0, () => { audio.play('death'); this.view.particles(demon.x, demon.y, 0xbe5a4d, 75); });
    } else if (t < 6) {
      this.caption(1, 'ПЕЧАТЬ', 'Без пленника ей больше незачем держаться.');
      demon.hp = 0; hero.state = ally.state = 'Idle'; this.view.setSealDamage((t - 3) / 3);
      for (let i = 0; i < 10; i++) { const angle = i * 2.399; this.line(480 + Math.cos(angle) * 20, 320 + Math.sin(angle) * 20, 480 + Math.cos(angle) * (70 + (t - 3) * 50), 320 + Math.sin(angle) * (70 + (t - 3) * 50), 0xebd498, 2); }
      this.onceAt(1, () => { audio.play('seal'); this.view.ringPulse(480, 320, 0xf6dda1, 230); this.view.particles(480, 320, 0xdcc78f, 90); });
    } else if (t < 9.8) {
      this.caption(2, 'ГОЛОСА ПРЕЖНИХ ХРАНИТЕЛЕЙ', 'Долг исполнен. Теперь — покой.');
      this.onceAt(2, () => { for (let i = 0; i < 7; i++) this.souls.push(this.add.image(350 + i * 44, 310 + Math.sin(i * 2) * 45, 'soul').setDepth(600).setAlpha(.65)); });
      this.souls.forEach((soul, i) => { soul.y -= .27; soul.x += Math.sin(t * 2 + i) * .12; soul.alpha = .65 * Math.max(0, 1 - (t - 7) / 3); });
      hero.facing = ally.facing = -Math.PI / 2;
    } else if (t < 13) {
      this.caption(3, 'БЕЗЫМЯННЫЙ', 'Это был его договор. Моя жизнь ему не принадлежит.');
      hero.state = t < 11.5 ? 'Attack' : 'Idle'; hero.attackIndex = 2; hero.facing = Math.PI / 2;
      this.onceAt(3, () => { this.pendant = this.add.image(hero.x + 24, hero.y + 6, 'pendant').setDepth(700).setScale(1.4); });
      if (t > 11.5) this.onceAt(4, () => { this.pendant?.destroy(); this.pendant = undefined; this.view.particles(hero.x + 24, hero.y + 6, 0xe79574, 35); audio.play('hit'); });
      if (t < 11.5) this.cine.fillStyle(0xd85544, .10).fillCircle(hero.x, hero.y, 31);
    } else {
      this.caption(4, 'ЗАВЕТ РАЗОРВАН', 'Драконья сила гаснет. Впереди остаётся только рассвет.');
      this.cine.fillStyle(0x0b1118, Phaser.Math.Clamp((t - 13) / 1.7, 0, 1)).fillRect(0, 0, 960, 640);
      if (t > 14.8) this.finishCinema();
    }
  }

  private healthCinema(t: number, hero: Actor, ally: Actor, demon: Actor) {
    if (t < 2.4) {
      this.caption(0, this.ending === 'ally' ? 'СВЯЗЬ ОБОРВАНА' : 'КЛИНОК НЕ УДЕРЖАЛСЯ', this.ending === 'ally' ? 'Хранитель падает. Без его воли кольцо замолкает.' : 'Герой падает. Демон разрывает живую связь с хранителем.');
      if (this.ending === 'ally') ally.state = 'Dead'; else hero.state = 'Dead';
      this.line(hero.x, hero.y, ally.x, ally.y, 0xc2bd8b, 2, Math.max(0, 1 - t / 2.4));
      this.onceAt(0, () => { audio.play('hurt'); this.view.particles(480, 380, 0xb8c6a5, 30); });
    } else if (t < 4.8) {
      this.caption(1, 'МОРВЕЙН', 'Я забираю то, что когда-то подарил.');
      hero.state = 'Dead'; demon.state = 'Attack';
      this.line(hero.x, hero.y - 6, demon.x, demon.y, 0xe05e4a, 5);
      const f = (t - 2.4) / 2.4;
      this.view.particles(lerp(hero.x, demon.x, f), lerp(hero.y, demon.y, f), 0xc36450, 2);
      this.onceAt(1, () => { audio.play('dragon'); this.view.ringPulse(demon.x, demon.y, 0xab453e, 90); });
    } else if (t < 7) {
      this.caption(2, 'ПОСЛЕДНИЙ ХРАНИТЕЛЬ', 'Он встречает врага один — и падает под его ударом.');
      ally.x = lerp(555, 500, (t - 4.8) / 1.3); ally.y = lerp(380, 300, (t - 4.8) / 1.3);
      ally.state = t < 6.1 ? 'Attack' : 'Dead'; demon.state = 'Attack'; demon.attackIndex = 2;
      this.onceAt(2, () => { audio.play('hit'); this.view.ringPulse(500, 300, 0xc25243, 110); });
    } else if (t < 9.6) {
      this.caption(3, 'ПЕЧАТЬ ЗАХВАЧЕНА', 'Чужая воля подчиняет руны. Обе половины силы в руках демона.');
      ally.state = 'Dead'; demon.state = 'Walk'; demon.y = lerp(240, 320, (t - 7) / 2); demon.facing = Math.PI / 2;
      this.view.setSealDamage((t - 7) / 2.6);
      this.cine.lineStyle(4, 0xc3483c, .8).strokeCircle(480, 320, 140);
      this.onceAt(3, () => { audio.play('phase'); this.view.particles(480, 320, 0xb65546, 90); });
    } else {
      this.caption(4, 'МОРВЕЙН СВОБОДЕН', 'Печать раскрывается изнутри. Пленник выходит в мир.');
      this.drawPortal(t - 9.6); demon.state = 'Walk'; demon.y = lerp(320, 153, (t - 9.6) / 2.8); demon.facing = -Math.PI / 2;
      this.onceAt(4, () => { audio.play('death'); this.view.ringPulse(480, 160, 0xd05c49, 135); });
      if (t > 13) this.finishCinema();
    }
  }
  private timeoutCinema(t: number, hero: Actor, ally: Actor, demon: Actor) {
    if (t < 2.6) {
      this.caption(0, 'ВРЕМЯ ИСТЕКЛО', 'Защита истощила печать. Руны гаснут — не связь, а сам щит.');
      hero.state = ally.state = 'Hit';
      for (let i = 0; i < 12; i++) { const angle = i / 12 * Math.PI * 2; this.line(480, 320, 480 + Math.cos(angle) * t * 100, 320 + Math.sin(angle) * t * 100, 0xc99562, 2); }
      this.view.setSealDamage(t / 2.6);
      this.onceAt(0, () => { audio.play('phase'); this.view.ringPulse(480, 320, 0xd3b579, 280); });
    } else if (t < 5) {
      this.caption(1, 'МОРВЕЙН', 'Пятнадцать минут. Ты исчерпал их все. Подарок возвращается ко мне.');
      hero.state = 'Hit'; demon.state = 'Attack';
      this.line(hero.x, hero.y, demon.x, demon.y, 0xe35a48, 4);
      this.cine.fillStyle(0xa74f43, .08).fillCircle(hero.x, hero.y, 60 + Math.sin(t * 10) * 10);
      this.onceAt(1, () => { audio.play('dragon'); this.view.particles(hero.x, hero.y, 0xc44a3b, 70); });
    } else if (t < 7.3) {
      this.caption(2, 'ЩИТА БОЛЬШЕ НЕТ', 'Демон обрушивается на хранителя. Кольцо раскалывается.');
      demon.state = 'Attack'; demon.x = lerp(480, 555, (t - 5) / .7); demon.y = lerp(240, 380, (t - 5) / .7);
      ally.state = t > 5.8 ? 'Dead' : 'Hit'; hero.state = 'Dead';
      this.onceAt(2, () => { audio.play('hurt'); this.view.particles(555, 380, 0xceb783, 60); this.cameras.main.shake(250, .004); });
    } else if (t < 10) {
      this.caption(3, 'ПЕЧАТЬ РАЗРУШЕНА', 'Демон разбивает обнажённое сердце. Камень больше не держит его.');
      demon.x = lerp(555, 480, (t - 7.3) / 1.3); demon.y = lerp(380, 320, (t - 7.3) / 1.3); demon.state = 'Attack'; demon.attackIndex = 2;
      this.onceAt(3, () => { audio.play('death'); this.view.particles(480, 320, 0xcba16c, 120); this.view.ringPulse(480, 320, 0xb74436, 290); this.cameras.main.shake(300, .006); });
    } else {
      this.caption(4, 'ЦЕПИ ПАЛИ', 'Вместо святилища остаётся пролом. Морвейн выходит на свободу.');
      this.drawPortal(t - 10); demon.state = 'Walk'; demon.y = lerp(320, 150, (t - 10) / 3); demon.facing = -Math.PI / 2;
      if (t > 13.5) this.finishCinema();
    }
  }
  private drawPortal(t: number) {
    const r = 34 + Math.min(1, t) * 35;
    this.cine.fillStyle(0x07070b, .95).fillEllipse(480, 170, r * 1.2, r * 1.6);
    this.cine.lineStyle(3, 0xc25245, .7).strokeEllipse(480, 170, r * 1.2, r * 1.6);
    this.cine.lineStyle(1, 0xf39264, .55).strokeEllipse(480, 170, r * 1.25, r * 1.65);
  }
  private finishCinema() {
    if (this.mode === 'intro') this.startBoss();
    else if (this.ending === 'victory') this.startEpilogue();
    else this.showResult();
  }
  private startEpilogue() {
    this.cleanCinematic(); this.mode = 'epilogue'; this.epilogueTime = 0; this.view.build('dawn');
    this.controls.enabled = true; const [hero, ally] = this.cinematicKnights();
    hero.hp = hero.maxHp; ally.hp = ally.maxHp; hero.x = 420; hero.y = 400; ally.x = 515; ally.y = 390; hero.state = ally.state = 'Idle'; hero.facing = ally.facing = -Math.PI / 2;
    this.cinemaActors = [hero, ally];
    this.ui.innerHTML = `<div class="epilogue-banner">Рассвет принадлежит живым<small>ДРАКОНЬЯ СИЛА УШЛА. ВЫ ОСТАЛИСЬ СОБОЙ.</small></div><div class="hud"><div class="hud-top"><span class="eyebrow">ПОСЛЕ ДОЛГОЙ НОЧИ</span>${this.buttonTools()}</div><div class="objective"><strong>Побудьте здесь</strong><p>Можно двигаться. E / ◇ — завершить историю.</p></div><div class="notification" id="notification"></div></div>`;
    this.bindTools();
  }
  private showResult() {
    this.cleanCinematic(); this.mode = 'result'; this.controls.enabled = false; this.paused = false;
    const win = this.ending === 'victory';
    const title = win ? 'Завет разорван' : this.ending === 'timeout' ? 'Пятнадцатая минута' : this.ending === 'ally' ? 'Оборванная связь' : 'Павший проводник';
    const text = win ? 'Демон уничтожен. Души хранителей свободны. Кулон обращён в пепел, и драконья сила больше не держит вас. Два рыцаря встречают день без чужого долга.' : this.ending === 'timeout' ? 'Щит печати иссяк. Морвейн вернул подаренную силу, сразил хранителя и разбил сердце святилища. Это не конец вашей истории — начните снова.' : 'Морвейн оборвал связь, вернул подаренную силу и одолел хранителя. Захватив печать, он вышел из заточения. Это лишь одна из возможных неудач.';
    this.ui.innerHTML = `<section class="screen result"><div class="result-copy"><div class="eyebrow">${win ? 'ПРОЛОГ ЗАВЕРШЁН' : 'НЕКАНОНИЧЕСКОЕ ПОРАЖЕНИЕ'}</div><h1>${title}</h1><div class="rule"></div><p>${text}</p><div class="result-stats"><div><b>${clock(this.world.elapsed)}</b>ВРЕМЯ В БОЮ</div><div><b>${Math.round(this.world.telemetry.damageDealt)}</b>ВАШ УРОН</div><div><b>${this.world.telemetry.dodges}</b>УКЛОНЕНИЙ</div></div><div class="menu-actions"><button id="retry" class="button primary">${win ? 'Ещё одно испытание' : 'Попробовать снова'}</button><button id="menu" class="button ghost">В меню</button></div><p style="font-size:11px;color:#84948e">${this.prefs.demo ? 'Демонстрационный режим · 2:30. Каноническая защита — 15:00.' : 'Канонический режим · защита печати длится 15:00.'}</p></div></section>`;
    this.click('retry', () => this.startBoss()); this.click('menu', () => this.showMenu());
  }

  update(_time: number, delta: number) {
    if (!this.controls || !this.world) return;
    const dt = Math.min(delta / 1000, .05);
    if (this.controls.consumePause()) {
      if (this.ui.querySelector('.modal-wrap') && !this.paused) this.ui.querySelector('.modal-wrap')?.remove();
      else this.togglePause();
    }
    if (this.paused) return;
    audio.update(dt, this.mode === 'menu' ? 'menu' : this.mode === 'boss' ? 'boss' : ['ending', 'epilogue', 'result'].includes(this.mode) ? 'ending' : 'training');
    if (this.mode === 'menu' || this.mode === 'result') {
      this.cinemaActors.forEach(actor => actor.stateTime += dt);
      this.view.renderActors(this.cinemaActors, dt); return;
    }
    if (this.mode === 'intro' || this.mode === 'ending') { this.tickCinema(dt); return; }
    const input = this.controls.sample();
    if (this.mode === 'epilogue') {
      this.epilogueTime += dt;
      const [hero, ally] = this.cinemaActors;
      hero.x = Phaser.Math.Clamp(hero.x + input.x * 120 * dt, 120, 840);
      hero.y = Phaser.Math.Clamp(hero.y + input.y * 120 * dt, 190, 550);
      if (input.x || input.y) { hero.facing = Math.atan2(input.y, input.x); hero.state = 'Walk'; } else hero.state = 'Idle';
      hero.stateTime += dt;
      const distance = Math.hypot(hero.x + 65 - ally.x, hero.y - ally.y);
      if (distance > 35) { DIRECTION(ally, hero.x + 65, hero.y); ally.x += Math.cos(ally.facing) * 80 * dt; ally.y += Math.sin(ally.facing) * 80 * dt; ally.state = 'Walk'; } else ally.state = 'Idle';
      ally.stateTime += dt;
      this.view.renderActors(this.cinemaActors, dt);
      if ((this.controls.consumeInteract() && this.epilogueTime > 1) || this.epilogueTime > 12) this.showResult();
      return;
    }
    if (input.seal && !this.world.ringEnabled) this.notify('Печать пока закрыта: завершите обучение и войдите в арку. Хранитель откроет кольцо.', 4);
    else if (input.seal && this.world.player.energy < BALANCE.hero.seal.cost) this.notify(`Для печати нужно ${BALANCE.hero.seal.cost} силы. Дождитесь восстановления ресурса.`, 3);
    else if (input.seal && this.world.player.sealCooldown > 0) this.notify(`Печать восстанавливается: ${this.world.player.sealCooldown.toFixed(1)} с.`, 2);
    const oldX = this.world.player.x, oldY = this.world.player.y;
    this.world.update(delta / 1000, input);
    const distanceMoved = Math.hypot(this.world.player.x - oldX, this.world.player.y - oldY);
    this.moved += distanceMoved;
    if (this.world.player.state === 'Walk') {
      this.stepDistance += distanceMoved;
      if (this.stepDistance > 34) { this.stepDistance = 0; audio.play('step'); }
    }
    this.view.render(this.world, dt);
    for (const event of this.world.events.splice(0)) {
      const type = event.type;
      if (type === 'attack') audio.play('sword');
      else if (type === 'hit') { audio.play(event.actorId === this.world.player.id ? 'hurt' : 'hit'); if ((event.amount || 0) > 40) this.cameras.main.shake(90, .002); }
      else if (type === 'dodge' || type === 'dragon' || type === 'seal' || type === 'phase') audio.play(type);
      else if (type === 'barrier') audio.play('seal');
      else if (type === 'training-complete') { this.view.setTrainingGate(true); this.notify('Арка открылась. Идите по золотому следу на север — дальше демон.', 5); }
      if (['hit', 'dragon', 'seal', 'phase'].includes(type)) this.view.particles(event.x, event.y, event.color || (type === 'seal' ? 0xd5c481 : 0xcc8b69), type === 'hit' ? 8 : 24);
    }
    this.hudClock += dt;
    if (this.hudClock > .08) { this.hudClock = 0; this.updateHud(); }
    if (this.notificationTime > 0) { this.notificationTime -= dt; if (this.notificationTime <= 0) this.ui.querySelector('#notification')?.classList.remove('show'); }
    if (this.mode === 'training') {
      const interact = this.controls.consumeInteract();
      const ready = this.world.trainingComplete;
      this.gateReadyFor = ready ? this.gateReadyFor + dt : 0;
      const p = this.world.player;
      const insideDoorway = p.x >= 430 && p.x <= 530 && p.y <= 155;
      const nearGate = Math.hypot(p.x - 480, p.y - 135) <= 115;
      if (ready && ((insideDoorway && this.gateReadyFor >= .25) || (interact && nearGate))) {
        this.beginCinema('intro');
        return;
      }
      if (interact) this.notify(ready ? 'Идите к светящемуся проходу между колоннами на севере.' : 'Сначала победите двух тренировочных врагов. Затем откроется проход к демону.');
    }
    if (this.mode === 'boss' && this.world.outcome) this.beginCinema('ending', this.world.outcome);
  }
}
