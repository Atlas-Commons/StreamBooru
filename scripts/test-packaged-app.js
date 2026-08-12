#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 0, ...spawnOptions } = options;
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...spawnOptions });
    let output = '';
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs) : null;
    child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
    child.once('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) reject(new Error('Packaged app startup timed out'));
      else resolve({ code, signal, output });
    });
  });
}

// Only the .deb/rpm installers give chrome-sandbox its root-owned setuid bit, so an unpacked
// build relies on user namespaces. Hosts that restrict those fall back to the SUID helper and
// abort, so drop the sandbox whenever the helper cannot work.
function sandboxUnusable(appDir) {
  if (process.platform !== 'linux') return false;
  if (typeof process.getuid === 'function' && process.getuid() === 0) return true;
  try {
    const helper = fs.statSync(path.join(appDir, 'chrome-sandbox'));
    return helper.uid !== 0 || (helper.mode & 0o4000) === 0;
  } catch {
    return false;
  }
}

async function main() {
  const builder = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  const built = await run(process.execPath, [builder, '--dir', '--publish=never', '--config', 'electron-builder.yml'], {
    env: { ...process.env, ELECTRON_CACHE: process.env.ELECTRON_CACHE || path.join(os.tmpdir(), 'streambooru-electron-cache') }
  });
  if (built.code !== 0) throw new Error(`electron-builder exited with ${built.code ?? built.signal}`);

  const executable = process.platform === 'win32'
    ? path.join(root, 'dist', 'win-unpacked', 'StreamBooru.exe')
    : process.platform === 'darwin'
      ? path.join(root, 'dist', 'mac', 'StreamBooru.app', 'Contents', 'MacOS', 'StreamBooru')
      : path.join(root, 'dist', 'linux-unpacked', 'streambooru');
  if (!fs.existsSync(executable)) throw new Error(`Packaged executable missing: ${executable}`);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'streambooru-smoke-'));
  const env = { ...process.env, SB_SMOKE_TEST: '1', SB_SMOKE_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = sandboxUnusable(path.dirname(executable)) ? ['--no-sandbox'] : [];

  const launched = await run(executable, args, { env, timeoutMs: 30_000 });
  if (launched.code !== 0) throw new Error(`Packaged app exited with ${launched.code ?? launched.signal}`);
  if (!launched.output.includes('STREAMBOORU_SMOKE_READY')) throw new Error('Packaged app did not reach renderer ready state');
  console.log('Packaged app startup test passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
