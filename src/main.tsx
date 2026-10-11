import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initClientTelemetry } from './services/telemetryService';

initClientTelemetry();

// Automatic recovery from stale deployment chunks or service worker mismatches
window.addEventListener('error', (event: ErrorEvent) => {
  const msg = event?.message || '';
  if (
    msg.includes('Failed to load module script') ||
    msg.includes('MIME type') ||
    msg.includes('Loading chunk') ||
    msg.includes('dynamically imported module')
  ) {
    const reloadKey = 'kshop_chunk_reload_lock';
    const lastReload = sessionStorage.getItem(reloadKey);
    const now = Date.now();
    // Allow at most 1 automatic cache purge & reload within 15 seconds to break stale cache loops
    if (!lastReload || now - Number(lastReload) > 15000) {
      sessionStorage.setItem(reloadKey, String(now));
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const reg of registrations) {
            reg.unregister();
          }
          if (typeof caches !== 'undefined') {
            caches.keys().then((names) => {
              void Promise.all(names.map((n) => caches.delete(n))).finally(() => {
                (window as any).location.reload();
              });
            });
          } else {
            (window as any).location.reload();
          }
        }).catch(() => {
          (window as any).location.reload();
        });
      } else {
        (window as any).location.reload();
      }
    }
  }
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register PWA service worker strictly on delivery portal routes
if ('serviceWorker' in navigator && window.location.pathname.startsWith('/delivery')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
