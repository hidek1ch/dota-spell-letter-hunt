import type Phaser from 'phaser';

/** Original, deterministic pixel art. Every visible edge is drawn on a 1 px grid. */
type Color = string;
const C = {
  ink: '#10151c', dark: '#1b242d', slate: '#303d47', steel: '#617684',
  silver: '#a4b9be', shine: '#d2d9cf', leather: '#342a29', gold: '#b19a62',
  goldLight: '#ead79a', red: '#8f3039', ember: '#ee6b56', blue: '#86bfc3',
  bone: '#a79e88', cloth: '#384850', shadow: '#111a20',
};

class Pixel {
  constructor(public c: CanvasRenderingContext2D) { c.imageSmoothingEnabled = false; }
  r(x: number, y: number, w: number, h: number, color: Color): void {
    this.c.fillStyle = color;
    this.c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  dot(x: number, y: number, color: Color): void { this.r(x, y, 1, 1, color); }
  line(x0: number, y0: number, x1: number, y1: number, color: Color, width = 1): void {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.r(x0, y0, width, width, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  poly(points: number[][], color: Color): void {
    const lo = Math.ceil(Math.min(...points.map(p => p[1])));
    const hi = Math.floor(Math.max(...points.map(p => p[1])));
    for (let y = lo; y <= hi; y++) {
      const cuts: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
          cuts.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i += 2)
        this.r(Math.ceil(cuts[i]), y, Math.floor(cuts[i + 1]) - Math.ceil(cuts[i]) + 1, 1, color);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, color: Color): void {
    for (let y = -ry; y <= ry; y++) {
      const x = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
      this.r(cx - x, cy + y, x * 2 + 1, 1, color);
    }
  }
  ring(cx: number, cy: number, radius: number, color: Color, thickness = 1): void {
    for (let i = 0; i < 720; i++) {
      const t = i / 720 * Math.PI * 2;
      this.r(cx + Math.cos(t) * radius, cy + Math.sin(t) * radius, thickness, thickness, color);
    }
  }
}

function surface(w: number, h: number): [HTMLCanvasElement, Pixel] {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return [canvas, new Pixel(canvas.getContext('2d')!)];
}

function seed(n: number): () => number {
  return () => { n = (Math.imul(n, 1664525) + 1013904223) | 0; return (n >>> 0) / 4294967296; };
}

function sword(p: Pixel, x: number, y: number, angle: number, dark = false, long = 14): void {
  const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
  const point = (along: number, side: number) => [x + dx * along + nx * side, y + dy * along + ny * side];
  p.poly([point(-5, -1), point(-5, 1), point(0, 1), point(0, -1)], C.leather);
  p.poly([point(0, -2), point(long - 3, -2), point(long + 1, 0), point(long - 3, 2), point(0, 2)], C.ink);
  p.poly([point(1, -1), point(long - 3, -1), point(long - 1, 0), point(long - 3, 1), point(1, 1)], dark ? '#655b66' : C.silver);
  const a = point(2, -1), b = point(long - 3, -1);
  p.line(a[0], a[1], b[0], b[1], dark ? C.red : C.shine);
  const g1 = point(0, -4), g2 = point(0, 4);
  p.line(g1[0], g1[1], g2[0], g2[1], dark ? C.red : C.gold, 2);
  const pommel = point(-5, 0); p.r(pommel[0] - 1, pommel[1] - 1, 2, 2, dark ? C.ember : C.gold);
}

function shield(p: Pixel, x: number, y: number, ally: boolean, side = false): void {
  const w = side ? 5 : 9;
  p.poly([[x, y], [x + w, y], [x + w, y + 10], [x + w / 2, y + 15], [x, y + 10]], C.ink);
  p.poly([[x + 1, y + 1], [x + w - 1, y + 1], [x + w - 1, y + 9], [x + w / 2, y + 12], [x + 1, y + 9]], ally ? '#776a47' : '#31454e');
  p.line(x + 2, y + 2, x + w - 2, y + 2, ally ? C.goldLight : C.steel);
  p.line(x + w / 2, y + 2, x + w / 2, y + 10, ally ? C.goldLight : '#829ca1');
  p.line(x + 1, y + 5, x + w - 1, y + 5, ally ? C.gold : '#617d87');
  p.dot(x + 1, y + 1, C.silver);
  p.dot(x + w - 1, y + 1, C.silver);
}

function knight(p: Pixel, dir: number, f: number, ally = false, hollow = false): void {
  const c = p.c;
  const walking = f >= 2 && f <= 5;
  const stride = walking ? [0, 2, 0, -2][f - 2] : 0;
  const bob = f === 1 || f === 3 || f === 5 ? -1 : 0;
  const attack = f >= 6 && f <= 8;
  const dodge = f === 9;
  const hit = f === 10;
  const dead = f === 11;
  c.save();
  if (dead) { c.translate(6, 35); c.rotate(-Math.PI / 2); c.translate(-14, -26); }
  else c.translate(dodge ? 3 : hit ? -2 : 0, bob + (dodge ? 3 : 0));
  const cape = hollow ? '#393932' : ally ? '#48442f' : '#4b2731';
  const capeLight = hollow ? '#505041' : ally ? '#736345' : '#793844';
  const steel = hollow ? '#48524d' : C.steel;
  const light = hollow ? '#7c8876' : ally ? '#a8b1a0' : C.silver;
  const body = dir === 1 || dir === 2 ? 11 : 14;
  const bx = 24 - Math.floor(body / 2);

  // Cloth, with separate torn folds instead of a rectangular silhouette.
  p.poly([[19, 14], [29, 14], [32 + stride / 2, 34], [28, 37], [26, 34], [23, 37], [21, 34], [16 - stride / 2, 35]], C.ink);
  p.poly([[20, 15], [28, 15], [30 + stride / 2, 33], [27, 35], [24, 32], [20, 35], [18 - stride / 2, 33]], cape);
  p.line(20, 19, 20 - stride / 2, 32, capeLight);
  p.line(27, 18, 29 + stride / 2, 32, capeLight);
  // Weapon is carried behind the body when facing north.
  if (dir === 3 && !attack) sword(p, 33, 23, -Math.PI / 2 - 0.2, hollow);
  // Separate articulated feet and shin plates.
  p.r(18, 29 + stride, 5, 9, C.ink); p.r(25, 29 - stride, 5, 9, C.ink);
  p.r(19, 30 + stride, 3, 5, steel); p.r(26, 30 - stride, 3, 5, steel);
  p.r(18, 36 + stride, 6, 3, C.dark); p.r(25, 36 - stride, 6, 3, C.dark);
  p.r(19, 36 + stride, 4, 1, light); p.r(26, 36 - stride, 3, 1, light);
  // Hauberk skirt: dark chain links below the cuirass.
  p.poly([[bx + 1, 25], [bx + body - 1, 25], [bx + body + 1, 31], [bx - 1, 31]], C.ink);
  p.r(bx + 1, 26, body - 2, 4, '#414b50');
  for (let x = bx + 2; x < bx + body - 1; x += 2) { p.dot(x, 28, steel); p.dot(x + 1, 30, steel); }
  // Breastplate and segmented shoulder armour.
  p.poly([[bx, 17], [bx + body, 17], [bx + body - 1, 26], [24, 29], [bx + 1, 26]], C.ink);
  p.poly([[bx + 2, 18], [bx + body - 2, 18], [bx + body - 2, 25], [24, 27], [bx + 2, 25]], steel);
  p.line(bx + 2, 18, bx + body - 3, 18, light);
  p.line(24, 19, 24, 25, light);
  p.r(bx + 2, 26, body - 3, 2, C.leather); p.r(23, 26, 3, 2, C.gold);
  const armSwing = walking ? stride / 2 : 0;
  p.poly([[bx - 4, 16 + armSwing], [bx + 2, 15], [bx + 3, 21], [bx - 3, 23 + armSwing]], C.ink);
  p.r(bx - 3, 17 + armSwing, 5, 4, steel); p.r(bx - 2, 17 + armSwing, 4, 1, light);
  p.poly([[bx + body - 2, 16], [bx + body + 3, 16 - armSwing], [bx + body + 4, 22 - armSwing], [bx + body - 1, 22]], C.ink);
  p.r(bx + body - 1, 17 - armSwing, 4, 4, steel); p.r(bx + body - 1, 17 - armSwing, 3, 1, light);
  p.r(bx - 3, 22 + armSwing, 4, 7, C.dark); p.r(bx + body, 22 - armSwing, 4, 7, C.dark);
  p.r(bx - 2, 23 + armSwing, 2, 4, steel); p.r(bx + body + 1, 23 - armSwing, 2, 4, steel);

  // Bascinet, side-facing visors and a face-obscuring eye slit.
  p.poly([[20, 6], [27, 6], [30, 9], [30, 17], [27, 20], [21, 20], [18, 16], [18, 10]], C.ink);
  p.poly([[21, 7], [26, 7], [28, 10], [28, 16], [26, 18], [21, 18], [20, 15], [20, 10]], steel);
  p.line(21, 8, 26, 8, light); p.line(20, 10, 20, 14, light);
  if (dir === 3) {
    p.r(22, 10, 5, 7, C.slate); p.line(24, 9, 24, 18, light);
    p.r(22, 17, 4, 3, C.leather);
    p.poly([[21, 16], [27, 16], [28, 26], [24, 30], [20, 25]], cape);
    p.line(22, 18, 23, 26, capeLight);
  } else if (dir === 1) {
    p.poly([[20, 10], [17, 12], [17, 15], [21, 17], [24, 16], [24, 11]], C.slate);
    p.r(18, 12, 5, 2, C.ink); p.dot(19, 12, hollow ? '#c69c62' : C.blue);
    p.line(18, 15, 21, 17, light);
  } else if (dir === 2) {
    p.poly([[27, 10], [31, 12], [31, 15], [27, 17], [24, 16], [24, 11]], C.slate);
    p.r(26, 12, 5, 2, C.ink); p.dot(29, 12, hollow ? '#c69c62' : C.blue);
    p.line(28, 15, 30, 15, light);
  } else {
    p.r(20, 12, 9, 3, C.ink); p.r(21, 12, 2, 1, hollow ? '#c69c62' : C.blue);
    p.r(26, 12, 2, 1, hollow ? '#c69c62' : C.blue);
    p.line(24, 11, 24, 17, light); p.r(21, 16, 7, 1, C.slate);
  }
  // Heraldry and collars distinguish the two allies at a glance.
  if (ally) {
    p.r(22, 5, 5, 2, C.gold); p.r(24, 3, 2, 3, C.goldLight);
    if (dir !== 3) { p.line(24, 20, 24, 24, C.goldLight); p.line(22, 22, 26, 22, C.gold); }
  } else if (!hollow) {
    p.poly([[27, 7], [30, 8], [33, 13], [30, 12], [29, 15]], C.red);
    if (dir !== 3) p.r(23, 20, 2, 2, C.ember);
  } else { p.r(21, 5, 1, 3, C.bone); p.r(28, 6, 1, 3, C.bone); }

  if (dir === 3) shield(p, bx - 6, 20, ally, true);
  else shield(p, dir === 2 ? 15 : 11, 22 + armSwing, ally, dir === 1);
  if (attack) {
    const angles = dir === 3 ? [-2.7, -0.7, -1.55] : dir === 1 ? [-2, -3.7, -3.14] : dir === 2 ? [-1, 0.8, 0] : [-0.5, 2.5, 1.57];
    const ax = dir === 1 ? 16 : dir === 2 ? 32 : 31;
    const ay = dir === 3 ? 15 : 25;
    p.r(ax - 2, ay - 2, 4, 4, steel);
    sword(p, ax, ay, angles[f - 6], hollow, f === 8 ? 16 : 14);
  } else if (dir !== 3) sword(p, dir === 1 ? 15 : 33, 27 - armSwing, dir === 1 ? -2.5 : dir === 2 ? -0.6 : 1.1, hollow, 12);
  if (hit) { p.r(15, 18, 2, 2, C.shine); p.r(29, 24, 3, 1, C.ember); }
  c.restore();
}

function demon(p: Pixel, dir: number, f: number): void {
  const c = p.c, walk = f >= 2 && f <= 5;
  const stride = walk ? [0, 3, 0, -3][f - 2] : 0;
  c.save();
  if (f === 11) { c.translate(9, 68); c.rotate(-Math.PI / 2); c.translate(-21, -48); }
  else c.translate(f === 10 ? -2 : f === 9 ? 3 : 0, f === 1 || f === 3 || f === 5 ? -1 : 0);
  // Torn mantle behind a heavy articulated silhouette.
  p.poly([[25, 24], [55, 24], [62, 60], [58, 65], [52, 59], [48, 68], [42, 61], [36, 68], [30, 62], [21, 66]], '#101018');
  p.poly([[27, 29], [54, 27], [57, 61], [50, 56], [46, 63], [38, 57], [29, 61]], '#30232c');
  p.line(28, 34, 25, 59, '#58303b'); p.line(52, 32, 54, 57, '#5c303b');
  p.r(28, 51 + stride, 9, 17, '#101219'); p.r(43, 51 - stride, 9, 17, '#101219');
  p.poly([[29, 52 + stride], [36, 52 + stride], [35, 63 + stride], [28, 63 + stride]], '#3a3c49');
  p.poly([[44, 52 - stride], [51, 52 - stride], [52, 63 - stride], [45, 63 - stride]], '#3a3c49');
  p.line(29, 54 + stride, 34, 54 + stride, '#71717b');
  p.line(45, 54 - stride, 50, 54 - stride, '#71717b');
  p.r(25, 65 + stride, 12, 5, '#171923'); p.r(43, 65 - stride, 12, 5, '#171923');
  p.r(26, 65 + stride, 10, 1, '#66616b'); p.r(44, 65 - stride, 10, 1, '#66616b');
  // Broad gothic pauldrons, spikes and greaves.
  p.poly([[26, 25], [54, 25], [53, 45], [48, 53], [32, 53], [26, 45]], '#0d1117');
  p.poly([[29, 28], [51, 28], [50, 44], [45, 49], [35, 49], [29, 44]], '#393a48');
  p.poly([[30, 29], [40, 32], [40, 46], [32, 43]], '#4d4b58');
  p.line(30, 29, 40, 32, '#8b7880'); p.line(40, 32, 50, 29, '#6d6570');
  p.poly([[19, 22], [31, 24], [30, 35], [17, 36], [14, 31]], '#11131c');
  p.poly([[18, 25], [29, 26], [28, 32], [17, 33]], '#4d4350');
  p.poly([[49, 24], [61, 22], [66, 31], [63, 36], [50, 35]], '#11131c');
  p.poly([[51, 26], [61, 25], [63, 33], [52, 32]], '#4d4350');
  p.line(18, 25, 28, 26, '#8d717a'); p.line(52, 26, 61, 25, '#8d717a');
  for (const [x, sign] of [[19, -1], [60, 1]]) {
    p.poly([[x - 2, 27], [x + sign * 5, 17], [x + 4, 28]], '#8c7d77');
    p.line(x, 25, x + sign * 4, 18, '#cec0a0');
  }
  p.r(17, 34, 8, 14, '#151923'); p.r(55, 34, 8, 14, '#151923');
  p.r(18, 35, 6, 5, '#514651'); p.r(56, 35, 6, 5, '#514651');
  p.r(18, 43, 7, 6, '#5d4b53'); p.r(55, 43, 7, 6, '#5d4b53');
  for (let y = 48; y <= 53; y += 3) p.line(31, y, 49, y, '#79646b');
  p.r(31, 48, 18, 2, '#231a24'); p.r(38, 47, 5, 4, C.red);
  // Crimson fissures are emissive in colour, not glossy rendering.
  p.line(36, 31, 39, 36, C.red); p.line(39, 36, 36, 40, C.ember); p.line(36, 40, 40, 46, C.red);
  p.line(46, 33, 43, 38, C.red); p.line(43, 38, 46, 44, '#cb4650');
  p.dot(39, 36, '#ffb185'); p.dot(44, 39, '#ffb185');
  // Horned great helm, no visible human face.
  p.poly([[31, 12], [36, 7], [45, 7], [50, 12], [50, 24], [45, 30], [36, 29], [30, 22]], '#0b1017');
  p.poly([[33, 12], [37, 9], [44, 9], [47, 13], [47, 23], [43, 27], [37, 26], [33, 21]], '#49424d');
  p.line(37, 10, 44, 10, '#87737b');
  p.poly([[33, 16], [40, 18], [48, 15], [47, 21], [40, 23], [33, 20]], '#10121b');
  if (dir !== 3) {
    p.line(34, 17, 38, 18, '#e85556'); p.line(43, 18, 47, 17, '#e85556');
    p.r(40, 12, 2, 13, '#84717a'); p.r(39, 24, 4, 2, '#a05a56');
  } else {
    p.r(35, 14, 10, 10, '#302e3d'); p.line(40, 10, 40, 25, '#6f616f');
  }
  p.poly([[32, 17], [26, 14], [23, 7], [24, 1], [27, 10], [34, 12]], '#130f19');
  p.poly([[31, 14], [27, 11], [24, 3], [24, 8], [27, 15], [32, 18]], '#96877f');
  p.poly([[48, 17], [54, 14], [57, 7], [56, 1], [53, 10], [46, 12]], '#130f19');
  p.poly([[49, 14], [53, 11], [56, 3], [56, 8], [53, 15], [48, 18]], '#96877f');
  p.line(26, 12, 31, 15, '#c0ab93'); p.line(54, 12, 49, 15, '#c0ab93');
  const attack = f >= 6 && f <= 8;
  const angles = dir === 3 ? [-2.7, -0.4, -1.57] : dir === 1 ? [-2.2, -3.8, -3.14] : dir === 2 ? [-1, 0.7, 0] : [-0.6, 2.4, 1.57];
  sword(p, dir === 1 ? 18 : 60, attack ? 35 : 45, attack ? angles[f - 6] : dir === 3 ? -1.4 : 1.2, true, 25);
  if (f === 10) { p.line(28, 29, 47, 41, '#e9a68d', 1); p.r(26, 26, 2, 2, C.goldLight); }
  c.restore();
}

function hound(p: Pixel, dir: number, f: number): void {
  const step = f >= 2 && f <= 5 ? [0, 2, 0, -2][f - 2] : 0;
  p.c.save();
  if (dir === 1) { p.c.translate(48, 0); p.c.scale(-1, 1); }
  if (f === 11) { p.c.translate(2, 38); p.c.rotate(-Math.PI / 2); p.c.translate(-10, -25); }
  const attack = f >= 6 && f <= 8;
  p.poly([[12, 19], [20, 13], [31, 15], [37, 23], [33, 31], [17, 32], [11, 28]], '#11191e');
  p.poly([[14, 21], [22, 16], [30, 18], [34, 24], [29, 29], [18, 29]], '#49524e');
  p.line(17, 20, 28, 18, '#788073');
  p.r(12, 28 + step, 4, 10, '#222e32'); p.r(20, 29 - step, 4, 9, '#222e32');
  p.r(28, 27 + step, 4, 11, '#222e32'); p.r(34, 27 - step, 3, 10, '#222e32');
  for (const x of [12, 20, 28, 34]) p.r(x, 36 + (x % 3 === 0 ? step : -step), 4, 2, '#a5a38c');
  p.poly([[12, 22], [6, 20], [4, 15], [8, 18], [15, 18]], '#526054');
  p.poly([[29, 17], [31, 9], [35, 14], [39, 10], [39, 19], [44, 23], [43, 28], [34, 29], [28, 24]], '#151d23');
  p.poly([[31, 18], [35, 15], [39, 19], [42, 24], [39, 26], [33, 25]], '#61685d');
  p.line(31, 16, 32, 11, '#8b8d76'); p.line(38, 17, 39, 12, '#8b8d76');
  p.r(36, 20, 3, 2, '#f0b466');
  p.poly([[37, 25], [44, 24], [45, attack ? 31 : 27], [39, 30]], '#0d1319');
  p.r(40, 25, 1, attack ? 4 : 2, C.bone); p.r(43, 25, 1, attack ? 3 : 2, C.bone);
  p.poly([[18, 16], [19, 10], [22, 15], [25, 10], [27, 17], [30, 14], [30, 20]], '#858574');
  p.line(18, 23, 28, 25, '#783d3c'); p.r(22, 23, 2, 2, '#d3745e');
  p.c.restore();
}

function tiles(scene: Phaser.Scene): void {
  for (let k = 0; k < 6; k++) {
    const [canvas, p] = surface(32, 32), rnd = seed(731 + k * 197);
    p.r(0, 0, 32, 32, '#232d32');
    const base = ['#303a3e', '#333c3e', '#30393c', '#303b40', '#2d373c', '#343c3e'][k];
    p.r(1, 1, 30, 30, base);
    p.line(2, 1, 28, 1, '#414b4d'); p.line(1, 2, 1, 28, '#3c474a');
    p.line(2, 30, 29, 30, '#1e292e'); p.line(30, 2, 30, 29, '#1e292e');
    p.r(0, 0, 2, 2, '#243036'); p.r(30, 30, 2, 2, '#243036');
    for (let n = 0; n < 42; n++) {
      const x = 3 + Math.floor(rnd() * 26), y = 3 + Math.floor(rnd() * 26);
      p.r(x, y, rnd() > 0.7 ? 2 : 1, 1, rnd() > 0.5 ? '#394447' : '#2b3539');
    }
    if (k !== 0) {
      const x = 6 + k * 3;
      p.line(x, 1, x - 3, 9, '#202a30'); p.line(x - 3, 9, x + 2, 15, '#202a30');
      p.line(x + 2, 15, x - 2, 24, '#202a30');
      p.line(x - 1, 10, x + 4, 8, '#202a30'); p.dot(x, 15, '#4b5350');
      if (k % 2) p.line(x - 2, 24, x + 3, 30, '#202a30');
    }
    if (k === 4) {
      for (let i = 0; i < 9; i++) p.r(2 + rnd() * 5, 2 + rnd() * 10, 2, 1, '#3f4940');
    }
    scene.textures.addCanvas(`floor${k}`, canvas);
  }
}

function architecture(scene: Phaser.Scene): void {
  let [canvas, p] = surface(48, 64);
  // Broken dressed-stone pier, rendered as a plan-view architectural sprite.
  p.poly([[8, 15], [16, 8], [33, 8], [40, 16], [40, 48], [33, 56], [13, 56], [6, 48]], '#151f26');
  p.r(9, 14, 29, 37, '#434b4c'); p.r(12, 12, 22, 40, '#59605c');
  p.r(16, 13, 14, 37, '#373f42'); p.r(18, 14, 10, 34, '#4a5150');
  for (const y of [17, 28, 39, 49]) {
    p.r(9, y, 29, 2, '#28343a'); p.r(10, y + 2, 27, 1, '#6c7064');
  }
  p.r(6, 10, 36, 8, '#292f34'); p.r(8, 10, 32, 5, '#76766a');
  p.r(9, 11, 30, 1, '#a3a08b'); p.r(5, 49, 38, 9, '#293237');
  p.r(7, 49, 34, 5, '#676b61'); p.r(8, 50, 32, 1, '#91917e');
  p.line(28, 9, 26, 21, '#202b33'); p.line(26, 21, 31, 27, '#202b33');
  p.line(17, 36, 15, 44, '#202b33'); p.r(9, 52, 5, 2, '#4c554b');
  scene.textures.addCanvas('pillar', canvas);

  [canvas, p] = surface(32, 40);
  p.ellipse(16, 34, 11, 4, '#121b23'); p.r(9, 29, 14, 5, '#3c4142');
  p.r(11, 28, 2, 6, '#777363'); p.r(20, 28, 2, 6, '#777363');
  p.poly([[5, 19], [27, 19], [24, 28], [8, 28]], '#181e26');
  p.r(6, 19, 20, 3, '#7d7160'); p.r(8, 20, 16, 1, '#b4a276');
  p.poly([[10, 20], [9, 14], [13, 15], [15, 6], [18, 13], [22, 9], [23, 20]], '#7f3e33');
  p.poly([[12, 20], [13, 13], [16, 9], [18, 16], [21, 13], [20, 20]], '#d38b4e');
  p.poly([[14, 20], [16, 14], [18, 18], [19, 20]], '#f2d092');
  p.dot(11, 8, '#b98a53'); p.dot(22, 3, '#976541');
  scene.textures.addCanvas('brazier', canvas);

  [canvas, p] = surface(48, 32);
  p.poly([[3, 21], [10, 13], [18, 14], [23, 9], [34, 12], [43, 23], [34, 28], [8, 28]], '#1e2a30');
  for (const [x,y,w,h] of [[8,15,10,7],[24,12,10,9],[18,22,12,6],[35,21,7,5],[3,24,5,3]]) {
    p.poly([[x,y + 2],[x + w-3,y],[x + w,y + 3],[x + w-1,y+h],[x,y+h]], '#515955');
    p.line(x + 1,y+2,x+w-3,y+1,'#818073');
    p.line(x + 1,y+h-1,x+w-2,y+h-1,'#354248');
  }
  p.r(14, 11, 3, 2, '#6b6c5f'); p.r(38, 28, 3, 1, '#717264');
  scene.textures.addCanvas('rubble', canvas);

  [canvas, p] = surface(128, 80);
  p.r(6, 9, 116, 62, '#172128');
  p.poly([[28, 65], [28, 29], [39, 15], [55, 9], [73, 9], [90, 15], [101, 29], [101, 65]], '#10191f');
  const stones = [[11,42,17,15],[11,25,17,15],[19,11,18,13],[36,4,18,13],[55,1,18,13],[75,4,18,13],[93,11,18,13],[101,25,17,15],[101,42,17,15]];
  for (const [x,y,w,h] of stones) {
    p.r(x,y,w,h,'#515a57'); p.r(x+1,y+1,w-2,2,'#7e8170'); p.r(x+w-2,y+3,2,h-3,'#354147');
    p.dot(x+4,y+5,'#727b6c');
  }
  p.r(7, 57, 25, 12, '#444e4b'); p.r(97, 57, 25, 12, '#444e4b');
  p.r(5, 68, 29, 6, '#6c7164'); p.r(95, 68, 29, 6, '#6c7164');
  p.line(58,3,62,8,'#28383d'); p.line(62,8,59,13,'#28383d');
  p.poly([[34,32],[40,25],[40,62],[36,65]],'#293539');
  p.poly([[94,32],[88,25],[88,62],[92,65]],'#293539');
  // Fine engraved rune over the arch's keystone.
  p.line(62,3,62,10,C.gold); p.line(59,5,65,8,C.gold); p.line(65,5,59,8,C.gold);
  scene.textures.addCanvas('arch', canvas);

  [canvas, p] = surface(16, 64);
  for (let y = -1; y < 64; y += 8) {
    p.r(5, y, 6, 7, '#131d25'); p.r(6, y+1, 4, 5, '#7c786a');
    p.r(7, y+2, 2, 3, '#1b262c'); p.r(5,y+6,6,3,'#333e42'); p.r(6,y+6,4,1,'#8b8270');
  }
  scene.textures.addCanvas('chain', canvas);

  [canvas, p] = surface(32, 64);
  p.r(4,3,25,3,'#172128'); p.r(5,3,23,1,'#9d916e');
  p.poly([[7,6],[25,6],[25,50],[20,58],[16,54],[11,60],[7,52]],'#18212b');
  p.poly([[8,7],[24,7],[24,49],[20,54],[16,51],[11,56],[8,51]],'#56333b');
  p.r(9,8,2,39,'#7c4b4b'); p.r(21,9,2,38,'#3a2934');
  p.line(15,18,15,41,'#ad9767'); p.line(11,25,20,25,'#ad9767');
  p.line(11,30,15,34,'#ad9767'); p.line(15,34,20,30,'#ad9767');
  p.r(15,20,2,2,'#dfcc96'); p.r(10,45,3,1,'#291e29'); p.r(22,47,3,1,'#291e29');
  scene.textures.addCanvas('banner', canvas);
}

function arcane(scene: Phaser.Scene): void {
  let [canvas,p] = surface(256,256);
  const cx=128,cy=128;
  p.ring(cx,cy,116,'#5e5b44',2); p.ring(cx,cy,111,'#272f30',2);
  p.ring(cx,cy,106,'#9b8c59'); p.ring(cx,cy,91,'#6b6549');
  p.ring(cx,cy,88,'#313f42'); p.ring(cx,cy,60,'#7b7655'); p.ring(cx,cy,18,'#9e956b');
  for(let i=0;i<12;i++) {
    const t=i/12*Math.PI*2;
    const at=(r:number,off=0)=>[cx+Math.cos(t+off)*r,cy+Math.sin(t+off)*r];
    const a=at(62),b=at(87),d=at(97),e=at(102,0.035),f=at(102,-0.035);
    p.line(a[0],a[1],b[0],b[1],'#72694e');
    p.line(d[0],d[1],e[0],e[1],'#b1a472'); p.line(d[0],d[1],f[0],f[1],'#b1a472');
    const g=at(99,-0.045),h=at(99,0.045);p.line(g[0],g[1],h[0],h[1],'#b1a472');
    const j=at(114);p.r(j[0]-1,j[1]-1,3,3,'#b8ab77');
  }
  for(let i=0;i<6;i++){
    const a=i/6*Math.PI*2-Math.PI/2,b=(i+2)/6*Math.PI*2-Math.PI/2;
    p.line(cx+Math.cos(a)*59,cy+Math.sin(a)*59,cx+Math.cos(b)*59,cy+Math.sin(b)*59,'#857c56');
  }
  p.poly([[128,104],[138,123],[133,142],[123,142],[118,123]],'#343f40');
  p.line(128,108,128,139,'#bdaf77'); p.line(123,119,133,127,'#bdaf77'); p.line(133,119,123,127,'#bdaf77');
  // Ancient chips interrupt the rings and prevent a sterile vector look.
  p.line(36,60,43,71,'#283338',2); p.line(43,71,38,87,'#283338');
  p.line(191,186,180,175,'#283338',2);p.line(180,175,178,165,'#283338');
  scene.textures.addCanvas('sigil',canvas);

  [canvas,p]=surface(24,32);
  p.poly([[8,4],[15,4],[18,9],[17,14],[20,23],[16,26],[13,23],[10,28],[7,25],[4,25],[7,14],[6,9]],'#90b3ac');
  p.poly([[10,5],[14,5],[15,9],[14,13],[16,22],[12,20],[9,24],[9,13],[8,9]],'#d4dfbd');
  p.r(9,9,6,2,'#5e8384'); p.line(12,14,12,22,'#789f96');p.r(3,15,3,8,'#b6cfb4');p.r(18,15,3,8,'#b6cfb4');
  scene.textures.addCanvas('soul',canvas);

  [canvas,p]=surface(16,24);
  p.line(2,1,8,9,'#b29c6a');p.line(14,1,8,9,'#b29c6a');
  p.poly([[7,8],[11,10],[13,17],[8,22],[3,17],[5,10]],'#201c27');
  p.poly([[7,10],[10,11],[11,17],[8,20],[5,17],[6,11]],'#bb3e4e');
  p.line(7,11,6,16,'#ffb08a');p.line(6,19,9,21,'#d9be7f');
  scene.textures.addCanvas('pendant',canvas);
}

/** Frames: direction * 12 + idle(0..1), walk(2..5), strikes(6..8), dodge(9), hit(10), death(11). */
export function generateArt(scene: Phaser.Scene): void {
  if(scene.textures.exists('hero')) return;
  for(const key of ['hero','ally','hollow','hound','demon']) {
    const size=key==='demon'?80:48;
    const [canvas,p]=surface(size*12,size*4);
    for(let d=0;d<4;d++) for(let f=0;f<12;f++) {
      p.c.save();p.c.translate(f*size,d*size);
      if(key==='demon') demon(p,d,f);
      else if(key==='hound') hound(p,d,f);
      else knight(p,d,f,key==='ally',key==='hollow');
      p.c.restore();
    }
    const texture = scene.textures.addCanvas(key,canvas)!;
    scene.textures.addSpriteSheet('',texture,{frameWidth:size,frameHeight:size});
  }
  tiles(scene);architecture(scene);arcane(scene);
}
