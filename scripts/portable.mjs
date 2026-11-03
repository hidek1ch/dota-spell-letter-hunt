import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
let html = await readFile(path.join(dist, 'index.html'), 'utf8');
const scriptTag = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/);
const styleTag = html.match(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/);
if (!scriptTag || !styleTag) throw new Error('Expected one bundled script and stylesheet in dist/index.html.');
// Vite emits public URLs under its base; map them back to local dist assets.
const assetsOffset = scriptTag[1].lastIndexOf('assets/');
if (assetsOffset < 0) throw new Error('Expected Vite assets/ directory.');
const publicBase = scriptTag[1].slice(0, assetsOffset);
function asset(relative) {
  if (!relative.startsWith(publicBase)) throw new Error('Asset did not match the Vite public base.');
  const resolved = path.resolve(dist, relative.slice(publicBase.length));
  if (!resolved.startsWith(dist + path.sep)) throw new Error('Asset escaped dist directory.');
  return resolved;
}
const script = await readFile(asset(scriptTag[1]), 'utf8');
const style = await readFile(asset(styleTag[1]), 'utf8');
if (/\b(?:import|export)\s+(?:["'{*]|\w+\s+from)/.test(script)) throw new Error('Portable build must not have external module imports.');
html = html.replace(scriptTag[0], () => `<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(styleTag[0], () => `<style>${style.replace(/<\/style/gi, '<\\/style')}</style>`);
const icon = await readFile(path.join(dist, 'favicon.svg'));
html = html.replace(/<link\b[^>]*rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${icon.toString('base64')}">`);
const notices = await readFile(path.join(dist, 'THIRD_PARTY_LICENSES.txt'), 'utf8');
if (notices.includes('-->')) throw new Error('Unexpected comment terminator in notices.');
html = html.replace('</html>', `<!--\n${notices}\n-->\n</html>`);
const output = path.join(root, 'release');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'START_GAME.html'), html, { mode: 0o644 });
await writeFile(path.join(output, 'THIRD_PARTY_LICENSES.txt'), notices, { mode: 0o644 });
await writeFile(path.join(output, 'READ_ME.txt'), `НАСЛЕДИЕ ПЕЧАТИ — портативная игра\n\n1. Сохраните START_GAME.html на компьютер.\n2. Откройте его двойным щелчком в Chrome или Edge.\n3. Для теста помещений нажмите «Исследовать замок».\nБоевой пролог остаётся доступен кнопкой «Начать путь».\n\nИнтернет, Node.js, установка библиотек и сервер не требуются.\nФайл должен иметь расширение .html (не .html.txt).\n\nЗамок: WASD/стрелки — движение; E/Enter — дверь или разговор; M — карта; Esc — пауза.\n\nБоевой пролог: WASD/стрелки — движение; J/ЛКМ — меч; пробел — рывок;\nQ/K — дракон; L/R — печать; E/Enter — взаимодействие; Esc — пауза.\n\nЕсли браузер не открывает файл, используйте правую кнопку мыши →\n«Открыть с помощью» → Chrome или Edge.\n`, { mode: 0o644 });
console.log(`Created release/START_GAME.html (${Buffer.byteLength(html)} bytes), no external assets.`);
