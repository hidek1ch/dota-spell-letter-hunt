import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = readdirSync(new URL('../tests/', import.meta.url)).filter(name => name.endsWith('.test.ts')).sort();
if (!suites.length) throw new Error('No test suites found.');
for (const suite of suites) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', `tests/${suite}`], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
