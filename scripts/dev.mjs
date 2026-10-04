/**
 * Unified Development Launcher for K-Shop.
 *
 * Boots both the Express Backend (Port 3001) and Vite Frontend (Port 5173)
 * concurrently under a single process, ensuring the backend is never offline
 * when frontend requests are made.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');

console.log('\x1b[35m%s\x1b[0m', '═══════════════════════════════════════════════════════════');
console.log('\x1b[36m%s\x1b[0m', '⚡ [K-Shop] Launching Unified Full-Stack Environment...');
console.log('\x1b[35m%s\x1b[0m', '═══════════════════════════════════════════════════════════');

// Run sync-vision-assets first
const sync = spawn('node', ['scripts/sync-vision-assets.mjs'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

sync.on('close', (code) => {
  if (code !== 0) {
    console.error('[dev] Pre-dev sync failed. Code:', code);
    process.exit(code || 1);
  }

  console.log('\x1b[32m%s\x1b[0m', '▶ Starting Express API Backend (Port 3001)...');
  const backend = spawn('node', ['src/index.js'], {
    cwd: serverDir,
    stdio: 'inherit',
    shell: true,
  });

  console.log('\x1b[34m%s\x1b[0m', '▶ Starting Vite Frontend (Port 5173)...');
  const frontend = spawn('npx', ['vite'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });

  const terminate = () => {
    console.log('\n\x1b[33m%s\x1b[0m', 'Stopping development servers...');
    try { backend.kill(); } catch {}
    try { frontend.kill(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', terminate);
  process.on('SIGTERM', terminate);
});
