import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('../', import.meta.url));
const distDir = new URL('../dist/', import.meta.url);
const builtIndex = new URL('../dist/public/index.html', import.meta.url);

test('SEO test lifecycle produces its production HTML from absent dist output', () => {
  // Always exercise the clean-checkout prerequisite; an old local build must
  // never make the subsequent production-server tests pass accidentally.
  rmSync(distDir, { recursive: true, force: true });
  assert.equal(existsSync(distDir), false);

  const build = spawnSync('pnpm', ['run', 'build'], {
    cwd: packageDir,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'inherit',
  });
  assert.ifError(build.error);
  assert.equal(build.status, 0, `Frontend production build failed (signal: ${build.signal})`);
  assert.ok(existsSync(builtIndex), 'Build must produce dist/public/index.html');
  assert.match(readFileSync(builtIndex, 'utf8'), /<script\b[^>]*type="module"/);
});